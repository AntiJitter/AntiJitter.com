//go:build !windows

package iface

// HostRoute represents an added /32 route to be cleaned up later.
type HostRoute struct {
	DestIP  string
	Gateway string
	IfIndex int
}

// HostRouteAssignment pins one bonding server destination to one adapter.
type HostRouteAssignment struct {
	ServerAddr string
	IfIndex    int
}

// AddHostRoutes is a no-op on non-Windows.
func AddHostRoutes(interfaces []Interface, serverAddrs []string) []HostRoute {
	return nil
}

// RemoveHostRoutes is a no-op on non-Windows.
func RemoveHostRoutes(routes []HostRoute) {}

// PreferHostRoute is a no-op on non-Windows.
func PreferHostRoute(routes []HostRoute, preferredIfIndex int) func() {
	return func() {}
}

// PinHostRoutes is a no-op on non-Windows.
func PinHostRoutes(routes []HostRoute, assignments []HostRouteAssignment) func() {
	return func() {}
}
