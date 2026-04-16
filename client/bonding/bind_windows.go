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

// bindSocketToInterface forces the UDP socket to egress through the given
// interface. Must be called before the first send.
func bindSocketToInterface(conn *net.UDPConn, ifIndex int) error {
	raw, err := conn.SyscallConn()
	if err != nil {
		return fmt.Errorf("get raw conn: %w", err)
	}

	// Windows requires the interface index in network byte order.
	buf := make([]byte, 4)
	binary.BigEndian.PutUint32(buf, uint32(ifIndex))
	value := int(binary.LittleEndian.Uint32(buf))

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
