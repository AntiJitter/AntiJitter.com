package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"antijitter.com/client/api"
	"antijitter.com/client/bonding"
	"antijitter.com/client/iface"
	"antijitter.com/client/tunnel"
)

const bondListenPort = 51821

// Status is sent to the frontend on every tick.
type Status struct {
	Active      bool       `json:"active"`
	Paths       []PathStat `json:"paths"`
	DataUsedMB  float64    `json:"data_used_mb"`
	DataLimitMB int64      `json:"data_limit_mb"`
	Connecting  bool       `json:"connecting"`
	DevRouteAll bool       `json:"dev_route_all"`
}

type PathStat struct {
	Name    string  `json:"name"`
	Active  bool    `json:"active"`
	BytesMB float64 `json:"bytes_mb"`
	Packets uint64  `json:"packets"`
}

// App is the Wails backend — all exported methods are callable from the frontend.
type App struct {
	ctx context.Context

	mu          sync.RWMutex
	active      bool
	bondClient  *bonding.Client
	wgTunnel    *tunnel.Tunnel
	hostRoutes  []iface.HostRoute
	token       string
	devRouteAll bool
	cancelStats context.CancelFunc

	toggleMu sync.Mutex // prevents double-toggle
}

func NewApp() *App {
	return &App{devRouteAll: true}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.setupFileLogging()
	token, _ := a.loadToken()
	a.mu.Lock()
	a.token = token
	a.mu.Unlock()
}

// setupFileLogging redirects log output to %APPDATA%\AntiJitter\antijitter.log
// so we can inspect app behavior without building in debug mode (Wails GUI
// builds detach stdout, so log.Printf goes nowhere otherwise).
func (a *App) setupFileLogging() {
	dir, err := os.UserConfigDir()
	if err != nil {
		return
	}
	logDir := filepath.Join(dir, "AntiJitter")
	if err := os.MkdirAll(logDir, 0700); err != nil {
		return
	}
	f, err := os.OpenFile(
		filepath.Join(logDir, "antijitter.log"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY,
		0600,
	)
	if err != nil {
		return
	}
	log.SetOutput(f)
	log.Printf("=== AntiJitter started ===")
}

func (a *App) shutdown(ctx context.Context) {
	a.stopGameMode()
}

// IsLoggedIn returns true if a saved auth token exists.
func (a *App) IsLoggedIn() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.token != ""
}

// Login authenticates against the AntiJitter API and saves the token.
func (a *App) Login(email, password string) error {
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(
		"https://app.antijitter.com/api/auth/login",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("connection failed — check your internet")
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return fmt.Errorf("invalid email or password")
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("login failed (server error %d)", resp.StatusCode)
	}

	var result struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("unexpected response from server")
	}
	if result.Token == "" {
		return fmt.Errorf("server returned empty token")
	}

	a.mu.Lock()
	a.token = result.Token
	a.mu.Unlock()

	a.saveToken(result.Token)
	return nil
}

// Logout clears the stored auth token.
func (a *App) Logout() {
	a.stopGameMode()
	a.mu.Lock()
	a.token = ""
	a.mu.Unlock()
	a.saveToken("")
}

// Toggle starts or stops Game Mode. Called from the UI button.
func (a *App) Toggle() error {
	if !a.toggleMu.TryLock() {
		return fmt.Errorf("already changing state — please wait")
	}
	defer a.toggleMu.Unlock()

	a.mu.RLock()
	isActive := a.active
	a.mu.RUnlock()

	if isActive {
		a.stopGameMode()
		return nil
	}
	return a.startGameMode()
}

// GetStatus returns the current state for initial render.
func (a *App) GetStatus() Status {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.buildStatus()
}

// SetDevRouteAll controls the local Windows route-all proof path. It is a
// temporary client-side override and only affects the next Game Mode start.
func (a *App) SetDevRouteAll(enabled bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.active {
		return fmt.Errorf("stop Game Mode before changing DEV route-all")
	}
	a.devRouteAll = enabled
	log.Printf("DEV route-all set to %v", enabled)
	return nil
}

// buildStatus reads current state; caller must hold at least RLock.
func (a *App) buildStatus() Status {
	s := Status{Active: a.active, DevRouteAll: a.devRouteAll}
	if a.bondClient != nil {
		for _, p := range a.bondClient.Stats() {
			s.Paths = append(s.Paths, PathStat{
				Name:    p.Name,
				Active:  p.Active,
				BytesMB: float64(p.Bytes) / (1024 * 1024),
				Packets: p.Packets,
			})
		}
		s.DataUsedMB = float64(a.bondClient.DataUsed4G.Load()) / (1024 * 1024)
		s.DataLimitMB = a.bondClient.GetDataLimitMB()
	}
	return s
}

func (a *App) startGameMode() error {
	a.mu.RLock()
	token := a.token
	devRouteAll := a.devRouteAll
	a.mu.RUnlock()

	if token == "" {
		return fmt.Errorf("not logged in")
	}

	// Signal UI: connecting
	runtime.EventsEmit(a.ctx, "connecting", true)

	// Fetch config from API
	cfg, err := api.New("https://app.antijitter.com", token).FetchConfig()
	if err != nil {
		runtime.EventsEmit(a.ctx, "connecting", false)
		return fmt.Errorf("fetch config: %w", err)
	}
	log.Printf("Config: bonding_servers=%v api_allowed_ips=%v data_limit_mb=%d",
		cfg.BondingServers, cfg.WireGuard.AllowedIPs, cfg.DataLimitMB)

	if devRouteAll {
		cfg.WireGuard.AllowedIPs = []string{"0.0.0.0/0"}
		log.Printf("DEV route-all enabled: overriding WireGuard AllowedIPs to %v", cfg.WireGuard.AllowedIPs)
	} else {
		log.Printf("DEV route-all disabled: using API WireGuard AllowedIPs %v", cfg.WireGuard.AllowedIPs)
	}

	// Detect and probe network interfaces
	allIfaces, err := iface.Detect()
	if err != nil {
		runtime.EventsEmit(a.ctx, "connecting", false)
		return fmt.Errorf("detect interfaces: %w", err)
	}
	log.Printf("Detected %d candidate adapter(s)", len(allIfaces))
	for _, ifc := range allIfaces {
		log.Printf("Detected adapter: name=%q addr=%s ifindex=%d", ifc.Name, ifc.Addr, ifc.Index)
	}

	// Add per-adapter host routes so Windows uses the correct gateway for
	// each adapter instead of routing everything through the lowest-metric
	// default route.
	hostRoutes := iface.AddHostRoutes(allIfaces, cfg.BondingServers)
	log.Printf("Host routes installed before tunnel start: %d", len(hostRoutes))

	reachable := iface.Probe(allIfaces, cfg.BondingServers, 8*time.Second)
	if len(reachable) == 0 {
		iface.RemoveHostRoutes(hostRoutes)
		runtime.EventsEmit(a.ctx, "connecting", false)
		return fmt.Errorf("no interfaces can reach any bonding server")
	}

	bondPaths := make([]bonding.PathConfig, len(reachable))
	for i, r := range reachable {
		bondPaths[i] = bonding.PathConfig{
			Name:       r.Interface.Name,
			LocalAddr:  r.Interface.Addr,
			IfIndex:    r.Interface.Index,
			ServerAddr: r.ServerAddr,
		}
		log.Printf("Bonding path %d: %s (%s) ifindex=%d → %s",
			i+1, r.Interface.Name, r.Interface.Addr, r.Interface.Index, r.ServerAddr)
	}

	log.Printf("Selected %d reachable bonding path(s)", len(bondPaths))

	// Start bonding client
	bondClient, err := bonding.New(bonding.Config{
		ListenPort:  bondListenPort,
		Paths:       bondPaths,
		DataLimitMB: cfg.DataLimitMB,
	})
	if err != nil {
		runtime.EventsEmit(a.ctx, "connecting", false)
		return fmt.Errorf("bonding init: %w", err)
	}
	go func() {
		if err := bondClient.Start(); err != nil {
			log.Printf("Bonding stopped: %v", err)
		}
	}()
	time.Sleep(100 * time.Millisecond)

	// Start WireGuard tunnel pointing to the local bonding client
	log.Printf("Final WireGuard AllowedIPs: %v", cfg.WireGuard.AllowedIPs)
	wgTunnel, err := tunnel.StartTunnel(tunnel.WgConfig{
		PrivateKey: cfg.WireGuard.PrivateKey,
		Address:    cfg.WireGuard.Address,
		DNS:        cfg.WireGuard.DNS,
		PeerKey:    cfg.WireGuard.PeerKey,
		Endpoint:   fmt.Sprintf("127.0.0.1:%d", bondListenPort),
		AllowedIPs: cfg.WireGuard.AllowedIPs,
	})
	if err != nil {
		bondClient.Stop()
		iface.RemoveHostRoutes(hostRoutes)
		runtime.EventsEmit(a.ctx, "connecting", false)
		return fmt.Errorf("wireguard tunnel: %w", err)
	}

	// Commit state
	statsCtx, cancelStats := context.WithCancel(context.Background())
	a.mu.Lock()
	a.active = true
	a.bondClient = bondClient
	a.wgTunnel = wgTunnel
	a.hostRoutes = hostRoutes
	a.cancelStats = cancelStats
	a.mu.Unlock()

	runtime.EventsEmit(a.ctx, "connecting", false)
	runtime.EventsEmit(a.ctx, "state-changed", true)

	go a.emitStats(statsCtx)
	return nil
}

func (a *App) stopGameMode() {
	// Grab and clear state atomically
	a.mu.Lock()
	client := a.bondClient
	tun := a.wgTunnel
	routes := a.hostRoutes
	cancel := a.cancelStats
	a.active = false
	a.bondClient = nil
	a.wgTunnel = nil
	a.hostRoutes = nil
	a.cancelStats = nil
	a.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if tun != nil {
		tun.StopTunnel()
	}
	if client != nil {
		client.Stop()
	}
	iface.RemoveHostRoutes(routes)

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "state-changed", false)
	}
}

func (a *App) emitStats(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.mu.RLock()
			s := a.buildStatus()
			a.mu.RUnlock()
			runtime.EventsEmit(a.ctx, "status", s)
		}
	}
}

func (a *App) tokenPath() string {
	dir, _ := os.UserConfigDir()
	return filepath.Join(dir, "AntiJitter", "token.txt")
}

func (a *App) saveToken(token string) {
	path := a.tokenPath()
	os.MkdirAll(filepath.Dir(path), 0700)
	os.WriteFile(path, []byte(token), 0600)
}

func (a *App) loadToken() (string, error) {
	data, err := os.ReadFile(a.tokenPath())
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}
