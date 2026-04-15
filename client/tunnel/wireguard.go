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
	"os/exec"
	"strings"
	"sync"

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
	mu     sync.Mutex
	dev    *device.Device
	tunDev tun.Device
	name   string
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

	log.Printf("WireGuard tunnel up: %s addr=%s endpoint=%s", realName, cfg.Address, cfg.Endpoint)

	return &Tunnel{
		dev:    dev,
		tunDev: tunDev,
		name:   realName,
	}, nil
}

// StopTunnel tears down the WireGuard device and TUN adapter.
func (t *Tunnel) StopTunnel() {
	t.mu.Lock()
	defer t.mu.Unlock()

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

// configureInterface sets the IP address and DNS on the TUN adapter.
// On Windows this uses netsh; on Linux it uses ip commands.
func configureInterface(ifname, address, dns string) error {
	ip, ipNet, err := net.ParseCIDR(address)
	if err != nil {
		return fmt.Errorf("parse address %q: %w", address, err)
	}

	mask := net.IP(ipNet.Mask).String()

	// Set IP address
	out, err := exec.Command("netsh", "interface", "ip", "set", "address",
		ifname, "static", ip.String(), mask).CombinedOutput()
	if err != nil {
		return fmt.Errorf("netsh set address: %s: %w", strings.TrimSpace(string(out)), err)
	}

	// Set DNS
	if dns != "" {
		out, err = exec.Command("netsh", "interface", "ip", "set", "dns",
			ifname, "static", dns).CombinedOutput()
		if err != nil {
			return fmt.Errorf("netsh set dns: %s: %w", strings.TrimSpace(string(out)), err)
		}
	}

	return nil
}
