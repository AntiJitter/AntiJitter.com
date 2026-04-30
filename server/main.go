// AntiJitter Bonding Server
//
// Runs on the Germany VPS alongside WireGuard.
// Receives bonded UDP packets from clients over multiple paths (Starlink + 4G),
// deduplicates by sequence number, and forwards unique packets to the local
// WireGuard interface.
//
// Traffic flow:
//
//	Client (Starlink) ──┐
//	                     ├──→ :bondPort → dedup → 127.0.0.1:wgPort (WireGuard)
//	Client (4G/5G)   ──┘
//
// Multi-port: the server binds each requested port (e.g. 4567 and 443). Many
// mobile carriers block non-well-known UDP ports, so offering a 443 fallback
// keeps cellular uplinks reachable. All listeners share one dedup window and
// one WireGuard uplink; replies go back on the same listener the client's
// primary path used, so the NAT mapping the client created stays matched.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"antijitter.com/server/bonding"
)

type clientPath struct {
	addr     *net.UDPAddr
	conn     *net.UDPConn // listener this path's packets arrive on — replies go back through this conn
	lastSeen time.Time
}

type clientState struct {
	mu        sync.RWMutex
	paths     map[string]*clientPath // key = addr.String()
	dedup     bonding.Deduplicator
	replyMode replyMode
	primary   *clientPath // most recent path — used for replies
}

type replyMode string

const (
	replyModePrimary replyMode = "primary"
	replyModeAll     replyMode = "all"
	pathTTL                    = 30 * time.Second
	udpBufferBytes             = 4 * 1024 * 1024
	replyModePrefix            = "reply-mode:"
)

func main() {
	bondHosts := flag.String("bond-hosts", "0.0.0.0", "comma-separated local IPs to bind bonding listeners on")
	bondPorts := flag.String("bond-ports", "4567", "comma-separated UDP ports to receive bonded packets on (e.g. 4567,443)")
	wgHost := flag.String("wg-host", "127.0.0.1", "WireGuard listen address")
	wgPort := flag.Int("wg-port", 51820, "WireGuard listen port")
	replyModeFlag := flag.String("reply-mode", string(replyModePrimary), "reply path mode: primary or all")
	flag.Parse()

	hosts, err := parseHosts(*bondHosts)
	if err != nil {
		log.Fatalf("parse --bond-hosts: %v", err)
	}
	ports, err := parsePorts(*bondPorts)
	if err != nil {
		log.Fatalf("parse --bond-ports: %v", err)
	}
	mode, err := parseReplyMode(*replyModeFlag)
	if err != nil {
		log.Fatalf("parse --reply-mode: %v", err)
	}

	log.Printf("AntiJitter Bonding Server starting")
	for _, host := range hosts {
		for _, p := range ports {
			log.Printf("  Bond listen: %s:%d", host, p)
		}
	}
	log.Printf("  WireGuard:   %s:%d", *wgHost, *wgPort)
	log.Printf("  Reply mode:  %s", mode)

	// Start peer-management HTTP API if ADD_PEER_TOKEN is set
	if port, iface, token, enabled := getPeerAPIConfig(); enabled {
		go startPeerAPI(port, iface, token)
	} else {
		log.Printf("  Peer API:    disabled (set ADD_PEER_TOKEN to enable)")
	}

	// Open a listener per local host/port. Binding explicit public IPs matters
	// when clients connect to multiple VPS destination IPs: replies must use
	// the same source IP the client connected to.
	conns := make([]*net.UDPConn, 0, len(hosts)*len(ports))
	for _, host := range hosts {
		for _, port := range ports {
			addr, err := net.ResolveUDPAddr("udp", net.JoinHostPort(host, strconv.Itoa(port)))
			if err != nil {
				log.Fatal(err)
			}
			conn, err := net.ListenUDP("udp", addr)
			if err != nil {
				log.Fatalf("listen on %s: %v", addr, err)
			}
			tuneUDPBuffers(conn, fmt.Sprintf("bond listener %s", addr))
			defer conn.Close()
			conns = append(conns, conn)
		}
	}

	// Connect to local WireGuard
	wgAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("%s:%d", *wgHost, *wgPort))
	if err != nil {
		log.Fatal(err)
	}
	wgConn, err := net.DialUDP("udp", nil, wgAddr)
	if err != nil {
		log.Fatal(err)
	}
	tuneUDPBuffers(wgConn, "WireGuard uplink")
	defer wgConn.Close()

	clients := &sync.Map{}
	stats := &serverStats{}
	replySeq := &bonding.Sequencer{}

	// Goroutine: read replies from WireGuard → prepend a seq header → send back via
	// the client's primary path's listener. The client's runReplyLoop expects the
	// same [4-byte seq][payload] wire format for both directions; without the
	// header it strips 4 bytes of real WG ciphertext and the handshake silently
	// fails forever.
	go func() {
		payload := make([]byte, bonding.MaxPacketSize)
		for {
			n, err := wgConn.Read(payload)
			if err != nil {
				log.Printf("WG read error: %v", err)
				continue
			}
			framed := bonding.Encode(replySeq.Next(), payload[:n])

			clients.Range(func(_, v any) bool {
				cs := v.(*clientState)
				targets := replyTargets(cs, mode, time.Now())
				for _, target := range targets {
					if _, err := target.conn.WriteToUDP(framed, target.addr); err != nil {
						log.Printf("Reply write error to %s via :%d: %v", target.addr, localPort(target.conn), err)
					} else {
						stats.addReply()
					}
				}
				return true
			})
		}
	}()

	// One goroutine per listener — all share clients map, dedup, stats, wgConn
	var wg sync.WaitGroup
	for _, conn := range conns {
		wg.Add(1)
		go func(conn *net.UDPConn) {
			defer wg.Done()
			readLoop(conn, clients, stats, wgConn)
		}(conn)
	}
	log.Printf("Ready — waiting for client connections")
	wg.Wait()
}

// parseHosts splits "0.0.0.0,203.0.113.10" into bindable local IPs.
func parseHosts(s string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, part := range strings.Split(s, ",") {
		host := strings.TrimSpace(part)
		if host == "" {
			continue
		}
		if ip := net.ParseIP(host); ip == nil {
			return nil, fmt.Errorf("%q is not an IP address", host)
		}
		if !seen[host] {
			out = append(out, host)
			seen[host] = true
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no hosts given")
	}
	return out, nil
}

// parsePorts splits "4567,443" → [4567, 443].
func parsePorts(s string) ([]int, error) {
	var out []int
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		p, err := strconv.Atoi(part)
		if err != nil {
			return nil, fmt.Errorf("%q is not a number", part)
		}
		if p < 1 || p > 65535 {
			return nil, fmt.Errorf("port %d out of range", p)
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no ports given")
	}
	return out, nil
}

func parseReplyMode(s string) (replyMode, error) {
	switch replyMode(strings.ToLower(strings.TrimSpace(s))) {
	case replyModePrimary:
		return replyModePrimary, nil
	case replyModeAll:
		return replyModeAll, nil
	default:
		return "", fmt.Errorf("%q must be primary or all", s)
	}
}

func parseReplyModeControl(payload []byte) (replyMode, bool) {
	text := strings.TrimSpace(string(payload))
	if !strings.HasPrefix(text, replyModePrefix) {
		return "", false
	}
	mode, err := parseReplyMode(strings.TrimPrefix(text, replyModePrefix))
	if err != nil {
		log.Printf("Invalid reply-mode control %q: %v", text, err)
		return "", true
	}
	return mode, true
}

func replyTargets(cs *clientState, defaultMode replyMode, now time.Time) []*clientPath {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	mode := defaultMode
	if cs.replyMode != "" {
		mode = cs.replyMode
	}

	switch mode {
	case replyModeAll:
		targets := make([]*clientPath, 0, len(cs.paths))
		for _, path := range cs.paths {
			if path.conn == nil || now.Sub(path.lastSeen) > pathTTL {
				continue
			}
			targets = append(targets, path)
		}
		return targets
	default:
		if cs.primary == nil || cs.primary.conn == nil || now.Sub(cs.primary.lastSeen) > pathTTL {
			return nil
		}
		return []*clientPath{cs.primary}
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

func cleanupExpiredPathsLocked(cs *clientState, now time.Time) {
	for key, path := range cs.paths {
		if now.Sub(path.lastSeen) <= pathTTL {
			continue
		}
		delete(cs.paths, key)
		if cs.primary == path {
			cs.primary = nil
		}
		log.Printf("Expired path removed: %s", key)
	}
}

func readLoop(conn *net.UDPConn, clients *sync.Map, stats *serverStats, wgConn *net.UDPConn) {
	buf := make([]byte, bonding.MaxPacketSize+bonding.HeaderSize)
	for {
		n, remoteAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("Read error on %s: %v", conn.LocalAddr(), err)
			continue
		}

		seq, payload, ok := bonding.Decode(buf[:n])
		if !ok {
			continue
		}

		// Echo reachability probes back on the same listener so the client
		// sees the reply source match its destination.
		if seq == 0 && len(payload) >= 5 && string(payload[:5]) == "probe" {
			conn.WriteToUDP(buf[:n], remoteAddr)
			continue
		}

		// Single-client for now — in multi-user deployment we'd key by
		// WireGuard peer IP derived from handshake or auth token.
		cs := loadClient(clients)

		if seq == 0 {
			if mode, handled := parseReplyModeControl(payload); handled {
				if mode != "" {
					cs.mu.Lock()
					cs.replyMode = mode
					cs.mu.Unlock()
					log.Printf("Client reply mode set: %s from %s", mode, remoteAddr)
				}
				continue
			}
		}

		cs.mu.Lock()
		addrKey := remoteAddr.String()
		if _, exists := cs.paths[addrKey]; !exists {
			log.Printf("New path registered: %s via :%d", addrKey, localPort(conn))
		}
		cleanupExpiredPathsLocked(cs, time.Now())
		path := &clientPath{addr: remoteAddr, conn: conn, lastSeen: time.Now()}
		cs.paths[addrKey] = path
		cs.primary = path
		cs.mu.Unlock()

		if !cs.dedup.IsNew(seq) {
			stats.addDup()
			continue
		}

		stats.addUnique()

		if _, err := wgConn.Write(payload); err != nil {
			log.Printf("WG write error: %v", err)
		}
	}
}

func loadClient(clients *sync.Map) *clientState {
	key := "default"
	val, _ := clients.LoadOrStore(key, &clientState{
		paths: make(map[string]*clientPath),
	})
	return val.(*clientState)
}

func localPort(conn *net.UDPConn) int {
	if a, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return a.Port
	}
	return 0
}

type serverStats struct {
	mu      sync.Mutex
	unique  uint64
	dupes   uint64
	replies uint64
	lastLog time.Time
}

func (s *serverStats) addUnique() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.unique++
	s.maybeLog()
}

func (s *serverStats) addDup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dupes++
	s.maybeLog()
}

func (s *serverStats) addReply() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.replies++
	s.maybeLog()
}

func (s *serverStats) maybeLog() {
	if time.Since(s.lastLog) > 10*time.Second {
		total := s.unique + s.dupes
		if total > 0 {
			log.Printf("Stats: %d unique, %d dupes (%.0f%% redundancy), %d replies, %d total",
				s.unique, s.dupes,
				float64(s.dupes)/float64(total)*100,
				s.replies,
				total)
		}
		s.lastLog = time.Now()
	}
}
