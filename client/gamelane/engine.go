package gamelane

import (
	"context"
	"log"
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
	cfg        Config
	classifier Classifier
	cancel     context.CancelFunc
	active     atomic.Bool
	mu         sync.RWMutex

	candidateFlows        atomic.Uint64
	promoted4GFlows       atomic.Uint64
	rejectedUDP443Flows   atomic.Uint64
	rejectedLargeUDPFlows atomic.Uint64
}

func NewEngine(cfg Config) *Engine {
	return &Engine{
		cfg:        cfg,
		classifier: NewClassifier(cfg),
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
	log.Printf("[GameLane] WinDivert capture/steering not active yet; classifier dry-run scaffold is running")

	go e.healthLogLoop(runCtx)
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
	return Status{
		Enabled:           e.cfg.Enabled,
		DryRun:            e.cfg.DryRun,
		Active:            e.active.Load(),
		CaptureAvailable:  false,
		Message:           "Dry-run classifier ready. Active WinDivert steering is not enabled in this build.",
		LANInterface:      e.cfg.LANInterface,
		StarlinkInterface: e.cfg.StarlinkInterface,
		MobileInterface:   e.cfg.MobileInterface,
		XboxLANIP:         e.cfg.XboxLANIP,
		XboxLANMAC:        e.cfg.XboxLANMAC,
		Metrics: Metrics{
			CandidateFlows:        e.candidateFlows.Load(),
			Promoted4GFlows:       e.promoted4GFlows.Load(),
			RejectedUDP443Flows:   e.rejectedUDP443Flows.Load(),
			RejectedLargeUDPFlows: e.rejectedLargeUDPFlows.Load(),
		},
	}
}

// ClassifyDryRun records what the capture layer would do for an observed flow.
func (e *Engine) ClassifyDryRun(sample FlowSample) Decision {
	decision := e.classifier.Classify(sample)
	e.candidateFlows.Add(1)
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
