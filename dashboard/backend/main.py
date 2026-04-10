import asyncio
import json
import math
import random
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .auth import decode_token
from .config import settings  # noqa: F401 — ensures .env is loaded early
from .database import AsyncSessionLocal, create_tables
from .models import Session as SessionModel
from .routers import auth, connections, sessions, starlink, subscription, wireguard

app = FastAPI(title="AntíJitter API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(wireguard.router)
app.include_router(subscription.router)
app.include_router(sessions.router)
app.include_router(connections.router)
app.include_router(starlink.router)


@app.on_event("startup")
async def on_startup():
    await create_tables()


# ── Simulation helpers ────────────────────────────────────────────────────────

START_TIME = time.time()
failover_events: list[dict] = []
_last_spike_ts = 0.0


def _starlink(t: float) -> float:
    base = 25 + 5 * math.sin(t * 0.3)
    phase = math.sin(t * (2 * math.pi / 45))
    spike = 220 * max(0, phase - 0.92) / 0.08 if phase > 0.92 else 0
    return max(1.0, base + spike + random.gauss(0, 3))


def _four_g(t: float) -> float:
    return max(1.0, 46 + 8 * math.sin(t * 0.2 + 1) + random.gauss(0, 4))


def _five_g(t: float) -> float:
    return max(1.0, 18 + 3 * math.sin(t * 0.4 + 2) + random.gauss(0, 2))


def _bonded(sl: float, fg: float, fiveg: float) -> float:
    return min(sl, fg, fiveg) * 0.95


def _loss(latency: float, baseline: float) -> float:
    if latency > baseline * 4:
        return round(random.uniform(3.0, 9.0), 2)
    if latency > baseline * 2:
        return round(random.uniform(0.5, 2.5), 2)
    return round(random.uniform(0.0, 0.4), 2)


def _snapshot(t: float) -> dict:
    sl = _starlink(t)
    fg = _four_g(t)
    fiveg = _five_g(t)
    bond = _bonded(sl, fg, fiveg)
    return {
        "starlink": sl, "4g": fg, "5g": fiveg, "bonded": bond,
        "sl_loss": _loss(sl, 25), "fg_loss": _loss(fg, 46), "fiveg_loss": _loss(fiveg, 18),
    }


# ── REST endpoints ────────────────────────────────────────────────────────────

@app.get("/api/status")
async def get_status():
    t = time.time() - START_TIME
    s = _snapshot(t)
    return {
        "uptime_seconds": int(t),
        "connections": {
            "starlink": {
                "name": "Starlink", "icon": "🛰",
                "latency_ms": round(s["starlink"], 1),
                "packet_loss_pct": s["sl_loss"],
                "signal_pct": round(random.uniform(75, 95), 1),
                "status": "degraded" if s["starlink"] > 100 else "good",
            },
            "4g": {
                "name": "4G LTE", "icon": "📶",
                "latency_ms": round(s["4g"], 1),
                "packet_loss_pct": s["fg_loss"],
                "signal_pct": round(random.uniform(60, 85), 1),
                "status": "good",
            },
            "5g": {
                "name": "5G", "icon": "⚡",
                "latency_ms": round(s["5g"], 1),
                "packet_loss_pct": s["fiveg_loss"],
                "signal_pct": round(random.uniform(70, 92), 1),
                "status": "good",
            },
        },
        "bonded": {
            "latency_ms": round(s["bonded"], 1),
            "packet_loss_pct": round(random.uniform(0.0, 0.08), 2),
            "throughput_mbps": round(random.uniform(48, 68), 1),
        },
        "packets_routed": int(t * 1250),
        "total_failovers": len(failover_events),
    }


@app.get("/api/events")
async def get_events():
    return {"events": list(reversed(failover_events[-20:]))}


# ── WebSocket — real-time metrics + session logging ───────────────────────────

@app.websocket("/ws/metrics")
async def metrics_ws(websocket: WebSocket, token: Optional[str] = None):
    global _last_spike_ts
    await websocket.accept()

    # Authenticate if token provided
    user_id: Optional[int] = None
    session_db_id: Optional[int] = None

    if token:
        user_id = decode_token(token)
        if user_id:
            async with AsyncSessionLocal() as db:
                session_record = SessionModel(
                    user_id=user_id,
                    started_at=datetime.now(timezone.utc),
                )
                db.add(session_record)
                await db.commit()
                await db.refresh(session_record)
                session_db_id = session_record.id

    # Tracking accumulators
    pings: list[float] = []
    max_spike = 0.0
    failover_count = 0

    try:
        while True:
            t = time.time() - START_TIME
            s = _snapshot(t)

            bonded_val = round(s["bonded"], 1)
            pings.append(bonded_val)
            if bonded_val > max_spike:
                max_spike = bonded_val

            # Record failover events when Starlink spikes
            if s["starlink"] > 150:
                now = time.time()
                if now - _last_spike_ts > 8:
                    _last_spike_ts = now
                    failover_count += 1
                    alt = "5G" if s["5g"] < s["4g"] else "4G LTE"
                    failover_events.append({
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "from": "Starlink",
                        "to": alt,
                        "latency_before_ms": round(s["starlink"], 1),
                        "latency_after_ms": round(min(s["4g"], s["5g"]), 1),
                        "saved_ms": round(s["starlink"] - min(s["4g"], s["5g"]), 1),
                    })

            await websocket.send_text(json.dumps({
                "t": round(t, 2),
                "starlink": round(s["starlink"], 1),
                "4g": round(s["4g"], 1),
                "5g": round(s["5g"], 1),
                "bonded": bonded_val,
            }))
            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        # Save session stats to DB if authenticated
        if session_db_id and pings:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SessionModel).where(SessionModel.id == session_db_id)
                )
                record = result.scalar_one_or_none()
                if record:
                    record.ended_at = datetime.now(timezone.utc)
                    record.avg_ping = sum(pings) / len(pings)
                    record.max_spike = max_spike
                    record.failover_count = failover_count
                    await db.commit()
