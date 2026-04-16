// AntiJitter Windows Desktop App
//
// Single .exe that bundles WireGuard + multi-path UDP bonding.
// Users install one app, click "Game Mode", and their gaming traffic
// is bonded across Starlink + 4G simultaneously.
//
// System tray icon:
//   Gray  = Game Mode OFF
//   Green = Game Mode ON (bonding active)
//   Orange = 4G data limit approaching
//
// Traffic flow:
//   Game → WireGuard tunnel → 127.0.0.1:51821 → Bonding Client
//     → [Starlink + 4G] → Germany VPS :4567 → Bonding Server (dedup)
//     → WireGuard Server :51820 → Game Servers
package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/getlantern/systray"

	"antijitter.com/client/api"
	"antijitter.com/client/bonding"
	"antijitter.com/client/iface"
	"antijitter.com/client/tunnel"
	"antijitter.com/client/ui"
)

const (
	apiBaseURL     = "https://app.antijitter.com"
	tokenFile      = "antijitter-token.txt"
	bondListenPort = 51821 // local port WireGuard connects to (bonding client)
)

var (
	mu         sync.Mutex
	active     bool
	bondClient *bonding.Client
	wgTunnel   *tunnel.Tunnel
)

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)
	log.Println("AntiJitter starting")
	systray.Run(onReady, onExit)
}

func onReady() {
	systray.SetIcon(ui.IconGray)
	systray.SetTitle("AntiJitter")
	systray.SetTooltip("AntiJitter — Game Mode OFF")

	mToggle := systray.AddMenuItem("Game Mode: OFF", "Toggle Game Mode on/off")
	systray.AddSeparator()
	mStatus := systray.AddMenuItem("Status: Idle", "Connection status")
	mData := systray.AddMenuItem("4G Data: 0 MB", "4G data used this session")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Quit", "Exit AntiJitter")

	mStatus.Disable()
	mData.Disable()

	// Handle menu clicks
	go func() {
		for {
			select {
			case <-mToggle.ClickedCh:
				mu.Lock()
				if !active {
					err := startGameMode(mToggle, mStatus, mData)
					if err != nil {
						log.Printf("Start failed: %v", err)
						mStatus.SetTitle(fmt.Sprintf("Error: %v", err))
					}
				} else {
					stopGameMode(mToggle, mStatus, mData)
				}
				mu.Unlock()

			case <-mQuit.ClickedCh:
				mu.Lock()
				if active {
					stopGameMode(mToggle, mStatus, mData)
				}
				mu.Unlock()
				systray.Quit()
			}
		}
	}()

	// Background loop: update status + data display
	go statsLoop(mStatus, mData)
}

func startGameMode(toggle, status, data *systray.MenuItem) error {
	// Read auth token from file
	token, err := readToken()
	if err != nil {
		return fmt.Errorf("read token: %w", err)
	}

	// Fetch config from AntiJitter API
	status.SetTitle("Status: Connecting...")
	apiClient := api.New(apiBaseURL, token)
	cfg, err := apiClient.FetchConfig()
	if err != nil {
		return fmt.Errorf("fetch config: %w", err)
	}
	log.Printf("Config received: bonding=%s", cfg.BondingServer)

	// Detect real network interfaces on this machine.
	// Each interface gets its own UDP path to the bonding server.
	// Without this, all paths would bind to 0.0.0.0 and go out the
	// same route — no actual bonding.
	status.SetTitle("Status: Detecting interfaces...")
	allIfaces, err := iface.Detect()
	if err != nil {
		return fmt.Errorf("detect interfaces: %w", err)
	}
	log.Printf("Found %d interfaces, probing connectivity to %s...", len(allIfaces), cfg.BondingServer)

	// Probe which interfaces can actually reach the bonding server
	reachable := iface.Probe(allIfaces, cfg.BondingServer, 3*time.Second)
	if len(reachable) == 0 {
		return fmt.Errorf("no interfaces can reach bonding server %s", cfg.BondingServer)
	}

	// Convert to bonding paths — each binds to a specific local IP
	bondPaths := make([]bonding.PathConfig, len(reachable))
	for i, ifc := range reachable {
		bondPaths[i] = bonding.PathConfig{
			Name:      ifc.Name,
			LocalAddr: ifc.Addr,
		}
		log.Printf("Bonding path %d: %s (%s)", i+1, ifc.Name, ifc.Addr)
	}

	if len(bondPaths) < 2 {
		log.Printf("Warning: only %d path available — bonding needs 2+ for redundancy", len(bondPaths))
	}

	// Start bonding client first (it listens on bondListenPort)
	bondCfg := bonding.Config{
		ListenPort:  bondListenPort,
		ServerAddr:  cfg.BondingServer,
		Paths:       bondPaths,
		DataLimitMB: cfg.DataLimitMB,
	}
	bondClient, err = bonding.New(bondCfg)
	if err != nil {
		return fmt.Errorf("bonding init: %w", err)
	}
	go func() {
		if err := bondClient.Start(); err != nil {
			log.Printf("Bonding error: %v", err)
		}
	}()

	// Give bonding client a moment to bind the port
	time.Sleep(100 * time.Millisecond)

	// Start WireGuard tunnel — endpoint is the LOCAL bonding client
	wgCfg := tunnel.WgConfig{
		PrivateKey: cfg.WireGuard.PrivateKey,
		Address:    cfg.WireGuard.Address,
		DNS:        cfg.WireGuard.DNS,
		PeerKey:    cfg.WireGuard.PeerKey,
		Endpoint:   fmt.Sprintf("127.0.0.1:%d", bondListenPort),
		AllowedIPs: cfg.WireGuard.AllowedIPs,
	}
	wgTunnel, err = tunnel.StartTunnel(wgCfg)
	if err != nil {
		bondClient.Stop()
		bondClient = nil
		return fmt.Errorf("wireguard tunnel: %w", err)
	}

	active = true
	systray.SetIcon(ui.IconGreen)
	toggle.SetTitle("Game Mode: ON")
	status.SetTitle("Status: Active")
	systray.SetTooltip("AntiJitter — Game Mode ON")
	log.Println("Game Mode activated")

	return nil
}

func stopGameMode(toggle, status, data *systray.MenuItem) {
	// Tear down in reverse order: tunnel first, then bonding
	if wgTunnel != nil {
		wgTunnel.StopTunnel()
		wgTunnel = nil
	}
	if bondClient != nil {
		bondClient.Stop()
		bondClient = nil
	}

	active = false
	systray.SetIcon(ui.IconGray)
	toggle.SetTitle("Game Mode: OFF")
	status.SetTitle("Status: Idle")
	data.SetTitle("4G Data: 0 MB")
	systray.SetTooltip("AntiJitter — Game Mode OFF")
	log.Println("Game Mode deactivated")
}

// statsLoop updates the tray menu with live path stats and 4G data usage.
// Switches tray icon to orange when 4G usage exceeds 90% of the limit.
func statsLoop(status, data *systray.MenuItem) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	wasOrange := false

	for range ticker.C {
		mu.Lock()
		if active && bondClient != nil {
			// Build path status string
			stats := bondClient.Stats()
			var parts []string
			for _, s := range stats {
				if s.Active {
					mb := float64(s.Bytes) / (1024 * 1024)
					parts = append(parts, fmt.Sprintf("%s: %.1f MB", s.Name, mb))
				}
			}
			pathInfo := strings.Join(parts, " | ")
			if pathInfo == "" {
				pathInfo = "no active paths"
			}
			status.SetTitle(fmt.Sprintf("Status: Active — %s", pathInfo))

			// Update 4G data usage + icon color
			usedBytes := bondClient.DataUsed4G.Load()
			usedMB := float64(usedBytes) / (1024 * 1024)
			data.SetTitle(fmt.Sprintf("4G Data: %.1f MB", usedMB))

			// Switch to orange icon when 4G usage hits 90% of limit
			limitMB := bondClient.GetDataLimitMB()
			if limitMB > 0 && int64(usedMB) >= limitMB*9/10 {
				if !wasOrange {
					systray.SetIcon(ui.IconOrange)
					wasOrange = true
				}
			} else if wasOrange {
				systray.SetIcon(ui.IconGreen)
				wasOrange = false
			}
		}
		mu.Unlock()
	}
}

// readToken reads the auth token from the token file next to the executable.
func readToken() (string, error) {
	raw, err := os.ReadFile(tokenFile)
	if err != nil {
		return "", fmt.Errorf("open %s: %w (save your login token to this file)", tokenFile, err)
	}
	token := strings.TrimSpace(string(raw))
	if token == "" {
		return "", fmt.Errorf("%s is empty", tokenFile)
	}
	return token, nil
}

func onExit() {
	log.Println("AntiJitter exiting")
}
