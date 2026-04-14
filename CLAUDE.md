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
```

## Finland VPS deployment

```bash
# SSH
ssh antijitter@app.antijitter.com

# Deploy (run as antijitter user)
cd /opt/antijitter
git fetch origin claude/build-dashboard-app-3JwBC
git reset --hard FETCH_HEAD

# Rebuild frontend
cd dashboard/frontend
npm run build    # if EACCES: sudo chown -R antijitter:antijitter node_modules dist

# Restart API
sudo systemctl restart antijitter-api
```

Service file: `/etc/systemd/system/antijitter-api.service`  
DB: SQLite at `/opt/antijitter/dashboard/backend/antijitter.db`  
Nginx config: `/etc/nginx/sites-available/antijitter`

## Active development branch

`claude/build-dashboard-app-3JwBC` — all changes go here, push to this branch.

## Key design decisions

- **AllowedIPs strategy**: WireGuard peers use `AllowedIPs = 10.10.0.0/24` for safe testing; production will use game server IPs from ASN sync.
- **ASN sync**: `seed_games()` runs on API startup (inserts missing games, syncs range_count==0). `POST /api/games/sync` for manual re-sync.
- **RIPE NCC API**: `https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS21840`
- **4G data protection moat**: Only game server IPs (from ASN) are routed over 4G. All other traffic stays on Starlink.
- **GitHub Pages deploy**: `git push origin main` — Fastly serves it automatically.
- **No Alembic in prod**: Tables created by `create_tables()` in `on_startup`. Alembic password auth fails; skip it.

## Games in database (INITIAL_GAMES in routers/games.py)

Call of Duty (AS21840), Valorant (AS6507), League of Legends (AS6507), Steam/CS2 (AS32590), Discord (AS36459), Apex Legends (AS20815), FIFA/EA FC (AS20815), Battlefield (AS20815), Xbox Live/Halo (AS8075), Rainbow Six Siege (AS29550), PlayStation Network (AS45194)

## CSS variables (both index.html and React)

```
--black:#0a0a0a  --surface:#111  --border:#1e1e1e
--white:#f5f5f7  --dim:#86868b
--teal:#00c8d7   --green:#30d158  --orange:#ff9f0a  --red:#ff453a
```

## Pending work

- Weekly ASN sync scheduler (APScheduler) — currently only on startup
- Engarde bonding client for Windows (Go binary)
- Selective routing with real game IPs as WireGuard AllowedIPs
- UPnP open NAT implementation
- SWITCH hardware waitlist page
