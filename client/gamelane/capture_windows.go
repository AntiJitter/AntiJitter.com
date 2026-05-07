//go:build windows

package gamelane

import (
	"context"
	"fmt"
	"log"
	"syscall"
	"time"
	"unsafe"
)

const (
	windivertLayerNetwork = 0
	windivertFlagSniff    = 1
)

func startPlatformCapture(ctx context.Context, filter string, handler PacketHandler) CaptureResult {
	dll, err := loadWinDivertDLL()
	if err != nil {
		return CaptureResult{Available: false, Message: err.Error()}
	}

	open, err := dll.FindProc("WinDivertOpen")
	if err != nil {
		return CaptureResult{Available: false, Message: fmt.Sprintf("WinDivertOpen missing: %v", err)}
	}
	recv, err := dll.FindProc("WinDivertRecv")
	if err != nil {
		return CaptureResult{Available: false, Message: fmt.Sprintf("WinDivertRecv missing: %v", err)}
	}
	closeProc, err := dll.FindProc("WinDivertClose")
	if err != nil {
		return CaptureResult{Available: false, Message: fmt.Sprintf("WinDivertClose missing: %v", err)}
	}

	filterPtr, err := syscall.BytePtrFromString(filter)
	if err != nil {
		return CaptureResult{Available: false, Message: fmt.Sprintf("invalid WinDivert filter: %v", err)}
	}

	handle, _, callErr := open.Call(
		uintptr(unsafe.Pointer(filterPtr)),
		uintptr(windivertLayerNetwork),
		uintptr(0),
		uintptr(windivertFlagSniff),
	)
	if handle == 0 || handle == ^uintptr(0) {
		return CaptureResult{Available: false, Message: fmt.Sprintf("WinDivertOpen failed: %v", callErr)}
	}

	log.Printf("[GameLane] WinDivert capture active filter=%q flags=sniff", filter)
	go func() {
		<-ctx.Done()
		closeProc.Call(handle)
	}()
	go func() {
		buf := make([]byte, 0xffff)
		addr := make([]byte, 256)
		var recvLen uint32
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			recvLen = 0
			r1, _, err := recv.Call(
				handle,
				uintptr(unsafe.Pointer(&buf[0])),
				uintptr(len(buf)),
				uintptr(unsafe.Pointer(&recvLen)),
				uintptr(unsafe.Pointer(&addr[0])),
			)
			if r1 == 0 {
				if ctx.Err() != nil {
					return
				}
				log.Printf("[GameLane] WinDivertRecv failed: %v", err)
				time.Sleep(250 * time.Millisecond)
				continue
			}
			if recvLen == 0 || int(recvLen) > len(buf) {
				continue
			}
			pkt, err := parseIPv4UDPPacket(buf[:recvLen])
			if err != nil {
				continue
			}
			handler(pkt)
		}
	}()

	return CaptureResult{Available: true, Message: "WinDivert capture active in sniff-only dry-run mode."}
}

func loadWinDivertDLL() (*syscall.DLL, error) {
	names := []string{"WinDivert.dll", "WinDivert64.dll"}
	var lastErr error
	for _, name := range names {
		dll, err := syscall.LoadDLL(name)
		if err == nil {
			return dll, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("WinDivert DLL not found; copy WinDivert.dll/WinDivert64.dll next to antijitter.exe and run as Administrator: %v", lastErr)
}
