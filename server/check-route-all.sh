#!/usr/bin/env bash
# One-shot snapshot of everything that could break DEV route-all forwarding.
# Safe to run any time (read-only — no iptables changes).
#
# Run on Germany VPS:
#   curl -fsSL https://raw.githubusercontent.com/AntiJitter/AntiJitter.com/claude/antijitter-android-app-8FaR5/server/check-route-all.sh | sudo bash

set -u

section() { echo; echo "===== $* ====="; }

section "ip_forward"
sysctl net.ipv4.ip_forward 2>/dev/null
sysctl net.ipv4.conf.all.forwarding 2>/dev/null
sysctl net.ipv4.conf.wg0.forwarding 2>/dev/null
sysctl net.ipv4.conf.eth0.forwarding 2>/dev/null

section "iptables filter FORWARD (counters)"
iptables -L FORWARD -v -n --line-numbers
iptables -S FORWARD

section "iptables nat POSTROUTING (counters)"
iptables -t nat -L POSTROUTING -v -n --line-numbers
iptables -t nat -S POSTROUTING

section "iptables filter INPUT (wg0 side)"
iptables -L INPUT -v -n | head -20

section "default FORWARD policy"
iptables -L FORWARD | head -1
iptables -L | grep "^Chain FORWARD"

section "UFW status"
ufw status verbose 2>/dev/null || echo "ufw not installed"

section "firewalld status"
systemctl is-active firewalld 2>/dev/null || echo "firewalld not running"

section "nftables rules (if any)"
nft list ruleset 2>/dev/null | head -40 || echo "nftables empty or not installed"

section "ip rule"
ip rule

section "ip route main (default route)"
ip route show table main | head -10

section "ip route wg table (fwmark)"
ip route show table 51820 2>/dev/null || echo "no wg route table"

section "wg show wg0"
wg show wg0 2>/dev/null || echo "wg0 not up"

section "live test — can the VPS itself reach 1.1.1.1?"
timeout 3 ping -c 2 -W 1 1.1.1.1 2>&1 | tail -4

section "live test — source-from-wg0 to 1.1.1.1 (simulates client)"
WG0_IP=$(ip -4 addr show wg0 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1)
if [[ -n "${WG0_IP:-}" ]]; then
  echo "wg0 ip: ${WG0_IP}"
  timeout 3 ping -c 2 -W 1 -I "${WG0_IP}" 1.1.1.1 2>&1 | tail -4
else
  echo "wg0 has no IP"
fi

section "tcpdump 5s on wg0 (you can watch this vs. phone activity)"
timeout 5 tcpdump -i wg0 -n -c 10 2>&1 | tail -15

echo
echo "done."
