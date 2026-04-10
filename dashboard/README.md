# AntíJitter Dashboard

Full-stack app — React 18 + Vite (frontend), FastAPI + PostgreSQL (backend).
Wraps into Electron (Windows .exe) and Capacitor (Android APK).

## Architecture

```
backend/          FastAPI API server
  main.py         REST + WebSocket entry point
  config.py       Settings loaded from .env
  database.py     SQLAlchemy async engine
  models.py       User / Subscription / Session ORM models
  auth.py         JWT + bcrypt helpers
  routers/
    auth.py       POST /api/auth/register|login  GET /api/auth/me
    wireguard.py  POST /api/wireguard/provision|revoke  GET /api/wireguard/config
    subscription.py  POST /api/subscription/create|webhook  GET /api/subscription/status
    sessions.py   GET /api/sessions/history|export
  alembic/        DB migrations (run: alembic upgrade head)

frontend/
  src/
    App.jsx               React Router root
    main.jsx              BrowserRouter entry
    contexts/AuthContext  JWT auth state + fetch helper
    pages/
      Login, Register     Auth forms
      Dashboard           Live metrics + session history tabs
      Subscription        Plan cards + active subscription view
      SubscriptionSuccess WireGuard .conf download
    components/
      ConnectionCard      Per-link status card
      LatencyChart        60 s rolling Recharts area chart
      BondingPanel        AntíJitter output stats
      FailoverLog         Caught spike events
      SessionHistory      DB-backed session table + CSV export
      ProtectedRoute      Redirect to /login if unauthenticated
    hooks/useMetrics      WebSocket stream + REST polling
  electron/
    main.js               BrowserWindow + system tray + notifications
    preload.js            Narrow IPC bridge for renderer
  capacitor.config.ts     Android/iOS Capacitor config
```

## Running locally

### 1. Database
```bash
# Start PostgreSQL then:
createdb antijitter
cd dashboard/backend
cp .env.example .env   # fill in your values
alembic upgrade head
```

### 2. Backend
```bash
cd dashboard/backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

### 3. Frontend (web)
```bash
cd dashboard/frontend
npm install
npm run dev   # → http://localhost:3000
```

### 4. Electron (Windows dev)
```bash
cd dashboard/frontend
npm run electron:dev
```

### 5. Electron (production build)
```bash
npm run electron:build   # → dist-electron/AntíJitter Setup.exe
```

### 6. Android (Capacitor)
```bash
npm run build                     # Vite build
npx cap add android               # first time only
npx cap sync android
npx cap open android              # opens Android Studio
```

## Subscription flow
1. User registers → POST /api/auth/register
2. Redirected to /dashboard/subscription → picks Solo (49 NOK) or Family (99 NOK)
3. Stripe Checkout with 7-day trial → webhook fires checkout.session.completed
4. Backend creates Subscription row (status=trialing)
5. User hits /dashboard/subscription/success → POST /api/wireguard/provision
6. WireGuard keypair generated, peer added to wg0 on Hetzner VPS
7. User downloads antijitter.conf → imports into WireGuard app

## Credentials needed (add to .env)
| Variable | Where to get |
|---|---|
| `DATABASE_URL` | Local PostgreSQL |
| `SECRET_KEY` | `openssl rand -hex 32` |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe CLI: `stripe listen --print-secret` |
| `STRIPE_PRICE_SOLO` | Create a 49 NOK/month price in Stripe |
| `STRIPE_PRICE_FAMILY` | Create a 99 NOK/month price in Stripe |
| `VPS_IP` | Hetzner dashboard |
| `SERVER_WG_PUBLIC_KEY` | Run `wg show wg0 public-key` on VPS |
