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
	Active    bool       `json:"active"`
	Paths     []PathStat `json:"paths"`
	DataUsedMB  float64  `json:"data_used_mb"`
	DataLimitMB int64    `json:"data_limit_mb"`
	Connecting  bool     `json:"connecting"`
}

type PathStat struct {
	Name    string  `json:"name"`
	Active  bool    `json:"active"`
	BytesMB float64 `json:"bytes_mb"`
}

// App is the Wails backend — all exported methods are callable from the frontend.
type App struct {
	ctx context.Context

	mu          sync.RWMutex
	active      bool
	bondClient  *bonding.Client
	wgTunnel    *tunnel.Tunnel
	token       string
	cancelStats context.CancelFunc

	toggleMu sync.Mutex // prevents double-toggle
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	token, _ := a.loadToken()
	a.mu.Lock()
	a.token = token
	a.mu.Unlock()
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

// buildStatus reads current state — caller must hold at least RLock.
func (a *App) buildStatus() Status {
	s := Status{Active: a.active}
	if a.bondClient != nil {
		for _, p := range a.bondClient.Stats() {
			s.Paths = append(s.Paths, PathStat{
				Name:    p.Name,
				Active:  p.Active,
				BytesMB: float64(p.Bytes) / (1024 * 1024),
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

	// Detect and probe network interfaces
	allIfaces, err := iface.Detect()
	if err != nil {
		runtime.EventsEmit(a.ctx, "connecting", false)
		return fmt.Errorf("detect interfaces: %w", err)
	}
	reachable := iface.Probe(allIfaces, cfg.BondingServer, 3*time.Second)
	if len(reachable) == 0 {
		runtime.EventsEmit(a.ctx, "connecting", false)
		return fmt.Errorf("no interfaces can reach %s", cfg.BondingServer)
	}

	bondPaths := make([]bonding.PathConfig, len(reachable))
	for i, ifc := range reachable {
		bondPaths[i] = bonding.PathConfig{Name: ifc.Name, LocalAddr: ifc.Addr}
		log.Printf("Bonding path %d: %s (%s)", i+1, ifc.Name, ifc.Addr)
	}

	// Start bonding client
	bondClient, err := bonding.New(bonding.Config{
		ListenPort:  bondListenPort,
		ServerAddr:  cfg.BondingServer,
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
		runtime.EventsEmit(a.ctx, "connecting", false)
		return fmt.Errorf("wireguard tunnel: %w", err)
	}

	// Commit state
	statsCtx, cancelStats := context.WithCancel(context.Background())
	a.mu.Lock()
	a.active = true
	a.bondClient = bondClient
	a.wgTunnel = wgTunnel
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
	cancel := a.cancelStats
	a.active = false
	a.bondClient = nil
	a.wgTunnel = nil
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
