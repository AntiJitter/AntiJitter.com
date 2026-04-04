import asyncio
import json
import math
import random
import time
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AntíJitter Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

START_TIME = time.time()
failover_events: list[dict] = []
_last_starlink_spike_ts = 0.0


def _starlink(t: float) -> float:
    """Starlink: low base latency with periodic satellite-handoff spikes."""
    base = 25 + 5 * math.sin(t * 0.3)
    # spike every ~45 s, lasts a few seconds
    spike_phase = math.sin(t * (2 * math.pi / 45))
    spike = 220 * max(0, spike_phase - 0.92) / 0.08 if spike_phase > 0.92 else 0
    return max(1.0, base + spike + random.gauss(0, 3))


def _four_g(t: float) -> float:
    """4G LTE: higher base, very stable."""
    return max(1.0, 46 + 8 * math.sin(t * 0.2 + 1) + random.gauss(0, 4))


def _five_g(t: float) -> float:
    """5G: lowest latency, stable."""
    return max(1.0, 18 + 3 * math.sin(t * 0.4 + 2) + random.gauss(0, 2))


def _bonded(sl: float, fg: float, fiveg: float) -> float:
    return min(sl, fg, fiveg) * 0.95


def _packet_loss(latency: float, baseline: float) -> float:
    if latency > baseline * 4:
        return round(random.uniform(3.0, 9.0), 2)
    if latency > baseline * 2:
        return round(random.uniform(0.5, 2.5), 2)
    return round(random.uniform(0.0, 0.4), 2)


def _signal(lo: float, hi: float) -> float:
    return round(random.uniform(lo, hi), 1)


def _snapshot(t: float) -> dict:
    sl = _starlink(t)
    fg = _four_g(t)
    fiveg = _five_g(t)
    bond = _bonded(sl, fg, fiveg)
    return {
        "starlink": sl, "4g": fg, "5g": fiveg, "bonded": bond,
        "sl_loss": _packet_loss(sl, 25),
        "fg_loss": _packet_loss(fg, 46),
        "fiveg_loss": _packet_loss(fiveg, 18),
    }


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
                "signal_pct": _signal(75, 95),
                "status": "degraded" if s["starlink"] > 100 else "good",
            },
            "4g": {
                "name": "4G LTE", "icon": "📶",
                "latency_ms": round(s["4g"], 1),
                "packet_loss_pct": s["fg_loss"],
                "signal_pct": _signal(60, 85),
                "status": "good",
            },
            "5g": {
                "name": "5G", "icon": "⚡",
                "latency_ms": round(s["5g"], 1),
                "packet_loss_pct": s["fiveg_loss"],
                "signal_pct": _signal(70, 92),
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


@app.websocket("/ws/metrics")
async def metrics_ws(websocket: WebSocket):
    global _last_starlink_spike_ts
    await websocket.accept()
    try:
        while True:
            t = time.time() - START_TIME
            s = _snapshot(t)

            # Record failover event when Starlink spikes hard
            if s["starlink"] > 150:
                now = time.time()
                if now - _last_starlink_spike_ts > 8:
                    _last_starlink_spike_ts = now
                    alt = "5G" if s["5g"] < s["4g"] else "4G LTE"
                    failover_events.append({
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "from": "Starlink",
                        "to": alt,
                        "latency_before_ms": round(s["starlink"], 1),
                        "latency_after_ms": round(min(s["4g"], s["5g"]), 1),
                        "saved_ms": round(s["starlink"] - min(s["4g"], s["5g"]), 1),
                    })

            payload = {
                "t": round(t, 2),
                "starlink": round(s["starlink"], 1),
                "4g": round(s["4g"], 1),
                "5g": round(s["5g"], 1),
                "bonded": round(s["bonded"], 1),
            }
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
