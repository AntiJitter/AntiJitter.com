// Package bonding implements multi-path UDP packet bonding.
//
// Architecture:
//
//	[WireGuard Client] → [Bonding Client] →→ Starlink →→ [Bonding Server] → [WireGuard Server]
//	                                       →→ 4G/5G  →→
//
// Each outgoing UDP packet gets a 4-byte sequence number header prepended.
// The client sends each packet out through ALL available network interfaces.
// The server deduplicates by sequence number and forwards unique packets.
// Result: if Starlink drops during a handoff, 4G delivers the same packet.
package bonding

import (
	"encoding/binary"
	"sync"
	"time"
)

const (
	// HeaderSize is the 4-byte sequence number prepended to each packet.
	HeaderSize = 4

	// MaxPacketSize for game UDP traffic (WireGuard encapsulated).
	MaxPacketSize = 1500

	// DedupeWindowSize tracks this many recent sequence numbers.
	DedupeWindowSize = 4096
)

// Packet is a bonding-wrapped UDP packet: [4-byte seq][payload].
type Packet struct {
	Seq     uint32
	Payload []byte
}

// Encode prepends the sequence number to the payload.
func Encode(seq uint32, payload []byte) []byte {
	buf := make([]byte, HeaderSize+len(payload))
	binary.BigEndian.PutUint32(buf[:HeaderSize], seq)
	copy(buf[HeaderSize:], payload)
	return buf
}

// Decode extracts the sequence number and payload.
func Decode(data []byte) (seq uint32, payload []byte, ok bool) {
	if len(data) < HeaderSize {
		return 0, nil, false
	}
	seq = binary.BigEndian.Uint32(data[:HeaderSize])
	payload = data[HeaderSize:]
	return seq, payload, true
}

// Deduplicator tracks seen sequence numbers using a sliding window.
// Thread-safe. O(1) lookups.
type Deduplicator struct {
	mu       sync.Mutex
	seen     [DedupeWindowSize]bool
	minSeq   uint32
	maxSeen  uint32
	lastPkt  time.Time
}

// sessionRestartThreshold — if we see a seq this far below maxSeen, the
// client has restarted and reset its sequencer. Clear state and accept
// the packet as fresh. Needs to be large enough that reordered packets
// within the window don't trigger a reset, but small enough to notice
// a restart quickly. 4 * window ≈ 16k packets.
const sessionRestartThreshold = DedupeWindowSize * 4

// sessionIdleTimeout — if no packet has arrived for this long, assume the
// client restarted and clear state. Catches the case where the previous
// session was short (maxSeen < sessionRestartThreshold), so the seq-gap
// check can't fire and old bits would poison the new session's low seqs.
const sessionIdleTimeout = 10 * time.Second

// IsNew returns true if this sequence number hasn't been seen before.
// Must be called for every arriving packet to advance the window.
func (d *Deduplicator) IsNew(seq uint32) bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now()

	// Time-based restart detection — handles short prior sessions where the
	// seq-gap check below can't fire. Any gap this long means the client
	// is almost certainly a fresh session starting from seq=1.
	if !d.lastPkt.IsZero() && now.Sub(d.lastPkt) > sessionIdleTimeout {
		for i := range d.seen {
			d.seen[i] = false
		}
		d.minSeq = 0
		d.maxSeen = 0
	}
	d.lastPkt = now

	// Seq-gap restart detection — for fast restarts with no idle gap, after
	// a long-running prior session (maxSeen past the threshold).
	if d.maxSeen > sessionRestartThreshold && seq+sessionRestartThreshold < d.maxSeen {
		for i := range d.seen {
			d.seen[i] = false
		}
		d.minSeq = 0
		d.maxSeen = 0
	}

	// Packet too old — behind our window
	if seq < d.minSeq {
		return false
	}

	// Packet too far ahead — advance the window
	idx := seq % DedupeWindowSize
	if seq >= d.minSeq+DedupeWindowSize {
		// Clear stale entries and advance
		newMin := seq - DedupeWindowSize + 1
		for i := d.minSeq; i < newMin && i < d.minSeq+DedupeWindowSize; i++ {
			d.seen[i%DedupeWindowSize] = false
		}
		d.minSeq = newMin
	}

	if d.seen[idx] {
		return false // duplicate
	}
	d.seen[idx] = true
	if seq > d.maxSeen {
		d.maxSeen = seq
	}
	return true
}

// Sequencer generates incrementing sequence numbers. Thread-safe.
type Sequencer struct {
	mu  sync.Mutex
	seq uint32
}

// Next returns the next sequence number.
func (s *Sequencer) Next() uint32 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	return s.seq
}
