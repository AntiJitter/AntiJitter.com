//go:build !windows

package iface

// HostRoute represents an added /32 route to be cleaned up later.
type HostRoute struct {
	DestIP  string
	Gateway string
	IfIndex int
}

// AddHostRoutes is a no-op on non-Windows.
func AddHostRoutes(interfaces []Interface, serverAddrs []string) []HostRoute {
	return nil
}

// RemoveHostRoutes is a no-op on non-Windows.
func RemoveHostRoutes(routes []HostRoute) {}
