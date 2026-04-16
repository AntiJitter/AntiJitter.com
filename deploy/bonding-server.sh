#!/usr/bin/env bash
#
# Deploy AntiJitter Bonding Server to Germany VPS (game-mode.antijitter.com)
#
# Usage:
#   scp deploy/bonding-server.sh root@game-mode.antijitter.com:/tmp/
#   ssh root@game-mode.antijitter.com bash /tmp/bonding-server.sh
#
# What it does:
#   1. Installs Go (if missing)
#   2. Clones and builds the bonding server binary
#   3. Creates a systemd service
#   4. Opens firewall ports (UDP 4567 for bonding, UDP 51820 for WireGuard)
#   5. Verifies everything is running

set -euo pipefail

BOND_PORT=4567
PEER_API_PORT=4568
WG_PORT=51820
GO_VERSION="1.22.2"
INSTALL_DIR="/opt/antijitter-bonding"
SERVICE_NAME="antijitter-bonding"
REPO_BRANCH="claude/build-dashboard-app-3JwBC"

echo "=== AntiJitter Bonding Server Setup ==="
echo ""

# ── 1. Install Go ────────────────────────────────────────────────────────────

if command -v /usr/local/go/bin/go &>/dev/null; then
    echo "Go already installed: $(/usr/local/go/bin/go version)"
else
    echo "Installing Go ${GO_VERSION}..."
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
    rm -rf /usr/local/go
    tar -C /usr/local -xzf /tmp/go.tar.gz
    rm /tmp/go.tar.gz
    echo "Installed: $(/usr/local/go/bin/go version)"
fi
export PATH="/usr/local/go/bin:$PATH"

# Persist Go in PATH for future logins
if ! grep -q '/usr/local/go/bin' /etc/profile.d/go.sh 2>/dev/null; then
    echo 'export PATH=/usr/local/go/bin:$PATH' > /etc/profile.d/go.sh
fi

# ── 2. Get source and build ──────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"

echo "Fetching server source..."
TMPDIR=$(mktemp -d)
git clone --depth 1 --branch "$REPO_BRANCH" \
    https://github.com/antijitter/antijitter.com.git "$TMPDIR/repo"

# Copy only the server directory
cp -r "$TMPDIR/repo/server/"* "$INSTALL_DIR/"
rm -rf "$TMPDIR"

echo "Building bonding server..."
cd "$INSTALL_DIR"
/usr/local/go/bin/go build -o bonding-server .
echo "Built: $INSTALL_DIR/bonding-server"

# ── 3. Systemd service ───────────────────────────────────────────────────────

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=AntiJitter Bonding Server
After=network.target wg-quick@wg0.service
Wants=wg-quick@wg0.service

[Service]
Type=simple
EnvironmentFile=-${INSTALL_DIR}/.env
ExecStart=${INSTALL_DIR}/bonding-server --bond-port=${BOND_PORT} --wg-port=${WG_PORT}
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
echo "Service ${SERVICE_NAME} installed and started"

# ── 4. Firewall ──────────────────────────────────────────────────────────────

echo ""
echo "Configuring firewall..."

FINLAND_IP="204.168.194.77"  # Only Finland API should talk to peer API

if command -v ufw &>/dev/null; then
    ufw allow "${BOND_PORT}/udp" comment "AntiJitter Bonding"
    ufw allow "${WG_PORT}/udp" comment "WireGuard"
    ufw allow from "${FINLAND_IP}" to any port "${PEER_API_PORT}" proto tcp comment "AntiJitter Peer API"
    echo "UFW rules added"
elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port="${BOND_PORT}/udp"
    firewall-cmd --permanent --add-port="${WG_PORT}/udp"
    firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=${FINLAND_IP} port port=${PEER_API_PORT} protocol=tcp accept"
    firewall-cmd --reload
    echo "firewalld rules added"
else
    iptables -C INPUT -p udp --dport "${BOND_PORT}" -j ACCEPT 2>/dev/null \
        || iptables -A INPUT -p udp --dport "${BOND_PORT}" -j ACCEPT
    iptables -C INPUT -p udp --dport "${WG_PORT}" -j ACCEPT 2>/dev/null \
        || iptables -A INPUT -p udp --dport "${WG_PORT}" -j ACCEPT
    iptables -C INPUT -p tcp -s "${FINLAND_IP}" --dport "${PEER_API_PORT}" -j ACCEPT 2>/dev/null \
        || iptables -A INPUT -p tcp -s "${FINLAND_IP}" --dport "${PEER_API_PORT}" -j ACCEPT
    echo "iptables rules added (install iptables-persistent to survive reboot)"
fi

# ── 5. Verification ──────────────────────────────────────────────────────────

echo ""
echo "=== Verification ==="

if wg show wg0 &>/dev/null; then
    echo "[OK] WireGuard wg0 is running on :${WG_PORT}"
else
    echo "[!!] WireGuard wg0 is NOT running — run: wg-quick up wg0"
fi

sleep 1
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "[OK] Bonding server is running on :${BOND_PORT}"
else
    echo "[!!] Bonding server failed to start:"
    journalctl -u "$SERVICE_NAME" --no-pager -n 10
fi

echo ""
echo "=== Done ==="
echo "Bonding:   0.0.0.0:${BOND_PORT} → 127.0.0.1:${WG_PORT}"
echo "Logs:      journalctl -u ${SERVICE_NAME} -f"
echo "Restart:   systemctl restart ${SERVICE_NAME}"
