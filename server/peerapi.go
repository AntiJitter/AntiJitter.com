// Peer management HTTP API on the Germany bonding server.
//
// The Finland API calls POST /peers when auto-provisioning a new user's
// WireGuard config. The Germany server runs `wg set` locally to register
// the peer with the live WireGuard interface.
//
// Auth: shared Bearer token in the ADD_PEER_TOKEN env var. Firewall this
// port to the Finland VPS IP in production.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

const peerAPIDefaultPort = 4568

var (
	wgKeyRe    = regexp.MustCompile(`^[A-Za-z0-9+/]{42}[A-Za-z0-9+/=]{2}$`)
	wgPeerIPRe = regexp.MustCompile(`^10\.10\.0\.(?:[1-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-4])$`)
)

type addPeerRequest struct {
	PublicKey string `json:"public_key"`
	PeerIP    string `json:"peer_ip"`
}

type addPeerResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

// startPeerAPI starts the HTTP peer-management server on the given port.
// Blocks until the listener fails.
func startPeerAPI(port int, wgInterface, authToken string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/peers", func(w http.ResponseWriter, r *http.Request) {
		handleAddPeer(w, r, wgInterface, authToken)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok\n"))
	})

	addr := fmt.Sprintf("0.0.0.0:%d", port)
	log.Printf("  Peer API:    %s (POST /peers)", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("peer API listen: %v", err)
	}
}

func handleAddPeer(w http.ResponseWriter, r *http.Request, wgInterface, authToken string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Bearer token check
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if authToken == "" || got != authToken {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req addPeerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	// Validate inputs — these go on a shell command line, so be strict
	if !wgKeyRe.MatchString(req.PublicKey) {
		http.Error(w, "invalid public_key format", http.StatusBadRequest)
		return
	}
	if !wgPeerIPRe.MatchString(req.PeerIP) {
		http.Error(w, "invalid peer_ip (must be 10.10.0.X)", http.StatusBadRequest)
		return
	}
	if net.ParseIP(req.PeerIP) == nil {
		http.Error(w, "invalid peer_ip", http.StatusBadRequest)
		return
	}

	// Run: wg set <iface> peer <pubkey> allowed-ips <ip>/32 persistent-keepalive 25
	cmd := exec.Command("wg", "set", wgInterface,
		"peer", req.PublicKey,
		"allowed-ips", req.PeerIP+"/32",
		"persistent-keepalive", "25")
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("wg set failed: %v — %s", err, strings.TrimSpace(string(out)))
		respondJSON(w, http.StatusInternalServerError, addPeerResponse{
			OK:      false,
			Message: fmt.Sprintf("wg set failed: %s", strings.TrimSpace(string(out))),
		})
		return
	}

	// Persist so the peer survives a reboot
	if out, err := exec.Command("wg-quick", "save", wgInterface).CombinedOutput(); err != nil {
		log.Printf("wg-quick save failed: %v — %s", err, strings.TrimSpace(string(out)))
		// Don't fail the request — peer is live, just not persisted
	}

	log.Printf("Peer added: %s → %s/32", req.PublicKey[:8]+"...", req.PeerIP)
	respondJSON(w, http.StatusOK, addPeerResponse{OK: true})
}

func respondJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

// getPeerAPIConfig reads peer API settings from environment.
// Returns (port, wgInterface, token, enabled).
func getPeerAPIConfig() (int, string, string, bool) {
	token := os.Getenv("ADD_PEER_TOKEN")
	if token == "" {
		return 0, "", "", false
	}
	iface := os.Getenv("WG_INTERFACE")
	if iface == "" {
		iface = "wg0"
	}
	return peerAPIDefaultPort, iface, token, true
}
