package gamelane

import "context"

type PacketHandler func(Packet)

type CaptureResult struct {
	Available bool
	Message   string
}

func captureFilter() string {
	return "ip and udp and not loopback"
}

func startCapture(ctx context.Context, handler PacketHandler) CaptureResult {
	return startPlatformCapture(ctx, captureFilter(), handler)
}
