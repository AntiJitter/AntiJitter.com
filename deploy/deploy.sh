#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║  AntíJitter — Hetzner VPS deploy script                        ║
# ║  OS: Ubuntu 22.04 LTS                                          ║
# ║  Run as: root  (or a user with passwordless sudo)              ║
# ║  Usage:  bash deploy.sh                                        ║
# ╚══════════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
TEAL='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'
step()  { echo -e "\n${TEAL}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}  ✓ $*${NC}"; }
die()   { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

# ── Config ────────────────────────────────────────────────────────────────────
DOMAIN="app.antijitter.com"
APP_USER="antijitter"
APP_DIR="/opt/antijitter"
REPO_URL="https://github.com/AntiJitter/AntiJitter.com.git"
BRANCH="main"
VENV="$APP_DIR/venv"
BACKEND_DIR="$APP_DIR/dashboard/backend"
FRONTEND_DIR="$APP_DIR/dashboard/frontend"
STATIC_DIR="$APP_DIR/dashboard/frontend/dist"
DB_NAME="antijitter"
DB_USER="antijitter"
WG_IFACE="wg0"
WG_PORT="51820"
WG_SUBNET="10.8.0.0/24"
WG_SERVER_IP="10.8.0.1"

[[ $EUID -eq 0 ]] || die "Run this script as root: sudo bash deploy.sh"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 0 — Gather credentials up-front so the rest runs unattended
# ─────────────────────────────────────────────────────────────────────────────
step "Collecting credentials (nothing is stored yet)"

read -rp "  Stripe secret key (sk_live_... or sk_test_...): " STRIPE_SECRET_KEY
read -rp "  Stripe webhook secret (whsec_...): "              STRIPE_WEBHOOK_SECRET
read -rp "  Stripe price ID — Solo 49 NOK (price_...): "     STRIPE_PRICE_SOLO
read -rp "  Stripe price ID — Family 99 NOK (price_...): "   STRIPE_PRICE_FAMILY
read -rp "  Email for Let's Encrypt / certbot: "              CERTBOT_EMAIL

ok "Credentials collected"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — System packages
# ─────────────────────────────────────────────────────────────────────────────
step "Installing system packages"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    python3.11 python3.11-venv python3.11-dev python3-pip \
    postgresql postgresql-contrib \
    wireguard wireguard-tools iptables \
    nginx \
    certbot python3-certbot-nginx \
    git curl build-essential \
    ufw

# Node.js 20 LTS via NodeSource
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi
ok "System packages installed"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — App user + directories
# ─────────────────────────────────────────────────────────────────────────────
step "Creating app user and directories"

id "$APP_USER" &>/dev/null || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
ok "User '$APP_USER' ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Clone / pull repo
# ─────────────────────────────────────────────────────────────────────────────
step "Cloning repository"

if [[ -d "$APP_DIR/.git" ]]; then
    sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin "$BRANCH"
    sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH"
    ok "Repo updated"
else
    sudo -u "$APP_USER" git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
    ok "Repo cloned"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────
step "Configuring PostgreSQL"

systemctl enable --now postgresql

DB_PASSWORD=$(openssl rand -hex 24)

# Create or update role (idempotent — always syncs password so re-runs work)
if sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    sudo -u postgres psql -c "ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASSWORD';" > /dev/null
else
    sudo -u postgres psql -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';" > /dev/null
fi

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" \
    | grep -q 1 || sudo -u postgres psql -c \
    "CREATE DATABASE $DB_NAME OWNER $DB_USER;" > /dev/null

DATABASE_URL="postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}"
ok "PostgreSQL ready  (db=$DB_NAME user=$DB_USER)"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — WireGuard server
# ─────────────────────────────────────────────────────────────────────────────
step "Setting up WireGuard server (wg0)"

if [[ ! -f /etc/wireguard/server_private.key ]]; then
    wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
    chmod 600 /etc/wireguard/server_private.key
fi

SERVER_PRIVATE=$(cat /etc/wireguard/server_private.key)
SERVER_PUBLIC=$(cat /etc/wireguard/server_public.key)
VPS_IP=$(curl -s https://api.ipify.org)

# Detect main network interface for masquerade
NET_IFACE=$(ip route | awk '/^default/ {print $5}' | head -1)

cat > /etc/wireguard/${WG_IFACE}.conf <<WGCONF
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE}

# NAT — route VPN client traffic out through ${NET_IFACE}
PostUp   = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${NET_IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${NET_IFACE} -j MASQUERADE

# Clients are added here dynamically by the FastAPI backend via:
#   wg set wg0 peer <pubkey> allowed-ips <ip>/32
WGCONF

# IP forwarding
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-wg.conf
sysctl -p /etc/sysctl.d/99-wg.conf > /dev/null

systemctl enable --now wg-quick@${WG_IFACE}
ok "WireGuard wg0 running  (server pubkey: $SERVER_PUBLIC)"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — .env file
# ─────────────────────────────────────────────────────────────────────────────
step "Writing .env"

SECRET_KEY=$(openssl rand -hex 32)

cat > "$BACKEND_DIR/.env" <<ENV
DATABASE_URL=${DATABASE_URL}
SECRET_KEY=${SECRET_KEY}

STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
STRIPE_PRICE_SOLO=${STRIPE_PRICE_SOLO}
STRIPE_PRICE_FAMILY=${STRIPE_PRICE_FAMILY}

VPS_IP=${VPS_IP}
SERVER_WG_PUBLIC_KEY=${SERVER_PUBLIC}
WG_INTERFACE=${WG_IFACE}
ENV

chmod 600 "$BACKEND_DIR/.env"
chown "$APP_USER:$APP_USER" "$BACKEND_DIR/.env"
ok ".env written"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7 — Python virtualenv + dependencies
# ─────────────────────────────────────────────────────────────────────────────
step "Creating Python virtualenv and installing dependencies"

sudo -u "$APP_USER" python3.11 -m venv "$VENV"
sudo -u "$APP_USER" "$VENV/bin/pip" install --quiet --upgrade pip
sudo -u "$APP_USER" "$VENV/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"
ok "Python deps installed"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8 — Alembic migrations
# ─────────────────────────────────────────────────────────────────────────────
step "Running Alembic database migrations"

cd "$APP_DIR/dashboard"
sudo -u "$APP_USER" env DATABASE_URL="$DATABASE_URL" "$VENV/bin/alembic" \
    -c "$BACKEND_DIR/alembic.ini" \
    upgrade head
ok "Database schema up to date"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 9 — React build
# ─────────────────────────────────────────────────────────────────────────────
step "Building React frontend"

sudo -u "$APP_USER" bash -c "cd '$FRONTEND_DIR' && npm ci --silent && npm run build"
ok "Frontend built → $STATIC_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 10 — systemd service
# ─────────────────────────────────────────────────────────────────────────────
step "Installing systemd service"

cp "$(dirname "$0")/antijitter-api.service" /etc/systemd/system/antijitter-api.service

# Patch VENV path into service file
sed -i "s|__VENV__|${VENV}|g"       /etc/systemd/system/antijitter-api.service
sed -i "s|__APP_DIR__|${APP_DIR}|g" /etc/systemd/system/antijitter-api.service
sed -i "s|__APP_USER__|${APP_USER}|g" /etc/systemd/system/antijitter-api.service

systemctl daemon-reload
systemctl enable --now antijitter-api
ok "antijitter-api service running"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 11 — nginx
# ─────────────────────────────────────────────────────────────────────────────
step "Configuring nginx"

cp "$(dirname "$0")/nginx.conf" /etc/nginx/sites-available/antijitter
sed -i "s|__DOMAIN__|${DOMAIN}|g"       /etc/nginx/sites-available/antijitter
sed -i "s|__STATIC_DIR__|${STATIC_DIR}|g" /etc/nginx/sites-available/antijitter

ln -sf /etc/nginx/sites-available/antijitter /etc/nginx/sites-enabled/antijitter
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
ok "nginx configured (HTTP, no SSL yet)"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 12 — Firewall
# ─────────────────────────────────────────────────────────────────────────────
step "Configuring firewall (ufw)"

ufw --force reset > /dev/null
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow ${WG_PORT}/udp      # WireGuard
ufw --force enable > /dev/null
ok "Firewall active"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 13 — Let's Encrypt SSL
# ─────────────────────────────────────────────────────────────────────────────
step "Obtaining SSL certificate from Let's Encrypt"

certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email "$CERTBOT_EMAIL" \
    --domains "$DOMAIN" \
    --redirect
ok "SSL certificate installed"

systemctl reload nginx

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  AntíJitter deployed successfully!                  ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  URL:            https://${DOMAIN}               ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  API:            https://${DOMAIN}/api/          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  WireGuard port: UDP ${WG_PORT}                         ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Server WG key:  ${SERVER_PUBLIC:0:24}...  ${GREEN}║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Stripe webhook endpoint to register:            ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  https://${DOMAIN}/api/subscription/webhook     ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${DIM}  View logs:   journalctl -u antijitter-api -f${NC}"
echo -e "${DIM}  Restart API: systemctl restart antijitter-api${NC}"
echo -e "${DIM}  WG status:   wg show${NC}"
