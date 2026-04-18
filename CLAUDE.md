# AntiJitter.com — Claude Code Context

## Architecture

**Two-server split:**
- `antijitter.com` → GitHub Pages, static `index.html` (SEO via Fastly CDN). Push to `main` to deploy.
- `app.antijitter.com` → Finland VPS (`/opt/antijitter/`), FastAPI + React SPA.

**Germany VPS** (`game-mode.antijitter.com`) — WireGuard endpoint for users. BBR + fq configured. `wg0.conf` at `/etc/wireguard/wg0.conf`. Subnet: `10.10.0.0/24`.

## Repo layout

```
index.html                  # Landing page (GitHub Pages)
dashboard/
  backend/                  # FastAPI app
    main.py                 # App entry, lifespan, router includes
    models.py               # SQLAlchemy models: User, Game, GameRequest, ...
    database.py             # AsyncSessionLocal, get_db
    routers/
      games.py              # /api/games — ASN sync, RIPE NCC, seed
      ping.py               # /api/ping — latency endpoint
      auth.py               # /api/auth
      metrics.py            # /api/metrics (WebSocket)
      subscription.py       # /api/subscription (Stripe)
      config.py             # /api/config — WireGuard + bonding config per user
    requirements.txt
  frontend/                 # Vite + React
    src/
      App.jsx               # Routes: /, /jitter-test, /games, /login, /register, /dashboard*
      components/
        PublicNav.jsx       # Shared nav for public pages (JitterTest, GamesDatabase)
      pages/
        JitterTest.jsx      # /jitter-test — compact, above-fold layout
        GamesDatabase.jsx   # /games — game grid + upvote requests
        Dashboard.jsx       # /dashboard — Live/Connections/History tabs
server/                     # Germany VPS bonding server (Go)
  main.go                   # UDP listener, dedup, WG forward, multi-port (4567+443)
  bonding/protocol.go       # Shared: 4-byte seq header, Encode/Decode, Deduplicator
  peer_api.go               # HTTP API for adding WireGuard peers
client/                     # Windows desktop app (Go + Wails v2)
  app.go                    # Wails backend: login, toggle, status, lifecycle
  main.go                   # Wails entry point
  bonding/
    client.go               # Multi-path UDP sender (unconnected sockets + WriteTo)
    bind.go                 # ListenUDPViaInterface / DialUDPViaInterface
    bind_windows.go         # IP_UNICAST_IF via Dialer.Control hook
    bind_other.go           # No-op stubs for non-Windows
  iface/
    detect.go               # Detect NICs, probe reachability to bonding server
    route_windows.go        # Add/remove /32 host routes per adapter (required on Windows)
    route_other.go          # No-op stubs
  tunnel/                   # WireGuard tunnel via wireguard-go + wintun
  api/client.go             # Fetch config from app.antijitter.com/api/config
  frontend/                 # Wails React UI
deploy/
  bonding-server.sh         # Germany VPS setup script
```

## Finland VPS deployment

```bash
ssh antijitter@app.antijitter.com
cd /opt/antijitter
git fetch origin claude/build-dashboard-app-3JwBC
git reset --hard FETCH_HEAD
cd dashboard/frontend && npm run build
sudo systemctl restart antijitter-api
```

Service file: `/etc/systemd/system/antijitter-api.service`
DB: SQLite at `/opt/antijitter/dashboard/backend/antijitter.db`
Nginx config: `/etc/nginx/sites-available/antijitter`

## Active development branches

- `claude/build-dashboard-app-3JwBC` — dashboard + API changes
- `claude/antijitter-windows-app-*` — Windows client work

## Key design decisions

- **AllowedIPs strategy**: WireGuard peers use `AllowedIPs = 10.10.0.0/24` for safe testing; production will use game server IPs from ASN sync.
- **ASN sync**: `seed_games()` runs on API startup. `POST /api/games/sync` for manual re-sync.
- **4G data protection moat**: Only game server IPs routed over 4G. All other traffic stays on Starlink.
- **GitHub Pages deploy**: `git push origin main` — Fastly serves it automatically.
- **No Alembic in prod**: Tables created by `create_tables()` in `on_startup`.

## CSS variables (both index.html and React)

```
--black:#0a0a0a  --surface:#111  --border:#1e1e1e
--white:#f5f5f7  --dim:#86868b
--teal:#00c8d7   --green:#30d158  --orange:#ff9f0a  --red:#ff453a
```

## Bonding system

### Protocol (shared between server, Windows client, Android client)
- 4-byte big-endian sequence number prepended to every WireGuard packet
- seq=0 with payload "probe" = reachability probe (server echoes it back)
- Server deduplicates via sliding window (Deduplicator in server/bonding/protocol.go)
- Client sends each packet through ALL paths simultaneously; server picks first arrival

### Server (Germany VPS, game-mode.antijitter.com)
- `server/main.go` — multi-port UDP listener (4567 + 443 fallback for carriers blocking non-standard ports)
- Receives bonded packets → dedup → forward to local WireGuard (:51820)
- WireGuard replies → forward back via client's primary path
- `peer_api.go` — HTTP API for dynamic WireGuard peer add/remove
- Deploy: `deploy/bonding-server.sh`, systemd service `antijitter-bonding`

### Windows client (WORKING, in `client/`)
- Wails v2 app (Go backend + React frontend)
- **Multi-homing fix (CRITICAL lesson)**: `IP_UNICAST_IF` does NOT reliably force per-adapter egress on multi-homed Windows. Even with unconnected sockets + source IP binding, Windows routes all traffic through the lowest-metric default route. The ONLY reliable fix is adding explicit /32 host routes via each adapter's default gateway (`route add <server_ip>/32 via <gw> if <ifindex>`). See `client/iface/route_windows.go`.
- Socket approach: unconnected UDP sockets (ListenPacket + WriteTo/ReadFrom) with IP_UNICAST_IF set via net.ListenConfig.Control hook. The host routes do the actual work; IP_UNICAST_IF is belt-and-suspenders.
- Bonding client uses `bonding.ListenUDPViaInterface()` → returns unconnected `*net.UDPConn` + resolved server `*net.UDPAddr`
- Probe: `iface.probeOne()` sends seq=0 "probe" packet, expects echo within 8s (4s + 1 retransmit)
- Gateway discovery: PowerShell `Get-NetRoute -DestinationPrefix 0.0.0.0/0` (runs once at startup)
- App runs as admin (required for wintun + route manipulation)

### Android client (PLANNED)
- Android does NOT have the Windows routing issue — use `ConnectivityManager` + `Network.bindSocket()` to pin each UDP socket to a specific network (WiFi vs cellular). No host routes needed.
- Tunnel: Android `VpnService` provides a TUN fd directly (no wintun equivalent needed)
- Go bonding code compiles for Android via gomobile; only tunnel + bind layers need platform code
- UI: Kotlin + Jetpack Compose

### API endpoint (GET /api/config)
Returns per-user: WireGuard private key, address, DNS, peer key, allowed IPs, bonding server addresses, data limit.

## Pending work

- Weekly ASN sync scheduler (APScheduler) — currently only on startup
- Selective routing with real game IPs as WireGuard AllowedIPs
- UPnP open NAT implementation
- SWITCH hardware waitlist page
- Android app (bonding + VPN client)
- Windows app UI polish + installer
