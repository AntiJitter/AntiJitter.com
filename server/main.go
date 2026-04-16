// AntiJitter Bonding Server
//
// Runs on the Germany VPS alongside WireGuard.
// Receives bonded UDP packets from clients over multiple paths (Starlink + 4G),
// deduplicates by sequence number, and forwards unique packets to the local
// WireGuard interface.
//
// Traffic flow:
//   Client (Starlink) ──┐
//                        ├──→ :bondPort → dedup → 127.0.0.1:wgPort (WireGuard)
//   Client (4G/5G)   ──┘
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
	mu      sync.RWMutex
	paths   map[string]*clientPath // key = addr.String()
	dedup   bonding.Deduplicator
	primary *clientPath // most recent path — used for replies
}

func main() {
	bondPorts := flag.String("bond-ports", "4567", "comma-separated UDP ports to receive bonded packets on (e.g. 4567,443)")
	wgHost := flag.String("wg-host", "127.0.0.1", "WireGuard listen address")
	wgPort := flag.Int("wg-port", 51820, "WireGuard listen port")
	flag.Parse()

	ports, err := parsePorts(*bondPorts)
	if err != nil {
		log.Fatalf("parse --bond-ports: %v", err)
	}

	log.Printf("AntiJitter Bonding Server starting")
	for _, p := range ports {
		log.Printf("  Bond listen: 0.0.0.0:%d", p)
	}
	log.Printf("  WireGuard:   %s:%d", *wgHost, *wgPort)

	// Start peer-management HTTP API if ADD_PEER_TOKEN is set
	if port, iface, token, enabled := getPeerAPIConfig(); enabled {
		go startPeerAPI(port, iface, token)
	} else {
		log.Printf("  Peer API:    disabled (set ADD_PEER_TOKEN to enable)")
	}

	// Open a listener per bond port
	conns := make([]*net.UDPConn, 0, len(ports))
	for _, port := range ports {
		addr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("0.0.0.0:%d", port))
		if err != nil {
			log.Fatal(err)
		}
		conn, err := net.ListenUDP("udp", addr)
		if err != nil {
			log.Fatalf("listen on :%d: %v", port, err)
		}
		defer conn.Close()
		conns = append(conns, conn)
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
	defer wgConn.Close()

	clients := &sync.Map{}
	stats := &serverStats{}

	// Goroutine: read replies from WireGuard → send back via the client's primary path's listener
	go func() {
		buf := make([]byte, bonding.MaxPacketSize)
		for {
			n, err := wgConn.Read(buf)
			if err != nil {
				log.Printf("WG read error: %v", err)
				continue
			}

			clients.Range(func(_, v any) bool {
				cs := v.(*clientState)
				cs.mu.RLock()
				primary := cs.primary
				cs.mu.RUnlock()
				if primary != nil && primary.conn != nil {
					primary.conn.WriteToUDP(buf[:n], primary.addr)
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
		key := "default"
		val, _ := clients.LoadOrStore(key, &clientState{
			paths: make(map[string]*clientPath),
		})
		cs := val.(*clientState)

		cs.mu.Lock()
		addrKey := remoteAddr.String()
		if _, exists := cs.paths[addrKey]; !exists {
			log.Printf("New path registered: %s via :%d", addrKey, localPort(conn))
		}
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

func (s *serverStats) maybeLog() {
	if time.Since(s.lastLog) > 10*time.Second {
		total := s.unique + s.dupes
		if total > 0 {
			log.Printf("Stats: %d unique, %d dupes (%.0f%% redundancy), %d total",
				s.unique, s.dupes,
				float64(s.dupes)/float64(total)*100,
				total)
		}
		s.lastLog = time.Now()
	}
}
