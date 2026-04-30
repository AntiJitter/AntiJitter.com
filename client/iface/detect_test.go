package iface

import "testing"

func TestOrderedServerAddrsPrefersUnusedHosts(t *testing.T) {
	servers := []string{
		"178.104.168.177:4567",
		"178.104.168.177:443",
		"203.0.113.10:4567",
		"203.0.113.10:443",
	}
	used := map[string]bool{"178.104.168.177": true}

	got := orderedServerAddrs(servers, used, true)
	if got[0] != "203.0.113.10:4567" || got[1] != "203.0.113.10:443" {
		t.Fatalf("orderedServerAddrs()=%v, want unused host first", got)
	}
	if len(got) != 2 {
		t.Fatalf("orderedServerAddrs()=%v, want only unused hosts while available", got)
	}
}

func TestOrderedServerAddrsFallsBackAfterAllHostsUsed(t *testing.T) {
	servers := []string{
		"178.104.168.177:4567",
		"203.0.113.10:4567",
	}
	used := map[string]bool{
		"178.104.168.177": true,
		"203.0.113.10":    true,
	}

	got := orderedServerAddrs(servers, used, true)
	if len(got) != len(servers) {
		t.Fatalf("orderedServerAddrs()=%v, want fallback to used hosts", got)
	}
}

func TestOrderedServerAddrsKeepsOrderForSingleHost(t *testing.T) {
	servers := []string{"178.104.168.177:4567", "178.104.168.177:443"}
	used := map[string]bool{"178.104.168.177": true}

	got := orderedServerAddrs(servers, used, false)
	for i := range servers {
		if got[i] != servers[i] {
			t.Fatalf("orderedServerAddrs()[%d]=%q want %q", i, got[i], servers[i])
		}
	}
}

func TestCountServerHosts(t *testing.T) {
	if got := countServerHosts([]string{"178.104.168.177:4567", "178.104.168.177:443"}); got != 1 {
		t.Fatalf("countServerHosts single host=%d want 1", got)
	}
	if got := countServerHosts([]string{"178.104.168.177:4567", "203.0.113.10:4567"}); got != 2 {
		t.Fatalf("countServerHosts two hosts=%d want 2", got)
	}
}
