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

// tunSubnet is the WireGuard TUN address range; exclude it from bonding paths
// to avoid a routing loop.
var tunSubnet = func() *net.IPNet {
	_, n, _ := net.ParseCIDR("10.10.0.0/24")
	return n
}()

// Detect finds all non-loopback, up, IPv4 interfaces suitable for bonding.
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
				continue
			}
			if ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			if tunSubnet.Contains(ip4) {
				continue
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

// ReachablePath is an interface paired with the server address that it
// successfully probed against.
type ReachablePath struct {
	Interface  Interface
	ServerAddr string
	Connected  bool
}

// Probe tests each interface against each candidate server address.
func Probe(interfaces []Interface, serverAddrs []string, timeout time.Duration, hostRoutes []HostRoute) []ReachablePath {
	var out []ReachablePath
	for _, ifc := range interfaces {
		restoreRoute := PreferHostRoute(hostRoutes, ifc.Index)
		var hit *ReachablePath
		for _, serverAddr := range serverAddrs {
			if ok, connected := probeOne(ifc, serverAddr, timeout, len(hostRoutes) > 0); ok {
				hit = &ReachablePath{Interface: ifc, ServerAddr: serverAddr, Connected: connected}
				break
			}
		}
		restoreRoute()
		if hit != nil {
			out = append(out, *hit)
			log.Printf("  [OK] %s (%s) can reach %s connected=%v", hit.Interface.Name, hit.Interface.Addr, hit.ServerAddr, hit.Connected)
		} else {
			log.Printf("  [--] %s (%s) cannot reach any bonding server", ifc.Name, ifc.Addr)
		}
	}

	return out
}

func probeOne(ifc Interface, serverAddr string, timeout time.Duration, preferConnected bool) (bool, bool) {
	if preferConnected {
		if ok, connected := probeOneConnected(ifc, serverAddr, timeout); ok {
			return ok, connected
		}
	}

	conn, remote, err := bonding.ListenUDPViaInterface(serverAddr, ifc.Addr, ifc.Index)
	if err != nil {
		log.Printf("  probe %s (%s) -> %s: listen failed: %v", ifc.Name, ifc.Addr, serverAddr, err)
		return probeOneConnected(ifc, serverAddr, timeout)
	}
	defer conn.Close()

	log.Printf("  probe %s (%s) -> %s: socket bound to %s", ifc.Name, ifc.Addr, serverAddr, conn.LocalAddr())
	if probeUnconnected(conn, remote, ifc, serverAddr, timeout) {
		return true, false
	}

	log.Printf("  probe %s (%s) -> %s: retrying with connected UDP", ifc.Name, ifc.Addr, serverAddr)
	return probeOneConnected(ifc, serverAddr, timeout)
}

func probeUnconnected(conn *net.UDPConn, remote *net.UDPAddr, ifc Interface, serverAddr string, timeout time.Duration) bool {
	probe := []byte{0, 0, 0, 0, 'p', 'r', 'o', 'b', 'e'}
	conn.SetWriteDeadline(time.Now().Add(timeout))
	if _, err := conn.WriteToUDP(probe, remote); err != nil {
		log.Printf("  probe %s (%s) -> %s: write failed: %v", ifc.Name, ifc.Addr, serverAddr, err)
		return false
	}

	buf := make([]byte, 64)
	conn.SetReadDeadline(time.Now().Add(timeout / 2))
	n, _, err := conn.ReadFromUDP(buf)
	if err != nil {
		log.Printf("  probe %s (%s) -> %s: no reply in %s, retransmitting", ifc.Name, ifc.Addr, serverAddr, timeout/2)
		if _, werr := conn.WriteToUDP(probe, remote); werr != nil {
			log.Printf("  probe %s (%s) -> %s: retransmit write failed: %v", ifc.Name, ifc.Addr, serverAddr, werr)
			return false
		}
		conn.SetReadDeadline(time.Now().Add(timeout / 2))
		n, _, err = conn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("  probe %s (%s) -> %s: still no reply after retransmit: %v", ifc.Name, ifc.Addr, serverAddr, err)
			return false
		}
	}
	if n < 9 || !bytes.Equal(buf[:n], probe) {
		log.Printf("  probe %s (%s) -> %s: bad echo (n=%d)", ifc.Name, ifc.Addr, serverAddr, n)
		return false
	}
	return true
}

func probeOneConnected(ifc Interface, serverAddr string, timeout time.Duration) (bool, bool) {
	conn, err := bonding.DialUDPViaInterface(serverAddr, ifc.Addr, ifc.Index, timeout)
	if err != nil {
		log.Printf("  probe %s (%s) -> %s: connected dial failed: %v", ifc.Name, ifc.Addr, serverAddr, err)
		return false, false
	}
	defer conn.Close()

	log.Printf("  probe %s (%s) -> %s: connected socket bound to %s", ifc.Name, ifc.Addr, serverAddr, conn.LocalAddr())
	probe := []byte{0, 0, 0, 0, 'p', 'r', 'o', 'b', 'e'}
	conn.SetWriteDeadline(time.Now().Add(timeout))
	if _, err := conn.Write(probe); err != nil {
		log.Printf("  probe %s (%s) -> %s: connected write failed: %v", ifc.Name, ifc.Addr, serverAddr, err)
		return false, false
	}

	buf := make([]byte, 64)
	conn.SetReadDeadline(time.Now().Add(timeout / 2))
	n, err := conn.Read(buf)
	if err != nil {
		log.Printf("  probe %s (%s) -> %s: connected no reply in %s, retransmitting", ifc.Name, ifc.Addr, serverAddr, timeout/2)
		if _, werr := conn.Write(probe); werr != nil {
			log.Printf("  probe %s (%s) -> %s: connected retransmit failed: %v", ifc.Name, ifc.Addr, serverAddr, werr)
			return false, false
		}
		conn.SetReadDeadline(time.Now().Add(timeout / 2))
		n, err = conn.Read(buf)
		if err != nil {
			log.Printf("  probe %s (%s) -> %s: connected still no reply after retransmit: %v", ifc.Name, ifc.Addr, serverAddr, err)
			return false, false
		}
	}
	if n < 9 || !bytes.Equal(buf[:n], probe) {
		log.Printf("  probe %s (%s) -> %s: connected bad echo (n=%d)", ifc.Name, ifc.Addr, serverAddr, n)
		return false, false
	}
	return true, true
}
