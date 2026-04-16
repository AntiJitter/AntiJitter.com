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
	Name       string       // e.g. "Starlink", "4G"
	LocalAddr  string       // bind to this local IP (interface selection)
	conn       *net.UDPConn // outbound connection to server via this interface
	active     atomic.Bool
	bytesSent  atomic.Uint64
	packetsSent atomic.Uint64
	lastSend   atomic.Int64 // unix nano
}

// Config for the bonding client.
type Config struct {
	// ListenPort is the local UDP port that WireGuard connects to.
	// WireGuard Endpoint = 127.0.0.1:ListenPort
	ListenPort int

	// ServerAddr is the bonding server address (Germany VPS).
	ServerAddr string

	// Paths are the network interfaces to bond.
	Paths []PathConfig

	// DataLimitMB is the monthly 4G data cap (0 = unlimited).
	DataLimitMB int64
}

// PathConfig defines a single network path.
type PathConfig struct {
	Name      string // "Starlink", "4G"
	LocalAddr string // local IP of this interface, e.g. "192.168.1.100"
	IfIndex   int    // OS interface index — needed to force per-adapter egress
}

// Client is the bonding client.
type Client struct {
	cfg       Config
	seq       sequencer
	paths     []*Path
	localConn *net.UDPConn // receives from local WireGuard
	serverAddr *net.UDPAddr
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

// New creates a new bonding client.
func New(cfg Config) (*Client, error) {
	serverAddr, err := net.ResolveUDPAddr("udp", cfg.ServerAddr)
	if err != nil {
		return nil, fmt.Errorf("resolve server addr: %w", err)
	}

	return &Client{
		cfg:        cfg,
		serverAddr: serverAddr,
	}, nil
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

	// Create outbound connections for each path
	for _, pc := range c.cfg.Paths {
		path, err := c.createPath(pc)
		if err != nil {
			log.Printf("Warning: failed to create path %s (%s): %v", pc.Name, pc.LocalAddr, err)
			continue
		}
		c.paths = append(c.paths, path)
		log.Printf("Path ready: %s via %s", path.Name, path.LocalAddr)
	}

	if len(c.paths) == 0 {
		return fmt.Errorf("no paths available")
	}

	log.Printf("Bonding active: %d paths, server=%s, local=:%d",
		len(c.paths), c.cfg.ServerAddr, c.cfg.ListenPort)

	c.running.Store(true)

	// Periodic per-path send counters so we can see whether both paths
	// are actually writing packets, independent of what reaches the server.
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for c.running.Load() {
			<-ticker.C
			for _, p := range c.paths {
				log.Printf("path %s: sent=%d bytes=%d active=%v",
					p.Name, p.packetsSent.Load(), p.bytesSent.Load(), p.active.Load())
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
					n, err := path.conn.Read(buf)
					if err != nil {
						continue
					}
					if wgClientAddr != nil {
						c.localConn.WriteToUDP(buf[:n], wgClientAddr)
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

		// Send through ALL paths simultaneously
		for _, path := range c.paths {
			if !path.active.Load() {
				continue
			}
			_, err := path.conn.Write(encoded)
			if err != nil {
				log.Printf("Send error on %s: %v", path.Name, err)
				continue
			}
			path.packetsSent.Add(1)
			path.bytesSent.Add(uint64(len(encoded)))
			path.lastSend.Store(time.Now().UnixNano())

			// Track 4G data usage
			if path.Name != "Starlink" {
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
			Name:    p.Name,
			Active:  p.active.Load(),
			Packets: p.packetsSent.Load(),
			Bytes:   p.bytesSent.Load(),
		})
	}
	return stats
}

// PathStats for monitoring.
type PathStats struct {
	Name    string
	Active  bool
	Packets uint64
	Bytes   uint64
}

// GetDataLimitMB returns the configured 4G data limit in megabytes.
func (c *Client) GetDataLimitMB() int64 {
	return c.cfg.DataLimitMB
}

func (c *Client) createPath(pc PathConfig) (*Path, error) {
	localAddr, err := net.ResolveUDPAddr("udp", pc.LocalAddr+":0")
	if err != nil {
		return nil, err
	}
	conn, err := net.DialUDP("udp", localAddr, c.serverAddr)
	if err != nil {
		return nil, err
	}

	// Force egress through this specific adapter — otherwise Windows' route
	// table picks the default interface and both paths hit the same uplink.
	if pc.IfIndex > 0 {
		if err := bindSocketToInterface(conn, pc.IfIndex); err != nil {
			conn.Close()
			return nil, fmt.Errorf("bind to interface %d: %w", pc.IfIndex, err)
		}
	}

	p := &Path{
		Name:      pc.Name,
		LocalAddr: pc.LocalAddr,
		conn:      conn,
	}
	p.active.Store(true)
	return p, nil
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
