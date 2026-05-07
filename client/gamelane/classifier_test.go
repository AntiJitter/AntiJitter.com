package gamelane

import (
	"net"
	"testing"
	"time"
)

func testConfig() Config {
	cfg := DefaultConfig()
	cfg.XboxLANIP = "192.168.137.42"
	return cfg
}

func baseXboxUDP(port uint16) FlowSample {
	return FlowSample{
		SourceIP:       net.ParseIP("192.168.137.42"),
		DestIP:         net.ParseIP("13.107.246.45"),
		Protocol:       ProtocolUDP,
		DestPort:       port,
		PacketSize:     180,
		FlowBitrateBPS: 80_000,
		FlowAge:        2 * time.Second,
		StableInterval: true,
	}
}

func TestClassifierPromotesSmallSteadyXboxGameUDP(t *testing.T) {
	decision := NewClassifier(testConfig()).Classify(baseXboxUDP(3074))
	if !decision.PromoteTo4G {
		t.Fatalf("expected promote, got score=%d reasons=%v", decision.Score, decision.Reasons)
	}
}

func TestClassifierRejectsUDP443(t *testing.T) {
	decision := NewClassifier(testConfig()).Classify(baseXboxUDP(443))
	if decision.PromoteTo4G {
		t.Fatalf("expected UDP/443 reject, got score=%d reasons=%v", decision.Score, decision.Reasons)
	}
}

func TestClassifierRejectsTCP443(t *testing.T) {
	sample := baseXboxUDP(443)
	sample.Protocol = ProtocolTCP
	decision := NewClassifier(testConfig()).Classify(sample)
	if decision.PromoteTo4G {
		t.Fatalf("expected TCP reject, got score=%d reasons=%v", decision.Score, decision.Reasons)
	}
}

func TestClassifierRejectsLargeUDPBurst(t *testing.T) {
	sample := baseXboxUDP(3074)
	sample.PacketSize = 1200
	decision := NewClassifier(testConfig()).Classify(sample)
	if decision.PromoteTo4G {
		t.Fatalf("expected large UDP reject, got score=%d reasons=%v", decision.Score, decision.Reasons)
	}
}

func TestClassifierMaybeCandidateKnownPortUnknownDestination(t *testing.T) {
	sample := baseXboxUDP(3075)
	sample.KnownGameASN = false
	decision := NewClassifier(testConfig()).Classify(sample)
	if !decision.PromoteTo4G {
		t.Fatalf("expected known-port game-like flow to promote, got score=%d reasons=%v", decision.Score, decision.Reasons)
	}
}

func TestClassifierRejectsKnownASNHighBitrate(t *testing.T) {
	sample := baseXboxUDP(3074)
	sample.KnownGameASN = true
	sample.FlowBitrateBPS = 8_000_000
	decision := NewClassifier(testConfig()).Classify(sample)
	if decision.PromoteTo4G {
		t.Fatalf("expected high bitrate reject, got score=%d reasons=%v", decision.Score, decision.Reasons)
	}
}

func TestClassifierRejectsNonXboxSource(t *testing.T) {
	sample := baseXboxUDP(3074)
	sample.SourceIP = net.ParseIP("192.168.1.50")
	decision := NewClassifier(testConfig()).Classify(sample)
	if decision.PromoteTo4G {
		t.Fatalf("expected non-Xbox reject, got score=%d reasons=%v", decision.Score, decision.Reasons)
	}
}

func TestClassifierRejectsXboxDownloadLikeFlow(t *testing.T) {
	sample := baseXboxUDP(3074)
	sample.PacketSize = 590
	sample.FlowBitrateBPS = 4_000_000
	sample.StableInterval = false
	decision := NewClassifier(testConfig()).Classify(sample)
	if decision.PromoteTo4G {
		t.Fatalf("expected download-like flow reject, got score=%d reasons=%v", decision.Score, decision.Reasons)
	}
}
