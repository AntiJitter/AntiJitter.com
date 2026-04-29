// Package tunnel manages the WireGuard tunnel using wireguard-go as a library.
//
// On Windows it creates a TUN adapter via wintun and configures WireGuard
// in-process — no wg.exe or wireguard.exe needed.
//
// The tunnel's Endpoint points to the LOCAL bonding client (127.0.0.1:port),
// not the remote server. The bonding client handles multi-path delivery.
package tunnel

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"

	"antijitter.com/client/internal/winexec"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun"
)

// WgConfig holds the WireGuard tunnel configuration.
type WgConfig struct {
	PrivateKey string   // base64-encoded client private key
	Address    string   // tunnel IP, e.g. "10.10.0.5/24"
	DNS        string   // DNS server, e.g. "1.1.1.1"
	PeerKey    string   // base64-encoded server public key
	Endpoint   string   // bonding client listen address, e.g. "127.0.0.1:51821"
	AllowedIPs []string // e.g. ["10.10.0.0/24"]
}

// Tunnel wraps a running wireguard-go device and its TUN adapter.
type Tunnel struct {
	mu         sync.Mutex
	dev        *device.Device
	tunDev     tun.Device
	name       string
	routeCIDRs []string
}

const tunName = "AntiJitter"

// StartTunnel creates a TUN adapter, configures WireGuard, and brings it up.
func StartTunnel(cfg WgConfig) (*Tunnel, error) {
	// Create TUN adapter (uses wintun on Windows)
	tunDev, err := tun.CreateTUN(tunName, device.DefaultMTU)
	if err != nil {
		return nil, fmt.Errorf("create TUN: %w", err)
	}

	realName, err := tunDev.Name()
	if err != nil {
		tunDev.Close()
		return nil, fmt.Errorf("get TUN name: %w", err)
	}

	// Create wireguard-go device
	logger := device.NewLogger(device.LogLevelError, "wireguard: ")
	dev := device.NewDevice(tunDev, conn.NewDefaultBind(), logger)

	// Build UAPI configuration string
	uapi, err := buildUAPI(cfg)
	if err != nil {
		dev.Close()
		return nil, fmt.Errorf("build UAPI config: %w", err)
	}

	if err := dev.IpcSet(uapi); err != nil {
		dev.Close()
		return nil, fmt.Errorf("IPC set config: %w", err)
	}

	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, fmt.Errorf("device up: %w", err)
	}

	// Configure IP address and DNS on the TUN adapter
	if err := configureInterface(realName, cfg.Address, cfg.DNS); err != nil {
		dev.Close()
		return nil, fmt.Errorf("configure interface: %w", err)
	}

	routeCIDRs := routeCIDRsForAllowedIPs(cfg.AllowedIPs)
	if err := prepareRouting(realName, routeCIDRs); err != nil {
		dev.Close()
		return nil, fmt.Errorf("configure routes: %w", err)
	}

	// Add routes for AllowedIPs through the TUN adapter. Route-all uses split
	// default /1 routes so Windows prefers AntiJitter over the physical default
	// route without deleting the user's Starlink/mobile default route.
	for _, cidr := range routeCIDRs {
		if err := addRoute(realName, cidr); err != nil {
			dev.Close()
			cleanupRoutes(realName, routeCIDRs)
			return nil, fmt.Errorf("add route %s: %w", cidr, err)
		}
	}
	auditRoutes(realName)

	log.Printf("WireGuard tunnel up: %s addr=%s endpoint=%s", realName, cfg.Address, cfg.Endpoint)

	return &Tunnel{
		dev:        dev,
		tunDev:     tunDev,
		name:       realName,
		routeCIDRs: routeCIDRs,
	}, nil
}

// StopTunnel tears down the WireGuard device and TUN adapter.
func (t *Tunnel) StopTunnel() {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Remove routes before closing the device.
	cleanupRoutes(t.name, t.routeCIDRs)

	if t.dev != nil {
		t.dev.Close()
		t.dev = nil
		log.Printf("WireGuard tunnel down: %s", t.name)
	}
}

// buildUAPI converts the friendly WgConfig into wireguard-go's UAPI format.
// UAPI uses hex-encoded keys (not base64).
func buildUAPI(cfg WgConfig) (string, error) {
	privHex, err := base64ToHex(cfg.PrivateKey)
	if err != nil {
		return "", fmt.Errorf("decode private key: %w", err)
	}
	peerHex, err := base64ToHex(cfg.PeerKey)
	if err != nil {
		return "", fmt.Errorf("decode peer key: %w", err)
	}

	var b strings.Builder

	// Interface section
	fmt.Fprintf(&b, "private_key=%s\n", privHex)

	// Peer section
	fmt.Fprintf(&b, "public_key=%s\n", peerHex)
	fmt.Fprintf(&b, "endpoint=%s\n", cfg.Endpoint)
	fmt.Fprintf(&b, "persistent_keepalive_interval=25\n")

	for _, aip := range cfg.AllowedIPs {
		fmt.Fprintf(&b, "allowed_ip=%s\n", aip)
	}

	return b.String(), nil
}

// base64ToHex decodes a base64 WireGuard key to hex (UAPI format).
func base64ToHex(b64 string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	if len(raw) != 32 {
		return "", fmt.Errorf("key must be 32 bytes, got %d", len(raw))
	}
	return hex.EncodeToString(raw), nil
}

func routeCIDRsForAllowedIPs(allowedIPs []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, cidr := range allowedIPs {
		if cidr == "0.0.0.0/0" {
			for _, split := range []string{"0.0.0.0/1", "128.0.0.0/1"} {
				if !seen[split] {
					out = append(out, split)
					seen[split] = true
				}
			}
			continue
		}
		if !seen[cidr] {
			out = append(out, cidr)
			seen[cidr] = true
		}
	}
	log.Printf("WireGuard OS routes: allowed_ips=%v route_cidrs=%v", allowedIPs, out)
	return out
}

// configureInterface sets the IP address and DNS on the TUN adapter.
// On Windows this uses netsh; on Linux it uses ip commands.
func configureInterface(ifname, address, dns string) error {
	ip, ipNet, err := net.ParseCIDR(address)
	if err != nil {
		return fmt.Errorf("parse address %q: %w", address, err)
	}

	mask := net.IP(ipNet.Mask).String()

	// Set IP address
	out, err := winexec.CombinedOutput("netsh", "interface", "ip", "set", "address",
		ifname, "static", ip.String(), mask)
	if err != nil {
		return fmt.Errorf("netsh set address: %s: %w", strings.TrimSpace(string(out)), err)
	}

	// Set DNS
	if dns != "" {
		out, err = winexec.CombinedOutput("netsh", "interface", "ip", "set", "dns",
			ifname, "static", dns)
		if err != nil {
			return fmt.Errorf("netsh set dns: %s: %w", strings.TrimSpace(string(out)), err)
		}
	}

	return nil
}

func prepareRouting(ifname string, routeCIDRs []string) error {
	// Keep the AntiJitter interface metric below normal Wi-Fi/Ethernet defaults.
	out, err := winexec.CombinedOutput("netsh", "interface", "ipv4", "set", "interface",
		ifname, "metric=1")
	if err != nil {
		return fmt.Errorf("netsh set interface metric: %s: %w", strings.TrimSpace(string(out)), err)
	}
	log.Printf("Route metric set: %s metric=1", ifname)

	// Remove stale AntiJitter-owned routes from older builds/crashes before adding
	// the active routes for this session.
	stale := []string{"0.0.0.0/0", "0.0.0.0/1", "128.0.0.0/1"}
	for _, cidr := range routeCIDRs {
		stale = append(stale, cidr)
	}
	seen := map[string]bool{}
	for _, cidr := range stale {
		if seen[cidr] {
			continue
		}
		seen[cidr] = true
		_ = removeRoute(ifname, cidr)
	}
	return nil
}

// addRoute adds a route for the given CIDR through the named TUN adapter.
func addRoute(ifname, cidr string) error {
	out, err := winexec.CombinedOutput("netsh", "interface", "ipv4", "add", "route",
		cidr, ifname, "metric=1", "store=active")
	if err != nil {
		return fmt.Errorf("netsh add route %s: %s: %w", cidr, strings.TrimSpace(string(out)), err)
	}
	log.Printf("Route added: %s via %s metric=1 store=active", cidr, ifname)
	return nil
}

// removeRoute removes a route for the given CIDR from the named TUN adapter.
func removeRoute(ifname, cidr string) error {
	out, err := winexec.CombinedOutput("netsh", "interface", "ipv4", "delete", "route",
		cidr, ifname)
	if err != nil {
		return fmt.Errorf("netsh delete route %s: %s: %w", cidr, strings.TrimSpace(string(out)), err)
	}
	return nil
}

func cleanupRoutes(ifname string, routeCIDRs []string) {
	stale := append([]string{}, routeCIDRs...)
	stale = append(stale, "0.0.0.0/0", "0.0.0.0/1", "128.0.0.0/1")
	seen := map[string]bool{}
	for _, cidr := range stale {
		if seen[cidr] {
			continue
		}
		seen[cidr] = true
		if err := removeRoute(ifname, cidr); err != nil {
			log.Printf("Warning: failed to remove route for %s: %v", cidr, err)
		} else {
			log.Printf("Route removed: %s via %s", cidr, ifname)
		}
	}
}

func auditRoutes(ifname string) {
	cmd := `$targets=@('1.1.1.1','8.8.8.8','9.9.9.9'); foreach($t in $targets){ $r=Find-NetRoute -RemoteIPAddress $t -ErrorAction SilentlyContinue | Select-Object -First 1; if($r){ "$t => alias=$($r.InterfaceAlias) if=$($r.InterfaceIndex) prefix=$($r.DestinationPrefix) nexthop=$($r.NextHop) routeMetric=$($r.RouteMetric) ifMetric=$($r.InterfaceMetric)" } else { "$t => no route" } }; Get-NetRoute -DestinationPrefix 0.0.0.0/1,128.0.0.0/1 -ErrorAction SilentlyContinue | ForEach-Object { "split-default => alias=$($_.InterfaceAlias) prefix=$($_.DestinationPrefix) routeMetric=$($_.RouteMetric) ifMetric=$($_.InterfaceMetric)" }`
	out, err := winexec.Output("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", cmd)
	if err != nil {
		log.Printf("route audit failed for %s: %v", ifname, err)
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			log.Printf("route audit: %s", line)
		}
	}
}
