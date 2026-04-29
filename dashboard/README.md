# AntiJitter Dashboard

The dashboard is the web control and proof surface at `app.antijitter.com`.
It is not the Android app and it is not the Windows client. Android lives in
`android/`; Windows lives in `client/`.

This README is a practical handoff for future dashboard work. If it conflicts
with `../CLAUDE.md`, `../CLAUDE.md` wins. For visual design, read
`../docs/ui-spec.md` first.

## Current Role

The dashboard should:

- Handle account login, registration, subscription state, and config access.
- Show live connection quality in the same product language as the Android app.
- Provide proof that AntiJitter is working: latency, jitter, path status,
  seamless failovers, Starlink events, and session history.
- Stay honest about simulated or approximate data.
- Eventually mirror the Android app's modern layout on web and mobile
  breakpoints.

The current Android app is the best app UI reference. Dashboard modernization
should follow Android's compact, telemetry-first design rather than older
dashboard mockups.

## Current Reality

Built and useful:

- React/Vite frontend with auth-protected dashboard routes.
- FastAPI backend with auth, subscriptions, config, WireGuard peer management,
  games database, ping logging, Starlink telemetry endpoints, and session
  history.
- Public `/jitter-test` and `/games` pages.
- Dashboard tabs: Live, Connections, History.
- Starlink chart components and outage timeline components.
- `/api/config` used by Android and Windows to fetch WireGuard and bonding
  config.

Important caveat:

- Some dashboard live metrics are still simulated in `backend/main.py`
  (`/api/status`, `/api/events`, and `/ws/metrics`). Do not present those values
  as measured production telemetry.
- Starlink telemetry endpoints under `/api/starlink/*` are real ingestion and
  history endpoints, but they need a poller/client pushing data.
- Android now has newer, more honest path latency and failover behavior than the
  dashboard simulation. When modernizing the dashboard, align it with Android's
  current concepts.

Not current / stale:

- This dashboard is no longer the plan for Android packaging. Android is a
  native Kotlin/Compose app in `android/`.
- This dashboard is no longer the plan for the Windows app. Windows is a Wails
  app in `client/`.
- Electron scripts exist in `dashboard/frontend/package.json`, but they are not
  the current Windows product path.
- Do not revive old Capacitor/Electron assumptions unless the user explicitly
  changes product direction.

## Repo Layout

```text
dashboard/
  backend/
    main.py                 FastAPI app, router includes, simulated metrics
    config.py               Pydantic settings loaded from .env
    database.py             SQLAlchemy async engine/session helpers
    models.py               User, Subscription, Session, Outage/Ping models
    auth.py                 JWT/password helpers and current-user dependency
    routers/
      auth.py               /api/auth register/login/me
      config.py             /api/config WireGuard + bonding config
      wireguard.py          legacy/direct WireGuard provisioning
      subscription.py       Stripe subscription endpoints/webhooks
      sessions.py           session history/export
      connections.py        Linux interface scan/toggle helpers
      starlink.py           Starlink telemetry ingest/history/outages
      ping_log.py           logged ping samples
      games.py              game database and coverage stats
    alembic/                migrations
    requirements.txt

  frontend/
    src/
      App.jsx               React Router routes
      contexts/AuthContext.jsx
      hooks/useMetrics.js   dashboard metrics stream/polling
      hooks/usePingLogger.js
      pages/
        Dashboard.jsx       Live/Connections/History tabs
        Connections.jsx
        JitterTest.jsx
        GamesDatabase.jsx
        Login.jsx
        Register.jsx
        Subscription.jsx
        SubscriptionSuccess.jsx
      components/
        ActivePathsCard.jsx
        BondingPanel.jsx
        StarlinkPingChart.jsx
        LatencyChart.jsx
        OutageTimeline.jsx
        FailoverLog.jsx
        SessionHistory.jsx
        ProtectedRoute.jsx
        PublicNav.jsx
```

## Design Direction

Keep dashboard UI aligned with the current Android app:

- Minimal dark Apple-style utility UI.
- Compact cards, dense metrics, low prose.
- Heavy tabular numerals for live values.
- Teal for AntiJitter/Game Mode, green for healthy, orange for marginal, red for
  degraded.
- Use **Mobile data**, not "cellular" in user-facing copy.
- Use **Seamless failovers**, not "caught failovers" or "outages avoided".
- Keep **Game Mode** as the master product toggle language.
- Keep **Gaming** and **Browsing** as the two send-strategy labels.
- Do not use large marketing-style dashboard cards inside the app surface.

The Android HomeScreen information hierarchy is the current target:

1. Header/status.
2. Game Mode / bonded latency hero.
3. Mode selector.
4. Active paths with right-aligned latency and smaller jitter below.
5. Session stats: Sent, Received, Mobile, Failovers.
6. Starlink status/events.
7. Gateway/share guidance where relevant.

## Product Promise Boundaries

Do not imply that Android/iOS can share a bonded hotspot to Xbox or PC.
Testing showed Android hotspot and USB tethering bypass the app VPN for tethered
clients. The dashboard and marketing should reflect the current product story:

- Android app: bonded connection for the phone itself.
- Windows app: current gateway proof path for PC/Xbox.
- AntiJitter Switch: long-term router product for consoles and whole-home
  sharing.

## Real vs Simulated Data

Treat data sources carefully:

- `backend/main.py` simulated metrics:
  - `GET /api/status`
  - `GET /api/events`
  - `WebSocket /ws/metrics`
- Real/auth-backed config and account surfaces:
  - `/api/auth/*`
  - `/api/subscription/*`
  - `/api/config`
  - `/api/sessions/*`
  - `/api/games/*`
- Real Starlink telemetry surfaces when a client/poller is posting:
  - `POST /api/starlink/telemetry`
  - `GET /api/starlink/latest`
  - `GET /api/starlink/history`
  - `GET /api/starlink/outages`
- Public probe/logging surfaces:
  - `GET /api/ping`
  - ping log endpoints in `routers/ping_log.py`

When improving charts, prefer real measured values. If a chart still uses
simulation, label it internally in code/comments and do not use it for marketing
claims.

## Modernization Priorities

Recommended order:

1. Remove or quarantine simulated dashboard metrics from production-facing UI.
2. Mirror the Android app's current card hierarchy and terminology.
3. Replace old Starlink/Game Mode chart assumptions with real path or
   through-tunnel data where available.
4. Align subscription/account state with what Android and Windows need.
5. Add a Windows/Xbox gateway section once Windows route-all proof works.
6. Keep `docs/ui-spec.md` updated for any visual decisions that should carry
   back to Android or Windows.

Out of scope unless explicitly requested:

- Rebuilding Android through dashboard/Capacitor.
- Rebuilding Windows through dashboard/Electron.
- Backend/server protocol changes during UI-only work.

## Running Locally

### Backend

Create and fill `dashboard/backend/.env` from `.env.example`.

```bash
cd dashboard/backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn dashboard.backend.main:app --reload --port 8000
```

Depending on how your Python path is set up, this also works from inside
`dashboard/`:

```bash
uvicorn backend.main:app --reload --port 8000
```

### Frontend

```bash
cd dashboard/frontend
npm install
npm run dev
```

Vite defaults to `http://localhost:5173` unless configured otherwise.

### Production Deploy Note

The Finland VPS deploy is manual today:

```bash
ssh antijitter@app.antijitter.com
cd /opt/antijitter
git pull
cd dashboard/frontend
npm run build
sudo systemctl restart antijitter-api
```

Confirm the actual service path before running production commands; do not
invent deployment paths in code or docs.

## Environment Variables

Configured through `dashboard/backend/.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLAlchemy async database URL |
| `SECRET_KEY` | JWT signing secret |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_SOLO` | Stripe solo price id |
| `STRIPE_PRICE_FAMILY` | Stripe family price id |
| `VPS_IP` | VPS address used by legacy/provisioning flows |
| `SERVER_WG_PUBLIC_KEY` | WireGuard server public key |
| `WG_INTERFACE` | WireGuard interface name, default `wg0` |
| `BONDING_PEER_API_URL` | Germany VPS peer-management API |
| `BONDING_PEER_API_TOKEN` | Token for peer-management API |

Never commit a real `.env` file or production secret.
