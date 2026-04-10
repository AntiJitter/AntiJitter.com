"""
AntíJitter — Starlink telemetry + outage tracking.

The SWITCH's starlink_poller.py pushes batched snapshots every 5 s.
This router:
  1. Stores snapshots in an in-memory ring buffer (live charts).
  2. Detects obstructions → persists OutageEvent rows to DB.
  3. Closes outage records when the dish recovers.
  4. Exposes /latest, /history and /outages for the frontend.
"""

import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import OutageEvent, User

router = APIRouter(prefix="/api/starlink", tags=["starlink"])

# ── In-memory ring buffer ─────────────────────────────────────────────────────
_telemetry: list[dict] = []
_MAX = 300   # ~25 min of 5-s buckets

# Tracks open (unresolved) outages per user: { user_id → outage_db_id }
_open_outage: dict[int, int] = {}


# ── Pydantic schemas ──────────────────────────────────────────────────────────

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/telemetry")
async def ingest_telemetry(
    body: TelemetryIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Called by starlink_poller.py every PUSH_INTERVAL seconds.
    Detects outage start/end and persists to DB.
    """
    # ── Ring buffer ───────────────────────────────────────────────────────────
    record = body.model_dump()
    record["server_ts"] = time.time()
    _telemetry.append(record)
    if len(_telemetry) > _MAX:
        del _telemetry[:-_MAX]

    # ── Outage state machine ──────────────────────────────────────────────────
    uid = user.id
    outage_opened = False
    outage_closed = False

    if body.obstructed and uid not in _open_outage:
        # New outage — open a DB record
        cause = body.outage_causes[0] if body.outage_causes else "OBSTRUCTED"
        outage = OutageEvent(
            user_id=uid,
            started_at=_now(),
            cause=cause,
            latency_ms=body.avg_latency_ms,
        )
        db.add(outage)
        await db.commit()
        await db.refresh(outage)
        _open_outage[uid] = outage.id
        outage_opened = True

    elif not body.obstructed and uid in _open_outage:
        # Recovery — close the open outage record
        outage_id = _open_outage.pop(uid)
        result = await db.execute(
            select(OutageEvent).where(OutageEvent.id == outage_id)
        )
        outage = result.scalar_one_or_none()
        if outage:
            now = _now()
            outage.ended_at = now
            outage.duration_seconds = round(
                (now - outage.started_at).total_seconds(), 1
            )
            await db.commit()
        outage_closed = True

    return {
        "ok": True,
        "stored": len(_telemetry),
        "outage_opened": outage_opened,
        "outage_closed": outage_closed,
    }


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
    """Last N telemetry records (default 60 ≈ 5 min of 5-s buckets)."""
    return {"records": _telemetry[-n:]}


@router.get("/outages")
async def outage_history(
    limit: int = 20,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Last N outage events for this user, newest first.
    Open outages (ended_at=None) appear at the top.
    """
    result = await db.execute(
        select(OutageEvent)
        .where(OutageEvent.user_id == user.id)
        .order_by(OutageEvent.started_at.desc())
        .limit(limit)
    )
    outages = result.scalars().all()

    return {
        "outages": [
            {
                "id": o.id,
                "started_at": o.started_at.isoformat(),
                "ended_at": o.ended_at.isoformat() if o.ended_at else None,
                "duration_seconds": o.duration_seconds,
                "cause": o.cause,
                "latency_ms": o.latency_ms,
                "resolved": o.ended_at is not None,
            }
            for o in outages
        ],
        "open_count": sum(1 for o in outages if o.ended_at is None),
    }
