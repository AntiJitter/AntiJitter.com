# AntiJitter Windows Client Build
#
# Prerequisites:
#   - Go 1.22+
#   - go-winres (for embedding Windows manifest): go install github.com/tc-hib/go-winres@latest
#
# Build steps:
#   make deps    — download Go modules
#   make build   — build antijitter.exe for Windows (cross-compile OK from Linux/macOS)
#   make clean   — remove build artifacts

BINARY    = antijitter.exe
GOFLAGS   = -ldflags="-s -w -H=windowsgui"
GOOS      = windows
GOARCH    = amd64

.PHONY: all deps build embed-manifest clean

all: deps build

# Download and verify Go module dependencies
deps:
	go mod tidy

# Embed the Windows manifest + icon resource into a .syso file.
# The .syso is automatically picked up by `go build` on Windows targets.
# Requires: go install github.com/tc-hib/go-winres@latest
embed-manifest:
	go-winres simply --manifest app.manifest \
		--product-version "1.0.0" \
		--file-version "1.0.0" \
		--file-description "AntiJitter Game Mode" \
		--product-name "AntiJitter" \
		--copyright "AntiJitter" \
		--icon ""

# Build the Windows executable.
# -H=windowsgui hides the console window (runs as tray app only).
# -s -w strips debug info for smaller binary.
build: embed-manifest
	GOOS=$(GOOS) GOARCH=$(GOARCH) go build $(GOFLAGS) -o $(BINARY) .
	@echo ""
	@echo "Built: $(BINARY)"
	@echo "Copy $(BINARY) + antijitter-token.txt to the user's machine."

# Build without manifest embedding (simpler, still works but no UAC prompt)
build-simple:
	GOOS=$(GOOS) GOARCH=$(GOARCH) go build $(GOFLAGS) -o $(BINARY) .
	@echo "Built: $(BINARY) (no embedded manifest — run as admin manually)"

clean:
	rm -f $(BINARY) *.syso
