package bonding

import (
	"context"
	"fmt"
	"log"
	"net"
	"syscall"
	"time"
)

// BindSocketToInterface forces a UDP socket to egress through a specific
// OS interface. Exported for use by the interface probe so probes use the
// same adapter-binding as real bonding traffic.
// No-op on non-Windows (see bind_other.go).
func BindSocketToInterface(conn *net.UDPConn, ifIndex int) error {
	return bindSocketToInterface(conn, ifIndex)
}

// ListenUDPViaInterface creates an UNCONNECTED UDP socket bound to localIP
// on a specific OS interface. Returns the socket and the resolved server
// address for use with WriteTo / ReadFrom.
//
// Unlike the connected-socket approach (DialUDP / net.Dialer.Dial), an
// unconnected socket never calls connect(), so Windows can't cache a
// route that disagrees with IP_UNICAST_IF. Each WriteTo goes through the
// forced interface directly.
//
// We still bind to localIP so the source address in outgoing packets
// matches the adapter (otherwise the reply can't be routed back through
// the correct NAT).
func ListenUDPViaInterface(serverAddr, localIP string, ifIndex int) (*net.UDPConn, *net.UDPAddr, error) {
	remote, err := net.ResolveUDPAddr("udp", serverAddr)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve %s: %w", serverAddr, err)
	}

	bindAddr := "0.0.0.0:0"
	if localIP != "" {
		bindAddr = localIP + ":0"
	}

	lc := net.ListenConfig{}
	if ifIndex > 0 {
		lc.Control = func(network, address string, c syscall.RawConn) error {
			return controlBindToInterface(c, ifIndex)
		}
	}
	pc, err := lc.ListenPacket(context.Background(), "udp", bindAddr)
	if err != nil {
		return nil, nil, fmt.Errorf("listen %s ifindex=%d: %w", bindAddr, ifIndex, err)
	}
	udp, ok := pc.(*net.UDPConn)
	if !ok {
		pc.Close()
		return nil, nil, fmt.Errorf("listen returned %T, want *net.UDPConn", pc)
	}

	log.Printf("ListenUDPViaInterface: bound %s ifindex=%d remote=%s",
		udp.LocalAddr(), ifIndex, remote)

	return udp, remote, nil
}

// DialUDPViaInterface opens a connected UDP socket to serverAddr that is
// forced to egress through the given OS interface index AND uses localIP
// as its source address. Kept for cases where a connected socket is needed;
// prefer ListenUDPViaInterface for multi-homed setups where connect()'s
// route cache can fight IP_UNICAST_IF.
func DialUDPViaInterface(serverAddr, localIP string, ifIndex int, timeout time.Duration) (*net.UDPConn, error) {
	d := &net.Dialer{Timeout: timeout}
	if localIP != "" {
		d.LocalAddr = &net.UDPAddr{IP: net.ParseIP(localIP), Port: 0}
	}
	if ifIndex > 0 {
		d.Control = func(network, address string, c syscall.RawConn) error {
			return controlBindToInterface(c, ifIndex)
		}
	}
	conn, err := d.Dial("udp", serverAddr)
	if err != nil {
		return nil, fmt.Errorf("dial %s via %s ifindex=%d: %w", serverAddr, localIP, ifIndex, err)
	}
	udp, ok := conn.(*net.UDPConn)
	if !ok {
		conn.Close()
		return nil, fmt.Errorf("dial returned %T, want *net.UDPConn", conn)
	}
	return udp, nil
}
