#!/usr/bin/env bash
# Diagnose DEV-route-all breakage. Captures wg / iptables / tcpdump state for
# 90 seconds in the background, so you can disconnect SSH, flip DEV on, browse,
# flip DEV off, reconnect, and read the log.
#
# Usage on Germany VPS:
#   sudo bash server/diag-route-all.sh
#   # follow printed instructions, then later:
#   sudo cat /tmp/aj-diag.log
#
# Override window length with DUR=120 etc.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "must run as root (sudo)" >&2
  exit 1
fi

DUR="${DUR:-90}"
WG_IFACE="${WG_IFACE:-wg0}"
WAN_IFACE="${WAN_IFACE:-$(ip route get 1.1.1.1 2>/dev/null | awk '/dev/ {for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}' | head -n1)}"
LOG=/tmp/aj-diag.log

: >"${LOG}"

snapshot() {
  local label="$1"
  {
    echo "===== ${label} ====="
    date -u
    echo
    echo "--- wg show ${WG_IFACE} ---"
    wg show "${WG_IFACE}" 2>&1 || true
    echo
    echo "--- iptables -t nat -L POSTROUTING -v -n ---"
    iptables -t nat -L POSTROUTING -v -n 2>&1 || true
    echo
    echo "--- iptables -L FORWARD -v -n ---"
    iptables -L FORWARD -v -n 2>&1 || true
    echo
    echo "--- ss -H -u sport = :4567 ---"
    ss -H -u 'sport = :4567' 2>&1 || true
    echo
    echo "--- systemctl is-active antijitter-bonding ---"
    systemctl is-active antijitter-bonding 2>&1 || true
    echo
  } >>"${LOG}"
}

# Detach everything below so the SSH session can exit cleanly.
nohup setsid bash -c "
  snapshot BEFORE
  echo '--- tcpdump ${WG_IFACE} (inside tunnel, first 80 pkts) ---' >>'${LOG}'
  timeout ${DUR} tcpdump -l -n -i ${WG_IFACE} -c 80 2>&1 >>'${LOG}' &
  TCPWG=\$!
  echo '--- tcpdump ${WAN_IFACE} (egress to 1.1.1.1 / 8.8.8.8, first 40 pkts) ---' >>'${LOG}'
  timeout ${DUR} tcpdump -l -n -i ${WAN_IFACE} 'host 1.1.1.1 or host 8.8.8.8 or host 9.9.9.9' -c 40 2>&1 >>'${LOG}' &
  TCPWAN=\$!
  echo '--- journalctl antijitter-bonding (live) ---' >>'${LOG}'
  timeout ${DUR} journalctl -u antijitter-bonding -f --no-pager >>'${LOG}' 2>&1 &
  JLOG=\$!
  wait \$TCPWG \$TCPWAN \$JLOG 2>/dev/null || true
  $(declare -f snapshot)
  snapshot AFTER
  echo '### capture complete ###' >>'${LOG}'
" </dev/null >/dev/null 2>&1 &

DPID=$!
disown "${DPID}" 2>/dev/null || true

cat <<EOF

capture started (pid=${DPID}, ${DUR}s, log=${LOG})
wan iface: ${WAN_IFACE}  wg iface: ${WG_IFACE}

NOW DO THIS:
  1. exit this SSH session (ctrl-d)
  2. on phone: flip DEV route-all ON, toggle Game Mode ON
  3. try to load example.com / speedtest.net for ~30 seconds
  4. flip DEV route-all OFF (or Game Mode OFF)
  5. SSH back in and run:
        sudo cat ${LOG}

tail starts with BEFORE snapshot, middle is live packets, ends with AFTER.
compare pkts/bytes counters on the MASQUERADE + FORWARD rules — if they
didn't move, packets never reached FORWARD.
EOF
