//go:build !windows

package gamelane

import "context"

func startPlatformCapture(ctx context.Context, filter string, handler PacketHandler) CaptureResult {
	return CaptureResult{
		Available: false,
		Message:   "WinDivert capture is only available on Windows.",
	}
}
