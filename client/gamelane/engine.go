package gamelane

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// Metrics are surfaced to the UI and logs. Counters are conservative until the
// WinDivert capture layer is wired in.
type Metrics struct {
	ActiveGameFlows                  uint64 `json:"active_game_flows"`
	CandidateFlows                   uint64 `json:"candidate_flows"`
	Promoted4GFlows                  uint64 `json:"promoted_4g_flows"`
	RejectedUDP443Flows              uint64 `json:"rejected_udp443_flows"`
	RejectedLargeUDPFlows            uint64 `json:"rejected_large_udp_flows"`
	MobileBytesTotal                 uint64 `json:"mobile_bytes_total"`
	MobileGameBytes                  uint64 `json:"mobile_game_bytes"`
	StarlinkBytesTotal               uint64 `json:"starlink_bytes_total"`
	EstimatedMobileDataSavedVsAllUDP uint64 `json:"estimated_mobile_data_saved_vs_all_udp"`
}

// Status describes the current GameLane engine state.
type Status struct {
	Enabled           bool    `json:"enabled"`
	DryRun            bool    `json:"dry_run"`
	Active            bool    `json:"active"`
	CaptureAvailable  bool    `json:"capture_available"`
	Message           string  `json:"message"`
	LANInterface      string  `json:"lan_interface"`
	StarlinkInterface string  `json:"starlink_interface"`
	MobileInterface   string  `json:"mobile_interface"`
	XboxLANIP         string  `json:"xbox_lan_ip"`
	XboxLANMAC        string  `json:"xbox_lan_mac"`
	Metrics           Metrics `json:"metrics"`
}

// Engine owns GameLane state. The first implementation is deliberately dry-run
// only because the repo does not yet vendor or install WinDivert.
type Engine struct {
	cfg              Config
	classifier       Classifier
	cancel           context.CancelFunc
	active           atomic.Bool
	mu               sync.RWMutex
	captureAvailable bool
	message          string
	flows            map[string]*flowState

	candidateFlows        atomic.Uint64
	activeGameFlows       atomic.Uint64
	promoted4GFlows       atomic.Uint64
	rejectedUDP443Flows   atomic.Uint64
	rejectedLargeUDPFlows atomic.Uint64
	mobileGameBytes       atomic.Uint64
	starlinkBytes         atomic.Uint64
	savedVsAllUDP         atomic.Uint64
}

func NewEngine(cfg Config) *Engine {
	return &Engine{
		cfg:        cfg,
		classifier: NewClassifier(cfg),
		flows:      make(map[string]*flowState),
	}
}

func (e *Engine) Start(ctx context.Context) error {
	runCtx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.active.Store(true)

	log.Printf("[GameLane] mode enabled dry_run=%v", e.cfg.DryRun)
	log.Printf("[GameLane] Xbox configured: ip=%q mac=%q", e.cfg.XboxLANIP, e.cfg.XboxLANMAC)
	log.Printf("[GameLane] LAN interface: %q", e.cfg.LANInterface)
	log.Printf("[GameLane] Starlink interface: %q", e.cfg.StarlinkInterface)
	log.Printf("[GameLane] 4G interface: %q", e.cfg.MobileInterface)
	result := startCapture(runCtx, e.handlePacket)
	e.mu.Lock()
	e.captureAvailable = result.Available
	e.message = result.Message
	e.mu.Unlock()
	log.Printf("[GameLane] capture status: available=%v message=%q", result.Available, result.Message)

	go e.healthLogLoop(runCtx)
	go e.cleanupLoop(runCtx)
	return nil
}

func (e *Engine) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
	e.active.Store(false)
	log.Printf("[GameLane] mode disabled")
}

func (e *Engine) Status() Status {
	e.mu.RLock()
	captureAvailable := e.captureAvailable
	message := e.message
	e.mu.RUnlock()
	return Status{
		Enabled:           e.cfg.Enabled,
		DryRun:            e.cfg.DryRun,
		Active:            e.active.Load(),
		CaptureAvailable:  captureAvailable,
		Message:           message,
		LANInterface:      e.cfg.LANInterface,
		StarlinkInterface: e.cfg.StarlinkInterface,
		MobileInterface:   e.cfg.MobileInterface,
		XboxLANIP:         e.cfg.XboxLANIP,
		XboxLANMAC:        e.cfg.XboxLANMAC,
		Metrics: Metrics{
			ActiveGameFlows:                  e.activeGameFlows.Load(),
			CandidateFlows:                   e.candidateFlows.Load(),
			Promoted4GFlows:                  e.promoted4GFlows.Load(),
			RejectedUDP443Flows:              e.rejectedUDP443Flows.Load(),
			RejectedLargeUDPFlows:            e.rejectedLargeUDPFlows.Load(),
			MobileBytesTotal:                 e.mobileGameBytes.Load(),
			MobileGameBytes:                  e.mobileGameBytes.Load(),
			StarlinkBytesTotal:               e.starlinkBytes.Load(),
			EstimatedMobileDataSavedVsAllUDP: e.savedVsAllUDP.Load(),
		},
	}
}

func (e *Engine) handlePacket(packet Packet) {
	now := time.Now()
	key := flowKey(packet)

	e.mu.Lock()
	flow := e.flows[key]
	if flow == nil {
		flow = &flowState{
			key:        key,
			sourceIP:   packet.SourceIP,
			destIP:     packet.DestIP,
			sourcePort: packet.SourcePort,
			destPort:   packet.DestPort,
			firstSeen:  now,
			lastSeen:   now,
		}
		e.flows[key] = flow
		e.candidateFlows.Add(1)
		log.Printf("[GameLane] flow candidate: src=%s:%d dst=%s:%d proto=UDP packet_size=%d",
			packet.SourceIP, packet.SourcePort, packet.DestIP, packet.DestPort, packet.Size)
	}
	flow.packets++
	flow.bytes += uint64(packet.Size)
	flow.lastSeen = now
	sample := flow.sample(e.cfg, packet, now)
	e.mu.Unlock()

	decision := e.classifier.Classify(sample)
	e.recordDecision(key, packet.Size, decision)
}

// ClassifyDryRun records what the capture layer would do for an observed flow.
func (e *Engine) ClassifyDryRun(sample FlowSample) Decision {
	decision := e.classifier.Classify(sample)
	if decision.PromoteTo4G {
		e.promoted4GFlows.Add(1)
		log.Printf("[GameLane] flow promoted to 4G: score=%d reasons=%v", decision.Score, decision.Reasons)
	} else {
		for _, reason := range decision.Reasons {
			if reasonHas(reason, "udp_443") {
				e.rejectedUDP443Flows.Add(1)
			}
			if reasonHas(reason, "large_udp_burst") {
				e.rejectedLargeUDPFlows.Add(1)
			}
		}
		log.Printf("[GameLane] flow defaulted to Starlink: score=%d reasons=%v", decision.Score, decision.Reasons)
	}
	return decision
}

func (e *Engine) recordDecision(key string, packetSize int, decision Decision) {
	e.mu.Lock()
	defer e.mu.Unlock()
	flow := e.flows[key]
	if flow == nil {
		return
	}
	e.starlinkBytes.Add(uint64(packetSize))
	if decision.PromoteTo4G {
		e.mobileGameBytes.Add(uint64(packetSize))
		e.savedVsAllUDP.Add(0)
		if !flow.promoted {
			flow.promoted = true
			e.promoted4GFlows.Add(1)
			e.activeGameFlows.Add(1)
			log.Printf("[GameLane] flow promoted to 4G: src=%s:%d dst=%s:%d score=%d reason=%s",
				flow.sourceIP, flow.sourcePort, flow.destIP, flow.destPort, decision.Score, explainDecision(decision))
		}
		return
	}
	e.savedVsAllUDP.Add(uint64(packetSize))
	if flow.rejectedLogged {
		return
	}
	flow.rejectedLogged = true
	for _, reason := range decision.Reasons {
		if reasonHas(reason, "udp_443") {
			e.rejectedUDP443Flows.Add(1)
		}
		if reasonHas(reason, "large_udp_burst") {
			e.rejectedLargeUDPFlows.Add(1)
		}
	}
	log.Printf("[GameLane] flow rejected/defaulted to Starlink: src=%s:%d dst=%s:%d score=%d reason=%s",
		flow.sourceIP, flow.sourcePort, flow.destIP, flow.destPort, decision.Score, explainDecision(decision))
}

func (e *Engine) healthLogLoop(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			status := e.Status()
			log.Printf("[GameLane] dry-run status: candidates=%d promoted=%d rejected_udp443=%d rejected_large_udp=%d",
				status.Metrics.CandidateFlows,
				status.Metrics.Promoted4GFlows,
				status.Metrics.RejectedUDP443Flows,
				status.Metrics.RejectedLargeUDPFlows)
		}
	}
}

func (e *Engine) cleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	timeout := e.cfg.FlowIdleTimeout
	if timeout == 0 {
		timeout = DefaultConfig().FlowIdleTimeout
	}
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			e.mu.Lock()
			for key, flow := range e.flows {
				if now.Sub(flow.lastSeen) > timeout {
					if flow.promoted {
						e.activeGameFlows.Add(^uint64(0))
					}
					delete(e.flows, key)
				}
			}
			e.mu.Unlock()
		}
	}
}

type flowState struct {
	key            string
	sourceIP       net.IP
	destIP         net.IP
	sourcePort     uint16
	destPort       uint16
	firstSeen      time.Time
	lastSeen       time.Time
	bytes          uint64
	packets        uint64
	promoted       bool
	rejectedLogged bool
}

func (f *flowState) sample(cfg Config, packet Packet, now time.Time) FlowSample {
	age := now.Sub(f.firstSeen)
	var bitrate int64
	if age > 0 {
		bitrate = int64(float64(f.bytes*8) / age.Seconds())
	}
	return FlowSample{
		SourceIP:       packet.SourceIP,
		DestIP:         packet.DestIP,
		Protocol:       packet.Protocol,
		DestPort:       packet.DestPort,
		PacketSize:     packet.Size,
		FlowBitrateBPS: bitrate,
		FlowAge:        age,
		StableInterval: f.packets >= 5 && age >= cfg.MinFlowAge,
	}
}

func flowKey(packet Packet) string {
	return fmt.Sprintf("%s:%d>%s:%d/%s", packet.SourceIP, packet.SourcePort, packet.DestIP, packet.DestPort, packet.Protocol)
}

func explainDecision(decision Decision) string {
	if len(decision.Reasons) == 0 {
		return "no_reason"
	}
	return decision.Reasons[len(decision.Reasons)-1]
}

func reasonHas(reason, needle string) bool {
	return len(reason) >= len(needle) && (reason == needle || contains(reason, needle))
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
