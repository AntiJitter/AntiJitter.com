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
// WireGuard replies go back through the most recently active client path.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"antijitter.com/server/bonding"
)

type clientPath struct {
	addr     *net.UDPAddr
	lastSeen time.Time
}

type clientState struct {
	mu      sync.RWMutex
	paths   map[string]*clientPath // key = addr.String()
	dedup   bonding.Deduplicator
	primary *net.UDPAddr // most recent path — used for replies
}

func main() {
	bondPort := flag.Int("bond-port", 4567, "UDP port to receive bonded packets from clients")
	wgHost := flag.String("wg-host", "127.0.0.1", "WireGuard listen address")
	wgPort := flag.Int("wg-port", 51820, "WireGuard listen port")
	flag.Parse()

	log.Printf("AntiJitter Bonding Server starting")
	log.Printf("  Bond listen: 0.0.0.0:%d", *bondPort)
	log.Printf("  WireGuard:   %s:%d", *wgHost, *wgPort)

	// Listen for bonded client packets
	bondAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("0.0.0.0:%d", *bondPort))
	if err != nil {
		log.Fatal(err)
	}
	bondConn, err := net.ListenUDP("udp", bondAddr)
	if err != nil {
		log.Fatal(err)
	}
	defer bondConn.Close()

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

	// Track clients by their WireGuard peer IP (extracted from first packets)
	clients := &sync.Map{}
	stats := &serverStats{}

	// Goroutine: read replies from WireGuard → send back to client's primary path
	go func() {
		buf := make([]byte, bonding.MaxPacketSize)
		for {
			n, err := wgConn.Read(buf)
			if err != nil {
				log.Printf("WG read error: %v", err)
				continue
			}

			// Send reply to ALL known client primary paths
			// (In production with multiple clients, we'd route by peer IP)
			clients.Range(func(_, v any) bool {
				cs := v.(*clientState)
				cs.mu.RLock()
				primary := cs.primary
				cs.mu.RUnlock()
				if primary != nil {
					bondConn.WriteToUDP(buf[:n], primary)
				}
				return true
			})
		}
	}()

	// Main loop: read bonded packets from clients
	buf := make([]byte, bonding.MaxPacketSize+bonding.HeaderSize)
	log.Printf("Ready — waiting for client connections")

	for {
		n, remoteAddr, err := bondConn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("Read error: %v", err)
			continue
		}

		seq, payload, ok := bonding.Decode(buf[:n])
		if !ok {
			continue // malformed
		}

		// Get or create client state (keyed by "client" for now — single client)
		// Multi-client: key by WireGuard handshake or auth token
		key := "default"
		val, _ := clients.LoadOrStore(key, &clientState{
			paths: make(map[string]*clientPath),
		})
		cs := val.(*clientState)

		// Register this path
		cs.mu.Lock()
		addrKey := remoteAddr.String()
		if _, exists := cs.paths[addrKey]; !exists {
			log.Printf("New path registered: %s", addrKey)
		}
		cs.paths[addrKey] = &clientPath{addr: remoteAddr, lastSeen: time.Now()}
		cs.primary = remoteAddr // most recent = primary for replies
		cs.mu.Unlock()

		// Deduplicate
		if !cs.dedup.IsNew(seq) {
			stats.addDup()
			continue // duplicate — already forwarded via another path
		}

		stats.addUnique()

		// Forward unique packet to WireGuard
		_, err = wgConn.Write(payload)
		if err != nil {
			log.Printf("WG write error: %v", err)
		}
	}
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
