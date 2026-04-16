// Package iface detects usable network interfaces for multi-path bonding.
//
// On a typical AntiJitter setup, the machine has:
//   - Starlink (Ethernet or Wi-Fi to the Starlink router)
//   - 4G/5G (USB dongle, mobile hotspot, or built-in WWAN)
//
// This package finds all interfaces with IPv4 connectivity and returns them
// so the bonding client can bind to each one separately. Without binding to
// specific local IPs, all "paths" would go out the default route (Starlink)
// and no real bonding would happen.
package iface

import (
	"bytes"
	"fmt"
	"log"
	"net"
	"time"

	"antijitter.com/client/bonding"
)

// Interface represents a usable network adapter for bonding.
type Interface struct {
	Name  string // OS adapter name, e.g. "Ethernet", "Wi-Fi 2"
	Addr  string // IPv4 address, e.g. "192.168.1.100"
	Index int    // OS interface index
}

// tunSubnet is the WireGuard TUN address range — exclude it from bonding paths
// to avoid a routing loop (tunnel packets going back through the tunnel).
var tunSubnet = func() *net.IPNet {
	_, n, _ := net.ParseCIDR("10.10.0.0/24")
	return n
}()

// Detect finds all non-loopback, up, IPv4 interfaces suitable for bonding.
// Excludes the AntiJitter TUN adapter (10.10.0.0/24) to prevent loops.
// Returns at least one or an error.
func Detect() ([]Interface, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("list interfaces: %w", err)
	}

	var result []Interface
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		if ifc.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipNet.IP.To4()
			if ip4 == nil {
				continue // skip IPv6
			}
			if ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			if tunSubnet.Contains(ip4) {
				continue // skip the AntiJitter TUN — would cause a routing loop
			}

			result = append(result, Interface{
				Name:  ifc.Name,
				Addr:  ip4.String(),
				Index: ifc.Index,
			})
		}
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("no usable network interfaces found")
	}

	return result, nil
}

// Probe tests which interfaces can actually reach the bonding server.
// Sends a UDP packet through each interface and waits for a response.
// Returns only the interfaces that successfully round-tripped.
func Probe(interfaces []Interface, serverAddr string, timeout time.Duration) []Interface {
	type probeResult struct {
		ifc Interface
		ok  bool
	}

	ch := make(chan probeResult, len(interfaces))

	for _, ifc := range interfaces {
		go func(ifc Interface) {
			ok := probeOne(ifc, serverAddr, timeout)
			ch <- probeResult{ifc: ifc, ok: ok}
		}(ifc)
	}

	var reachable []Interface
	for range interfaces {
		r := <-ch
		if r.ok {
			reachable = append(reachable, r.ifc)
			log.Printf("  [OK] %s (%s) → can reach %s", r.ifc.Name, r.ifc.Addr, serverAddr)
		} else {
			log.Printf("  [--] %s (%s) → cannot reach server", r.ifc.Name, r.ifc.Addr)
		}
	}

	return reachable
}

// probeOne tests real round-trip connectivity for a specific interface.
// Binds to the interface (IP_UNICAST_IF on Windows) so the packet is forced
// out the target adapter — matching what the bonding client will do. The
// bonding server echoes probe packets back to the source, so we confirm
// the adapter has a working internet path rather than trusting Write() to
// succeed silently while packets vanish upstream.
func probeOne(ifc Interface, serverAddr string, timeout time.Duration) bool {
	localAddr, err := net.ResolveUDPAddr("udp", ifc.Addr+":0")
	if err != nil {
		return false
	}
	remoteAddr, err := net.ResolveUDPAddr("udp", serverAddr)
	if err != nil {
		return false
	}

	conn, err := net.DialUDP("udp", localAddr, remoteAddr)
	if err != nil {
		return false
	}
	defer conn.Close()

	if ifc.Index > 0 {
		if err := bonding.BindSocketToInterface(conn, ifc.Index); err != nil {
			return false
		}
	}

	probe := []byte{0, 0, 0, 0, 'p', 'r', 'o', 'b', 'e'}
	conn.SetWriteDeadline(time.Now().Add(timeout))
	if _, err := conn.Write(probe); err != nil {
		return false
	}

	// Retransmit once mid-way through the timeout — the first probe can be
	// lost if this path's NAT mapping hasn't warmed up yet.
	buf := make([]byte, 64)
	conn.SetReadDeadline(time.Now().Add(timeout / 2))
	n, err := conn.Read(buf)
	if err != nil {
		if _, werr := conn.Write(probe); werr != nil {
			return false
		}
		conn.SetReadDeadline(time.Now().Add(timeout / 2))
		n, err = conn.Read(buf)
		if err != nil {
			return false
		}
	}
	return n >= 9 && bytes.Equal(buf[:n], probe)
}
