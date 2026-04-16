//go:build !windows

package bonding

import "net"

// bindSocketToInterface is a no-op on non-Windows platforms — the Go
// runtime on Linux/macOS respects the source IP for route selection well
// enough for most setups. On Linux we could use SO_BINDTODEVICE but that
// needs CAP_NET_RAW.
func bindSocketToInterface(conn *net.UDPConn, ifIndex int) error {
	_ = conn
	_ = ifIndex
	return nil
}
