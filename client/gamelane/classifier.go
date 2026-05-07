package gamelane

import (
	"fmt"
	"net"
	"strings"
	"time"
)

const (
	ProtocolUDP = "udp"
	ProtocolTCP = "tcp"
)

// FlowSample is the classifier input for one observed packet plus rolling flow
// metadata. The future WinDivert capture layer should update this from a
// per-flow table before calling Classify.
type FlowSample struct {
	SourceIP       net.IP
	SourceMAC      string
	DestIP         net.IP
	Protocol       string
	DestPort       uint16
	PacketSize     int
	FlowBitrateBPS int64
	FlowAge        time.Duration
	StableInterval bool
	KnownGameASN   bool
}

// Decision explains whether a flow is safe to steer to mobile data.
type Decision struct {
	PromoteTo4G bool     `json:"promote_to_4g"`
	Score       int      `json:"score"`
	Reasons     []string `json:"reasons"`
}

// Classifier scores Xbox gateway flows. It intentionally rejects broad classes
// like TCP, UDP/443, and high-bandwidth UDP before considering positive signals.
type Classifier struct {
	cfg Config
}

func NewClassifier(cfg Config) Classifier {
	if cfg.PromoteScore == 0 {
		cfg.PromoteScore = DefaultConfig().PromoteScore
	}
	return Classifier{cfg: cfg}
}

func (c Classifier) Classify(sample FlowSample) Decision {
	score := 0
	var reasons []string
	add := func(points int, reason string) {
		score += points
		reasons = append(reasons, fmt.Sprintf("%+d %s", points, reason))
	}
	reject := func(points int, reason string) Decision {
		score += points
		reasons = append(reasons, fmt.Sprintf("%+d %s", points, reason))
		return Decision{PromoteTo4G: false, Score: score, Reasons: reasons}
	}

	if !c.isXboxSource(sample) {
		return reject(-50, "unknown_source_device")
	}
	add(40, "source_is_xbox")

	switch strings.ToLower(sample.Protocol) {
	case ProtocolUDP:
		add(30, "protocol_udp")
	case ProtocolTCP:
		return reject(-100, "tcp_rejected")
	default:
		return reject(-80, "unknown_protocol_rejected")
	}

	if c.cfg.isExcludedUDPPort(sample.DestPort) {
		return reject(-100, "udp_443_or_excluded_port")
	}

	if c.cfg.isGamePort(sample.DestPort) {
		add(20, "known_game_port")
	}

	maxPacket := c.cfg.MaxGamePacketSize
	if maxPacket == 0 {
		maxPacket = DefaultConfig().MaxGamePacketSize
	}
	if sample.PacketSize > 0 && sample.PacketSize <= maxPacket {
		add(20, "small_packet")
	} else if sample.PacketSize > maxPacket {
		return reject(-80, "large_udp_burst")
	}

	maxBitrate := c.cfg.MaxGameFlowBitrate
	if maxBitrate == 0 {
		maxBitrate = DefaultConfig().MaxGameFlowBitrate
	}
	if sample.FlowBitrateBPS > maxBitrate {
		return reject(-80, "high_bandwidth_flow")
	}
	if sample.FlowBitrateBPS > 0 {
		add(20, "low_sustained_bitrate")
	}

	minAge := c.cfg.MinFlowAge
	if minAge == 0 {
		minAge = DefaultConfig().MinFlowAge
	}
	if sample.FlowAge >= minAge {
		add(10, "flow_age_ok")
	}

	if sample.StableInterval {
		add(10, "stable_game_like_timing")
	}
	if sample.KnownGameASN {
		add(10, "known_game_platform_asn")
	}

	promote := score >= c.cfg.PromoteScore
	if promote {
		reasons = append(reasons, "promoted:small_udp_low_bitrate_known_port")
	} else {
		reasons = append(reasons, "defaulted_to_starlink:score_below_threshold")
	}
	return Decision{PromoteTo4G: promote, Score: score, Reasons: reasons}
}

func (c Classifier) isXboxSource(sample FlowSample) bool {
	xboxIP := c.cfg.xboxIP()
	if xboxIP != nil && sample.SourceIP != nil {
		return xboxIP.Equal(sample.SourceIP)
	}
	if c.cfg.XboxLANMAC != "" && sample.SourceMAC != "" {
		return normalizeMAC(c.cfg.XboxLANMAC) == normalizeMAC(sample.SourceMAC)
	}
	// During dry-run discovery we may not know the Xbox identity yet. Treat
	// Windows ICS clients as possible Xbox sources only when no manual identity
	// is configured; the remaining score still needs game-like behavior. This
	// avoids classifying normal PC traffic from the Starlink/mobile WAN subnets.
	return xboxIP == nil && c.cfg.XboxLANMAC == "" && isDefaultWindowsICSClient(sample.SourceIP)
}

func normalizeMAC(mac string) string {
	mac = strings.ToLower(strings.TrimSpace(mac))
	mac = strings.ReplaceAll(mac, "-", ":")
	return mac
}

func isDefaultWindowsICSClient(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	return ip4[0] == 192 && ip4[1] == 168 && ip4[2] == 137
}
