#!/usr/bin/env bash
# Rebuild + restart the bonding server on Germany VPS.
# Idempotent — safe to re-run on every code change.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AntiJitter/AntiJitter.com/claude/antijitter-android-app-8FaR5/server/deploy-bonding.sh | sudo bash
#
# Or locally after git pull:
#   sudo bash server/deploy-bonding.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "must run as root (sudo)" >&2
  exit 1
fi

REPO_URL="${REPO_URL:-https://github.com/AntiJitter/AntiJitter.com.git}"
BRANCH="${BRANCH:-claude/antijitter-android-app-8FaR5}"
SRC_DIR="${SRC_DIR:-/opt/antijitter-server}"
SERVICE="${SERVICE:-antijitter-bonding}"

# Honor whatever path the unit file already uses, so we don't ship to a
# location systemd doesn't know about. Falls back to /usr/local/bin/.
detect_exec_path() {
  local p
  p=$(systemctl cat "${SERVICE}" 2>/dev/null | awk -F'=' '/^ExecStart=/ {print $2; exit}' | awk '{print $1}')
  if [[ -n "${p}" ]]; then
    echo "${p}"
  else
    echo "/usr/local/bin/antijitter-bonding"
  fi
}
BIN_PATH="${BIN_PATH:-$(detect_exec_path)}"

if ! command -v go >/dev/null 2>&1; then
  echo "installing golang-go…"
  apt-get update -qq
  apt-get install -y -qq golang-go
fi

echo "[1/4] syncing ${SRC_DIR} from ${BRANCH}"
if [[ -d "${SRC_DIR}/.git" ]]; then
  git -C "${SRC_DIR}" fetch origin "${BRANCH}"
  git -C "${SRC_DIR}" reset --hard "origin/${BRANCH}"
else
  rm -rf "${SRC_DIR}"
  git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${SRC_DIR}"
fi

echo "[2/4] building ${BIN_PATH}"
cd "${SRC_DIR}/server"
go build -o "${BIN_PATH}.new" .
mkdir -p "$(dirname "${BIN_PATH}")"
install -m 0755 "${BIN_PATH}.new" "${BIN_PATH}"
rm -f "${BIN_PATH}.new"

echo "[3/4] restarting ${SERVICE}"
systemctl restart "${SERVICE}"

echo "[4/4] status"
sleep 1
systemctl status "${SERVICE}" --no-pager -l | head -20
echo
echo "done. follow logs: journalctl -u ${SERVICE} -f"
