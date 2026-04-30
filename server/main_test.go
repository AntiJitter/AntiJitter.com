package main

import (
	"net"
	"testing"
	"time"
)

func TestParseReplyMode(t *testing.T) {
	tests := []struct {
		in   string
		want replyMode
	}{
		{in: "primary", want: replyModePrimary},
		{in: " all ", want: replyModeAll},
		{in: "ALL", want: replyModeAll},
	}

	for _, tt := range tests {
		got, err := parseReplyMode(tt.in)
		if err != nil {
			t.Fatalf("parseReplyMode(%q) unexpected error: %v", tt.in, err)
		}
		if got != tt.want {
			t.Fatalf("parseReplyMode(%q)=%q want %q", tt.in, got, tt.want)
		}
	}

	if _, err := parseReplyMode("striped"); err == nil {
		t.Fatal("parseReplyMode(striped) succeeded, want error")
	}
}

func TestReplyTargets(t *testing.T) {
	now := time.Now()
	conn := &net.UDPConn{}
	primary := &clientPath{addr: &net.UDPAddr{IP: net.IPv4(192, 0, 2, 1), Port: 1000}, conn: conn, lastSeen: now}
	secondary := &clientPath{addr: &net.UDPAddr{IP: net.IPv4(192, 0, 2, 2), Port: 2000}, conn: conn, lastSeen: now}
	stale := &clientPath{addr: &net.UDPAddr{IP: net.IPv4(192, 0, 2, 3), Port: 3000}, conn: conn, lastSeen: now.Add(-pathTTL - time.Second)}

	cs := &clientState{
		paths: map[string]*clientPath{
			primary.addr.String():   primary,
			secondary.addr.String(): secondary,
			stale.addr.String():     stale,
		},
		primary: primary,
	}

	if got := replyTargets(cs, replyModePrimary, now); len(got) != 1 || got[0] != primary {
		t.Fatalf("primary replyTargets=%v, want only primary", got)
	}

	got := replyTargets(cs, replyModeAll, now)
	if len(got) != 2 {
		t.Fatalf("all replyTargets len=%d, want 2", len(got))
	}
	for _, target := range got {
		if target == stale {
			t.Fatal("all replyTargets included stale path")
		}
	}
}
