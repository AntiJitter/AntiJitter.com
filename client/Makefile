# AntiJitter Windows Client Build
#
# Prerequisites:
#   - Go 1.22+  (https://go.dev/dl/)
#   - Node 18+  (https://nodejs.org/)
#   - Wails CLI: go install github.com/wailsapp/wails/v2/cmd/wails@latest
#
# One-time setup:
#   make setup   — install Wails CLI + frontend deps
#
# Build:
#   make build   — produce build/bin/antijitter.exe (Windows, from any OS)
#   make dev     — live-reload dev mode (opens browser window)
#   make clean   — remove build artifacts

.PHONY: all setup deps build dev clean

all: build

# Install Wails CLI and frontend npm deps
setup:
	go install github.com/wailsapp/wails/v2/cmd/wails@latest
	cd frontend && npm install

# Resolve Go module dependencies
deps:
	go mod tidy
	cd frontend && npm install

# Build the Windows .exe and bundle the signed Wintun DLL.
# Output: build/bin/antijitter.exe and build/bin/wintun.dll
build: deps
	wails build -platform windows/amd64
	@echo ""
	@echo "Built: build/bin/antijitter.exe"
	@echo "Bundled: build/bin/wintun.dll"
	@echo "Run as Administrator on the target Windows machine."

# Dev mode — live reload, opens in browser (no WireGuard/bonding in browser)
dev:
	wails dev

clean:
	rm -rf build/bin
