package gamelane

import (
	"net"
	"time"
)

// PortRange is inclusive.
type PortRange struct {
	From uint16 `json:"from"`
	To   uint16 `json:"to"`
}

// Config controls GameLane 4G gateway behavior.
type Config struct {
	Enabled              bool          `json:"enabled"`
	XboxLANIP            string        `json:"xbox_lan_ip"`
	XboxLANMAC           string        `json:"xbox_lan_mac"`
	LANInterface         string        `json:"lan_interface"`
	StarlinkInterface    string        `json:"starlink_interface"`
	MobileInterface      string        `json:"mobile_interface"`
	GameUDPPorts         []PortRange   `json:"game_udp_ports"`
	ExcludeUDPPorts      []uint16      `json:"exclude_udp_ports"`
	MaxGamePacketSize    int           `json:"max_game_packet_size_bytes"`
	MaxGameFlowBitrate   int64         `json:"max_game_flow_bitrate_bps"`
	MinFlowAge           time.Duration `json:"min_flow_age_ms"`
	FlowIdleTimeout      time.Duration `json:"flow_idle_timeout_sec"`
	DryRun               bool          `json:"dry_run"`
	AllowVoiceUDP        bool          `json:"allow_voice_udp"`
	BlockNonGameOnMobile bool          `json:"block_non_game_on_mobile"`
	TelemetryEnabled     bool          `json:"telemetry_enabled"`
	PromoteScore         int           `json:"promote_score"`
}

// DefaultConfig returns a conservative classifier. DryRun defaults to true
// until WinDivert steering is explicitly enabled in a later step.
func DefaultConfig() Config {
	return Config{
		Enabled: true,
		GameUDPPorts: []PortRange{
			{From: 88, To: 88},
			{From: 500, To: 500},
			{From: 3074, To: 3076},
			{From: 3477, To: 3480},
			{From: 3544, To: 3544},
			{From: 4500, To: 4500},
			{From: 7777, To: 7777},
			{From: 27015, To: 27016},
			{From: 30000, To: 45000},
		},
		ExcludeUDPPorts:      []uint16{443},
		MaxGamePacketSize:    600,
		MaxGameFlowBitrate:   1_500_000,
		MinFlowAge:           500 * time.Millisecond,
		FlowIdleTimeout:      30 * time.Second,
		DryRun:               true,
		AllowVoiceUDP:        false,
		BlockNonGameOnMobile: true,
		TelemetryEnabled:     true,
		PromoteScore:         80,
	}
}

func (c Config) xboxIP() net.IP {
	if c.XboxLANIP == "" {
		return nil
	}
	return net.ParseIP(c.XboxLANIP)
}

func (c Config) isExcludedUDPPort(port uint16) bool {
	for _, excluded := range c.ExcludeUDPPorts {
		if port == excluded {
			return true
		}
	}
	return false
}

func (c Config) isGamePort(port uint16) bool {
	for _, r := range c.GameUDPPorts {
		if r.From <= port && port <= r.To {
			return true
		}
	}
	return false
}
