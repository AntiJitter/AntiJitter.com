// Package api fetches the WireGuard + bonding configuration from the
// AntiJitter API (app.antijitter.com).
//
// The server provides: WireGuard keys, bonding server address, data limits.
// Network interfaces are auto-detected by the client (iface package).
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// AntiJitterConfig is the full configuration returned by GET /api/config.
type AntiJitterConfig struct {
	WireGuard      WireGuardConfig `json:"wireguard"`
	BondingServers []string        `json:"bonding_servers"`
	DataLimitMB    int64           `json:"data_limit_mb"`
}

// WireGuardConfig holds the tunnel parameters.
type WireGuardConfig struct {
	PrivateKey string   `json:"private_key"` // base64
	Address    string   `json:"address"`     // e.g. "10.10.0.5/24"
	DNS        string   `json:"dns"`         // e.g. "1.1.1.1"
	PeerKey    string   `json:"peer_key"`    // base64 server public key
	AllowedIPs []string `json:"allowed_ips"` // e.g. ["10.10.0.0/24"]
}

// Client talks to the AntiJitter API.
type Client struct {
	BaseURL  string
	Token    string
	DeviceID string
	http     *http.Client
}

// New creates an API client.
func New(baseURL, token, deviceID string) *Client {
	return &Client{
		BaseURL:  baseURL,
		Token:    token,
		DeviceID: deviceID,
		http:     &http.Client{Timeout: 15 * time.Second},
	}
}

// FetchConfig retrieves the user's WireGuard + bonding configuration.
func (c *Client) FetchConfig() (*AntiJitterConfig, error) {
	req, err := http.NewRequest("GET", c.BaseURL+"/api/config", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if c.DeviceID != "" {
		req.Header.Set("X-AntiJitter-Device-Id", c.DeviceID)
		req.Header.Set("X-AntiJitter-Device-Name", "Windows")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch config: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return nil, fmt.Errorf("authentication failed — check your token")
	}
	if resp.StatusCode == 403 {
		return nil, fmt.Errorf("no active subscription")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API returned HTTP %d", resp.StatusCode)
	}

	var cfg AntiJitterConfig
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, fmt.Errorf("decode config response: %w", err)
	}

	if len(cfg.BondingServers) == 0 {
		return nil, fmt.Errorf("config missing bonding_servers")
	}
	if cfg.WireGuard.PrivateKey == "" {
		return nil, fmt.Errorf("config missing wireguard private_key")
	}

	return &cfg, nil
}
