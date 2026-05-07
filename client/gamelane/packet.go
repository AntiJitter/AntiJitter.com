package gamelane

import (
	"encoding/binary"
	"fmt"
	"net"
)

// Packet is the minimal IPv4/UDP view needed by GameLane.
type Packet struct {
	SourceIP   net.IP
	DestIP     net.IP
	Protocol   string
	SourcePort uint16
	DestPort   uint16
	Size       int
}

func parseIPv4UDPPacket(packet []byte) (Packet, error) {
	if len(packet) < 28 {
		return Packet{}, fmt.Errorf("packet too short")
	}
	version := packet[0] >> 4
	if version != 4 {
		return Packet{}, fmt.Errorf("not ipv4")
	}
	ihl := int(packet[0]&0x0f) * 4
	if ihl < 20 || len(packet) < ihl+8 {
		return Packet{}, fmt.Errorf("invalid ipv4 header")
	}
	if packet[9] != 17 {
		return Packet{}, fmt.Errorf("not udp")
	}
	return Packet{
		SourceIP:   net.IPv4(packet[12], packet[13], packet[14], packet[15]),
		DestIP:     net.IPv4(packet[16], packet[17], packet[18], packet[19]),
		Protocol:   ProtocolUDP,
		SourcePort: binary.BigEndian.Uint16(packet[ihl : ihl+2]),
		DestPort:   binary.BigEndian.Uint16(packet[ihl+2 : ihl+4]),
		Size:       len(packet),
	}, nil
}
