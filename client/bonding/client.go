// Package bonding implements the client-side multi-path UDP sender.
//
// It listens for WireGuard packets on a local UDP port, wraps them with
// a sequence number, and sends each packet out through ALL configured
// network interfaces simultaneously.
//
// If Starlink drops during a satellite handoff, the 4G copy of the same
// packet arrives at the server. The server deduplicates. Zero packet loss.
package bonding

import (
	"fmt"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// Path represents a single network interface/connection to the bonding server.
type Path struct {
	Name        string       // e.g. "Starlink", "4G"
	LocalAddr   string       // bind to this local IP (interface selection)
	conn        *net.UDPConn // unconnected socket — use WriteTo/ReadFrom
	serverAddr  *net.UDPAddr // remote bonding server for this path
	connected   bool
	active      atomic.Bool
	bytesSent   atomic.Uint64
	bytesRecv   atomic.Uint64
	packetsSent atomic.Uint64
	packetsRecv atomic.Uint64
	sendErrors  atomic.Uint64
	lastSend    atomic.Int64 // unix nano
	probeSent   atomic.Int64 // unix nano
	latencyUs   atomic.Int64
	jitterUs    atomic.Int64
	metered     bool
}

// Config for the bonding client.
type Config struct {
	// ListenPort is the local UDP port that WireGuard connects to.
	// WireGuard Endpoint = 127.0.0.1:ListenPort
	ListenPort int

	// Paths are the network interfaces to bond. Each path carries its own
	// bonding-server address so different paths can use different server
	// ports (e.g. 4567 for Starlink, 443 for a carrier that blocks 4567).
	Paths []PathConfig

	// DataLimitMB is the monthly 4G data cap (0 = unlimited).
	DataLimitMB int64

	// ReplyMode asks the bonding server how to send downlink replies for this
	// client. "primary" saves secondary/mobile data; "all" races replies over
	// every registered path for gaming and Windows gateway testing.
	ReplyMode string

	// SendMode controls uplink fan-out from WireGuard to the physical paths.
	// "primary" sends normal traffic on the first active path to preserve
	// mobile data; "all" duplicates every packet for gaming.
	SendMode string
}

// PathConfig defines a single network path.
type PathConfig struct {
	Name         string // "Starlink", "4G"
	LocalAddr    string // local IP of this interface, e.g. "192.168.1.100"
	IfIndex      int    // OS interface index — needed to force per-adapter egress
	ServerAddr   string // bonding server "host:port" for this path
	Connected    bool   // use connected UDP instead of WriteToUDP
	PrepareRoute func() func()
	Metered      bool // counts against the mobile-data budget
}

// Client is the bonding client.
type Client struct {
	cfg       Config
	seq       sequencer
	paths     []*Path
	localConn *net.UDPConn // receives from local WireGuard
	mu        sync.RWMutex
	running   atomic.Bool

	// Stats
	TotalPackets atomic.Uint64
	TotalBytes   atomic.Uint64
	DataUsed4G   atomic.Uint64 // bytes sent over 4G paths (for data limit tracking)
}

type sequencer struct {
	mu  sync.Mutex
	seq uint32
}

func (s *sequencer) next() uint32 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	return s.seq
}

const headerSize = 4 // 4-byte sequence number

const udpBufferBytes = 4 * 1024 * 1024

const (
	ReplyModePrimary = "primary"
	ReplyModeAll     = "all"
	SendModePrimary  = "primary"
	SendModeAll      = "all"
)

// New creates a new bonding client.
func New(cfg Config) (*Client, error) {
	return &Client{cfg: cfg}, nil
}

// Start begins bonding. Blocks until Stop() is called.
func (c *Client) Start() error {
	// Listen locally for WireGuard packets
	listenAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("127.0.0.1:%d", c.cfg.ListenPort))
	if err != nil {
		return err
	}
	c.localConn, err = net.ListenUDP("udp", listenAddr)
	if err != nil {
		return fmt.Errorf("listen on :%d: %w", c.cfg.ListenPort, err)
	}
	defer c.localConn.Close()
	tuneUDPBuffers(c.localConn, "local WireGuard listener")

	// Create outbound connections for each path
	for _, pc := range c.cfg.Paths {
		var restoreRoute func()
		if pc.PrepareRoute != nil {
			restoreRoute = pc.PrepareRoute()
		}
		path, err := c.createPath(pc)
		if restoreRoute != nil {
			restoreRoute()
		}
		if err != nil {
			log.Printf("Warning: failed to create path %s (%s): %v", pc.Name, pc.LocalAddr, err)
			continue
		}
		c.paths = append(c.paths, path)
		log.Printf("Path ready: %s via %s → %s", path.Name, path.LocalAddr, path.serverAddr)
	}

	if len(c.paths) == 0 {
		return fmt.Errorf("no paths available")
	}
	c.sendReplyModeControl()

	if c.cfg.SendMode == "" {
		c.cfg.SendMode = SendModeAll
	}
	log.Printf("Bonding active: %d paths, local=:%d send_mode=%s reply_mode=%s",
		len(c.paths), c.cfg.ListenPort, c.cfg.SendMode, c.cfg.ReplyMode)

	c.running.Store(true)
	go c.probeLoop()

	// Periodic per-path send counters so we can see whether both paths
	// are actually writing packets, independent of what reaches the server.
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if !c.running.Load() {
				return
			}
			log.Printf("path counters: total_packets=%d total_payload_bytes=%d",
				c.TotalPackets.Load(), c.TotalBytes.Load())
			for _, p := range c.paths {
				log.Printf("path counters: name=%q sent_packets=%d sent_bytes=%d recv_packets=%d recv_bytes=%d send_errors=%d connected=%v active=%v",
					p.Name, p.packetsSent.Load(), p.bytesSent.Load(), p.packetsRecv.Load(), p.bytesRecv.Load(), p.sendErrors.Load(), p.connected, p.active.Load())
			}
		}
	}()

	// Goroutine: receive replies from server → forward to local WireGuard
	var wgClientAddr *net.UDPAddr
	go func() {
		for _, p := range c.paths {
			go func(path *Path) {
				buf := make([]byte, 1500)
				for c.running.Load() {
					path.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
					n, err := readPath(path, buf)
					if err != nil {
						continue
					}
					if n <= headerSize {
						continue
					}
					seq := decodeSeq(buf[:n])
					if seq == 0 && string(buf[headerSize:n]) == "probe" {
						path.recordProbeReply(time.Now())
						continue
					}
					path.packetsRecv.Add(1)
					path.bytesRecv.Add(uint64(n))
					// Strip the 4-byte seq header the server now prepends
					payload := buf[headerSize:n]
					if wgClientAddr != nil {
						c.localConn.WriteToUDP(payload, wgClientAddr)
					}
				}
			}(p)
		}
	}()

	// Main loop: read from WireGuard → send through all paths
	buf := make([]byte, 1500)
	for c.running.Load() {
		c.localConn.SetReadDeadline(time.Now().Add(5 * time.Second))
		n, addr, err := c.localConn.ReadFromUDP(buf)
		if err != nil {
			continue
		}
		wgClientAddr = addr // remember WireGuard's source address for replies

		// Wrap with sequence number
		seq := c.seq.next()
		encoded := encode(seq, buf[:n])

		c.TotalPackets.Add(1)
		c.TotalBytes.Add(uint64(n))

		for _, path := range c.sendTargets() {
			if !path.active.Load() {
				continue
			}
			err := writePath(path, encoded)
			if err != nil {
				path.sendErrors.Add(1)
				log.Printf("Send error on %s: %v", path.Name, err)
				continue
			}
			path.packetsSent.Add(1)
			path.bytesSent.Add(uint64(len(encoded)))
			path.lastSend.Store(time.Now().UnixNano())

			// Track metered uplink usage for mobile-data budgeting.
			if path.metered {
				c.DataUsed4G.Add(uint64(len(encoded)))
			}
		}

		// Check 4G data limit
		if c.cfg.DataLimitMB > 0 {
			usedMB := int64(c.DataUsed4G.Load()) / (1024 * 1024)
			if usedMB >= c.cfg.DataLimitMB {
				c.disable4GPaths()
			}
		}
	}

	return nil
}

func (c *Client) sendTargets() []*Path {
	if c.cfg.SendMode != SendModePrimary {
		return c.paths
	}
	for _, path := range c.paths {
		if path.active.Load() {
			return []*Path{path}
		}
	}
	return nil
}

func (c *Client) probeLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for c.running.Load() {
		for _, path := range c.paths {
			if !path.active.Load() {
				continue
			}
			path.probeSent.Store(time.Now().UnixNano())
			if err := writePath(path, encode(0, []byte("probe"))); err != nil {
				path.sendErrors.Add(1)
			}
		}
		<-ticker.C
	}
}

// Stop gracefully stops bonding.
func (c *Client) Stop() {
	c.running.Store(false)
	if c.localConn != nil {
		c.localConn.Close()
	}
	for _, p := range c.paths {
		if p.conn != nil {
			p.conn.Close()
		}
	}
	log.Printf("Bonding stopped")
}

// Stats returns current path statistics.
func (c *Client) Stats() []PathStats {
	var stats []PathStats
	for _, p := range c.paths {
		stats = append(stats, PathStats{
			Name:       p.Name,
			Active:     p.active.Load(),
			Packets:    p.packetsSent.Load(),
			Bytes:      p.bytesSent.Load(),
			RxPackets:  p.packetsRecv.Load(),
			RxBytes:    p.bytesRecv.Load(),
			SendErrors: p.sendErrors.Load(),
			LatencyMS:  float64(p.latencyUs.Load()) / 1000,
			JitterMS:   float64(p.jitterUs.Load()) / 1000,
		})
	}
	return stats
}

// PathStats for monitoring.
type PathStats struct {
	Name       string
	Active     bool
	Packets    uint64
	Bytes      uint64
	RxPackets  uint64
	RxBytes    uint64
	SendErrors uint64
	LatencyMS  float64
	JitterMS   float64
}

// GetDataLimitMB returns the configured 4G data limit in megabytes.
func (c *Client) GetDataLimitMB() int64 {
	return c.cfg.DataLimitMB
}

func (c *Client) sendReplyModeControl() {
	if c.cfg.ReplyMode == "" {
		return
	}
	control := encode(0, []byte("reply-mode:"+c.cfg.ReplyMode))
	for _, path := range c.paths {
		if err := writePath(path, control); err != nil {
			log.Printf("Warning: send reply-mode control on %s failed: %v", path.Name, err)
		}
	}
	log.Printf("Requested bonding server reply mode: %s", c.cfg.ReplyMode)
}

func (c *Client) createPath(pc PathConfig) (*Path, error) {
	var (
		conn       *net.UDPConn
		serverAddr *net.UDPAddr
		err        error
	)
	if pc.Connected {
		conn, err = DialUDPViaInterface(pc.ServerAddr, pc.LocalAddr, pc.IfIndex, 8*time.Second)
		if err != nil {
			return nil, err
		}
		var ok bool
		serverAddr, ok = conn.RemoteAddr().(*net.UDPAddr)
		if !ok {
			conn.Close()
			return nil, fmt.Errorf("connected remote is %T, want *net.UDPAddr", conn.RemoteAddr())
		}
	} else {
		conn, serverAddr, err = ListenUDPViaInterface(pc.ServerAddr, pc.LocalAddr, pc.IfIndex)
		if err != nil {
			return nil, err
		}
	}
	tuneUDPBuffers(conn, pc.Name)

	p := &Path{
		Name:       pc.Name,
		LocalAddr:  pc.LocalAddr,
		conn:       conn,
		serverAddr: serverAddr,
		connected:  pc.Connected,
		metered:    pc.Metered,
	}
	p.active.Store(true)
	return p, nil
}

func writePath(path *Path, payload []byte) error {
	if path.connected {
		_, err := path.conn.Write(payload)
		return err
	}
	_, err := path.conn.WriteToUDP(payload, path.serverAddr)
	return err
}

func readPath(path *Path, buf []byte) (int, error) {
	if path.connected {
		return path.conn.Read(buf)
	}
	n, _, err := path.conn.ReadFromUDP(buf)
	return n, err
}

func (p *Path) recordProbeReply(now time.Time) {
	sent := p.probeSent.Load()
	if sent == 0 {
		return
	}
	rttUs := now.Sub(time.Unix(0, sent)).Microseconds()
	if rttUs <= 0 {
		return
	}
	prev := p.latencyUs.Swap(rttUs)
	if prev > 0 {
		diff := rttUs - prev
		if diff < 0 {
			diff = -diff
		}
		oldJitter := p.jitterUs.Load()
		if oldJitter == 0 {
			p.jitterUs.Store(diff)
		} else {
			p.jitterUs.Store((oldJitter*3 + diff) / 4)
		}
	}
}

func tuneUDPBuffers(conn *net.UDPConn, label string) {
	if err := conn.SetReadBuffer(udpBufferBytes); err != nil {
		log.Printf("Warning: set UDP read buffer for %s failed: %v", label, err)
	}
	if err := conn.SetWriteBuffer(udpBufferBytes); err != nil {
		log.Printf("Warning: set UDP write buffer for %s failed: %v", label, err)
	}
}

func (c *Client) disable4GPaths() {
	for _, p := range c.paths {
		if p.Name != "Starlink" && p.active.Load() {
			p.active.Store(false)
			log.Printf("4G data limit reached — disabled path: %s", p.Name)
		}
	}
}

// encode prepends a 4-byte big-endian sequence number to the payload.
func encode(seq uint32, payload []byte) []byte {
	buf := make([]byte, headerSize+len(payload))
	buf[0] = byte(seq >> 24)
	buf[1] = byte(seq >> 16)
	buf[2] = byte(seq >> 8)
	buf[3] = byte(seq)
	copy(buf[headerSize:], payload)
	return buf
}

func decodeSeq(packet []byte) uint32 {
	if len(packet) < headerSize {
		return 0
	}
	return uint32(packet[0])<<24 | uint32(packet[1])<<16 | uint32(packet[2])<<8 | uint32(packet[3])
}
