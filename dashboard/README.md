# AntíJitter Dashboard

Real-time connection dashboard built with **React + Vite** (frontend) and **FastAPI** (backend).

## Stack

| Layer    | Tech                              |
|----------|-----------------------------------|
| Frontend | React 18, Vite, Recharts          |
| Backend  | FastAPI, Uvicorn, WebSockets      |
| Protocol | REST (status/events) + WebSocket (live metrics) |

## Running locally

### Backend

```bash
cd dashboard/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd dashboard/frontend
npm install
npm run dev        # http://localhost:3000
```

Vite proxies `/api` and `/ws` to `localhost:8000` automatically.

## Dashboard features

- **Connection cards** — live latency, packet loss, and signal for Starlink, 4G, and 5G
- **Latency chart** — rolling 60-second area chart showing all paths and the AntíJitter bonded output
- **Bonding panel** — throughput, packet loss, and uptime for the combined link
- **Failover log** — every Starlink satellite-handoff spike AntíJitter avoided, with before/after latency
- **Auto-reconnect** — WebSocket reconnects automatically if the backend restarts
