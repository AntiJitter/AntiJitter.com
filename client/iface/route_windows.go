//go:build windows

package iface

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

// HostRoute represents an added /32 route to be cleaned up later.
type HostRoute struct {
	DestIP  string
	Gateway string
	IfIndex int
}

// AddHostRoutes adds a /32 route to each unique server IP via each
// interface's default gateway. This forces Windows to use the correct
// adapter even when multiple adapters share the same interface metric.
// Returns the routes added (pass to RemoveHostRoutes for cleanup).
func AddHostRoutes(interfaces []Interface, serverAddrs []string) []HostRoute {
	gateways := getDefaultGateways()

	// Extract unique server IPs from "host:port" addresses.
	serverIPs := map[string]bool{}
	for _, addr := range serverAddrs {
		host := addr
		if i := strings.LastIndex(addr, ":"); i >= 0 {
			host = addr[:i]
		}
		serverIPs[host] = true
	}

	var routes []HostRoute
	seen := map[string]bool{} // "destIP|ifIndex"
	for _, ifc := range interfaces {
		gw, ok := gateways[ifc.Index]
		if !ok {
			log.Printf("route: no default gateway for %s (ifindex=%d), skipping", ifc.Name, ifc.Index)
			continue
		}
		for ip := range serverIPs {
			key := fmt.Sprintf("%s|%d", ip, ifc.Index)
			if seen[key] {
				continue
			}
			seen[key] = true
			if err := addRoute(ip, gw, ifc.Index); err != nil {
				log.Printf("route: add %s via %s IF %d failed: %v", ip, gw, ifc.Index, err)
				continue
			}
			routes = append(routes, HostRoute{DestIP: ip, Gateway: gw, IfIndex: ifc.Index})
			log.Printf("route: added %s/32 via %s IF %d (%s)", ip, gw, ifc.Index, ifc.Name)
		}
	}
	return routes
}

// RemoveHostRoutes removes previously added host routes.
func RemoveHostRoutes(routes []HostRoute) {
	for _, r := range routes {
		if err := deleteRoute(r.DestIP, r.Gateway, r.IfIndex); err != nil {
			log.Printf("route: delete %s via %s IF %d failed: %v", r.DestIP, r.Gateway, r.IfIndex, err)
		} else {
			log.Printf("route: deleted %s via %s IF %d", r.DestIP, r.Gateway, r.IfIndex)
		}
	}
}

func addRoute(destIP, gateway string, ifIndex int) error {
	out, err := exec.Command("route", "add",
		destIP, "mask", "255.255.255.255",
		gateway, "if", fmt.Sprint(ifIndex),
		"metric", "1",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func deleteRoute(destIP, gateway string, ifIndex int) error {
	out, err := exec.Command("route", "delete",
		destIP, "mask", "255.255.255.255",
		gateway, "if", fmt.Sprint(ifIndex),
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// getDefaultGateways returns ifIndex → gateway IP for all adapters that
// have a default route (0.0.0.0/0).
func getDefaultGateways() map[int]string {
	out, err := exec.Command("powershell", "-NoProfile", "-Command",
		`Get-NetRoute -DestinationPrefix 0.0.0.0/0 | ForEach-Object { "$($_.ifIndex)=$($_.NextHop)" }`,
	).Output()
	if err != nil {
		log.Printf("route: failed to get default gateways: %v", err)
		return nil
	}

	result := map[int]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		var idx int
		if _, err := fmt.Sscanf(parts[0], "%d", &idx); err != nil {
			continue
		}
		result[idx] = parts[1]
	}
	return result
}
