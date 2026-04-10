#!/usr/bin/env bash
# Quick redeploy — pull latest code, migrate DB, rebuild frontend, reload API.
# Run as root on the VPS after merging a PR.
set -euo pipefail

TEAL='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'
step() { echo -e "\n${TEAL}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }

APP_USER="antijitter"
APP_DIR="/opt/antijitter"
VENV="$APP_DIR/venv"
FRONTEND_DIR="$APP_DIR/dashboard/frontend"
BACKEND_DIR="$APP_DIR/dashboard/backend"
BRANCH="${1:-main}"

[[ $EUID -eq 0 ]] || { echo "Run as root"; exit 1; }

step "Pulling $BRANCH"
sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin "$BRANCH"
sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH"
ok "Code up to date"

step "Running migrations"
cd "$APP_DIR/dashboard"
sudo -u "$APP_USER" "$VENV/bin/alembic" -c "$BACKEND_DIR/alembic.ini" upgrade head
ok "DB schema up to date"

step "Installing new Python deps (if any)"
sudo -u "$APP_USER" "$VENV/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"
ok "Python deps ok"

step "Rebuilding React frontend"
sudo -u "$APP_USER" bash -c "cd '$FRONTEND_DIR' && npm ci --silent && npm run build"
ok "Frontend rebuilt"

step "Reloading API (zero-downtime)"
systemctl reload antijitter-api || systemctl restart antijitter-api
ok "API reloaded"

echo -e "\n${GREEN}Redeploy complete.${NC}"
