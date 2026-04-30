package main

import (
	"net"
	"reflect"
	"testing"
	"time"
)

func TestParseHosts(t *testing.T) {
	got, err := parseHosts("0.0.0.0, 203.0.113.10,203.0.113.10")
	if err != nil {
		t.Fatalf("parseHosts unexpected error: %v", err)
	}
	want := []string{"0.0.0.0", "203.0.113.10"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseHosts=%v want %v", got, want)
	}

	if _, err := parseHosts("example.com"); err == nil {
		t.Fatal("parseHosts(example.com) succeeded, want error")
	}
}

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

func TestParseReplyModeControl(t *testing.T) {
	got, handled := parseReplyModeControl([]byte("reply-mode:primary"))
	if !handled || got != replyModePrimary {
		t.Fatalf("parseReplyModeControl primary=(%q,%v), want primary,true", got, handled)
	}

	got, handled = parseReplyModeControl([]byte("reply-mode:ALL"))
	if !handled || got != replyModeAll {
		t.Fatalf("parseReplyModeControl all=(%q,%v), want all,true", got, handled)
	}

	if got, handled := parseReplyModeControl([]byte("probe")); handled || got != "" {
		t.Fatalf("parseReplyModeControl probe=(%q,%v), want empty,false", got, handled)
	}

	if got, handled := parseReplyModeControl([]byte("reply-mode:striped")); !handled || got != "" {
		t.Fatalf("parseReplyModeControl invalid=(%q,%v), want empty,true", got, handled)
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

	cs.replyMode = replyModeAll
	got = replyTargets(cs, replyModePrimary, now)
	if len(got) != 2 {
		t.Fatalf("client all override replyTargets len=%d, want 2", len(got))
	}
}
