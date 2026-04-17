//go:build windows

package bonding

import (
	"encoding/binary"
	"fmt"
	"net"
	"syscall"

	"golang.org/x/sys/windows"
)

// IP_UNICAST_IF — forces outgoing unicast packets out a specific interface
// regardless of the routing table. Binding to a local IP alone isn't enough
// on Windows: the route lookup still picks the default interface if the
// source IP doesn't uniquely identify a route.
const sockoptIPUnicastIf = 31

// ifIndexSockoptValue converts an interface index to the value Windows
// expects for IP_UNICAST_IF: the 32-bit index in network byte order,
// re-read as a host-order int.
func ifIndexSockoptValue(ifIndex int) int {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint32(buf, uint32(ifIndex))
	return int(binary.LittleEndian.Uint32(buf))
}

// bindSocketToInterface forces an already-created UDP socket to egress
// through the given interface. Prefer DialUDPViaInterface for new sockets
// — this function is kept for code paths that already have a *net.UDPConn.
func bindSocketToInterface(conn *net.UDPConn, ifIndex int) error {
	raw, err := conn.SyscallConn()
	if err != nil {
		return fmt.Errorf("get raw conn: %w", err)
	}
	value := ifIndexSockoptValue(ifIndex)

	var sockErr error
	err = raw.Control(func(fd uintptr) {
		sockErr = windows.SetsockoptInt(
			windows.Handle(fd),
			syscall.IPPROTO_IP,
			sockoptIPUnicastIf,
			value,
		)
	})
	if err != nil {
		return fmt.Errorf("control: %w", err)
	}
	return sockErr
}

// controlBindToInterface is a net.Dialer Control hook body — applies
// IP_UNICAST_IF to the freshly-created socket before bind/connect.
func controlBindToInterface(c syscall.RawConn, ifIndex int) error {
	value := ifIndexSockoptValue(ifIndex)
	var sockErr error
	err := c.Control(func(fd uintptr) {
		sockErr = windows.SetsockoptInt(
			windows.Handle(fd),
			syscall.IPPROTO_IP,
			sockoptIPUnicastIf,
			value,
		)
	})
	if err != nil {
		return fmt.Errorf("control: %w", err)
	}
	return sockErr
}
