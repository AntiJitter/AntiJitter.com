"""
AntíJitter — Starlink telemetry endpoint.
Receives periodic pushes from the SWITCH's starlink_poller.py and
serves the latest snapshot to the frontend.
"""

import time
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import get_current_user
from ..models import User

router = APIRouter(prefix="/api/starlink", tags=["starlink"])

# In-memory ring buffer — last 300 samples (~5 min at 1-s polling)
_telemetry: list[dict] = []
_MAX = 300


class TelemetryIn(BaseModel):
    avg_latency_ms:       Optional[float] = None
    max_latency_ms:       Optional[float] = None
    avg_drop_rate:        Optional[float] = None
    obstructed:           bool            = False
    outage_causes:        list[str]       = []
    snr:                  Optional[float] = None
    signal_quality:       Optional[float] = None
    obstruction_pct:      Optional[float] = None
    downlink_mbps:        Optional[float] = None
    uplink_mbps:          Optional[float] = None
    sample_count:         int             = 1
    window_seconds:       float           = 5.0


@router.post("/telemetry")
async def ingest_telemetry(
    body: TelemetryIn,
    user: User = Depends(get_current_user),
):
    """
    Called by starlink_poller.py on the SWITCH every PUSH_INTERVAL seconds.
    Stores the snapshot; frontend reads via GET /api/starlink/latest.
    """
    record = body.model_dump()
    record["server_ts"] = time.time()
    _telemetry.append(record)
    if len(_telemetry) > _MAX:
        del _telemetry[:-_MAX]
    return {"ok": True, "stored": len(_telemetry)}


@router.get("/latest")
async def latest_telemetry(user: User = Depends(get_current_user)):
    """Most recent telemetry snapshot from the dish."""
    if not _telemetry:
        return {"available": False}
    return {"available": True, "data": _telemetry[-1]}


@router.get("/history")
async def telemetry_history(
    n: int = 60,
    user: User = Depends(get_current_user),
):
    """Last N telemetry records (default 60 = ~5 min of 5-s buckets)."""
    return {"records": _telemetry[-n:]}
