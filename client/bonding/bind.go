package bonding

import "net"

// BindSocketToInterface forces a UDP socket to egress through a specific
// OS interface. Exported for use by the interface probe so probes use the
// same adapter-binding as real bonding traffic.
// No-op on non-Windows (see bind_other.go).
func BindSocketToInterface(conn *net.UDPConn, ifIndex int) error {
	return bindSocketToInterface(conn, ifIndex)
}
