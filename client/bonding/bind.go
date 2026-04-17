package bonding

import (
	"fmt"
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

// DialUDPViaInterface opens a connected UDP socket to serverAddr that is
// forced to egress through the given OS interface index AND uses localIP
// as its source address.
//
// On Windows we must set IP_UNICAST_IF BEFORE bind/connect — if we let
// net.DialUDP bind+connect first and only set the socket option afterwards,
// Windows' route lookup during connect() picks the default interface and
// either (a) fails with WSAEADDRNOTAVAIL ("requested address is not valid
// in its context") when we try to bind to a specific local IP on a
// non-default interface, or (b) silently sends packets out the wrong
// adapter. Setting IP_UNICAST_IF via a Dialer.Control hook runs the option
// after socket() but before bind/connect, which is what we need.
//
// We ALSO bind to the adapter's local IP. IP_UNICAST_IF alone pins egress,
// but Windows still uses the routing table to pick the socket's source
// address at connect(); that can leave the socket thinking its local IP
// is on the default adapter while packets actually leave the pinned one.
// The server's reply then hits a different public IP and never matches
// the socket's 4-tuple. Binding to the adapter's own IP fixes that.
//
// localIP may be empty, in which case the OS picks (only safe when there
// is a single usable interface).
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
