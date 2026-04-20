#!/usr/bin/env bash
# Germany VPS one-shot: enable IPv4 forwarding + NAT for the WireGuard subnet.
# Idempotent — safe to re-run. Required so DEV "route all traffic" actually
# reaches the public internet through Germany.
#
# Run on game-mode.antijitter.com:
#   curl -fsSL https://raw.githubusercontent.com/AntiJitter/AntiJitter.com/claude/antijitter-android-app-8FaR5/server/setup-route-all.sh | sudo bash
# or after `git pull`:
#   sudo bash server/setup-route-all.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "must run as root (sudo)" >&2
  exit 1
fi

WG_SUBNET="${WG_SUBNET:-10.10.0.0/24}"
WG_IFACE="${WG_IFACE:-wg0}"
WAN_IFACE="${WAN_IFACE:-$(ip route get 1.1.1.1 2>/dev/null | awk '/dev/ {for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}' | head -n1)}"

if [[ -z "${WAN_IFACE}" ]]; then
  echo "could not auto-detect WAN interface — set WAN_IFACE=eth0 (or whatever) and re-run" >&2
  exit 1
fi

echo "wg subnet : ${WG_SUBNET}"
echo "wg iface  : ${WG_IFACE}"
echo "wan iface : ${WAN_IFACE}"

# ---- 1. IP forwarding ------------------------------------------------------
echo "[1/3] enabling net.ipv4.ip_forward"
install -m 0644 /dev/stdin /etc/sysctl.d/99-antijitter-forward.conf <<'EOF'
# AntiJitter: forward packets between WireGuard tunnel and WAN.
net.ipv4.ip_forward = 1
EOF
sysctl --system >/dev/null

# ---- 2. iptables NAT + FORWARD --------------------------------------------
echo "[2/3] installing iptables MASQUERADE + FORWARD rules"
add_rule() {
  local table="$1"; shift
  if ! iptables -t "$table" -C "$@" 2>/dev/null; then
    iptables -t "$table" -A "$@"
    echo "  + iptables -t $table -A $*"
  else
    echo "  · already present: iptables -t $table $*"
  fi
}
add_rule nat    POSTROUTING -s "${WG_SUBNET}" -o "${WAN_IFACE}" -j MASQUERADE
add_rule filter FORWARD     -i "${WG_IFACE}" -j ACCEPT
add_rule filter FORWARD     -o "${WG_IFACE}" -j ACCEPT

# ---- 3. Persistence -------------------------------------------------------
echo "[3/3] persisting iptables rules"
if ! command -v netfilter-persistent >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null
fi
netfilter-persistent save >/dev/null

# ---- Optional: bake into wg0.conf so PostDown cleans up ------------------
WG_CONF="/etc/wireguard/${WG_IFACE}.conf"
if [[ -f "${WG_CONF}" ]] && ! grep -q '# antijitter-route-all' "${WG_CONF}"; then
  echo "patching ${WG_CONF} with PostUp/PostDown markers"
  cat >>"${WG_CONF}" <<EOF

# antijitter-route-all (added by setup-route-all.sh)
PostUp   = iptables -t nat -A POSTROUTING -s ${WG_SUBNET} -o ${WAN_IFACE} -j MASQUERADE; iptables -A FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -A FORWARD -o ${WG_IFACE} -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -s ${WG_SUBNET} -o ${WAN_IFACE} -j MASQUERADE; iptables -D FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -D FORWARD -o ${WG_IFACE} -j ACCEPT
EOF
fi

echo
echo "done. quick checks:"
echo "  sysctl net.ipv4.ip_forward        # should print 1"
echo "  iptables -t nat -S POSTROUTING    # should show MASQUERADE for ${WG_SUBNET}"
echo "  sudo tcpdump -i ${WG_IFACE} -n -c 5  # turn on DEV route-all on phone, browse, watch packets"
