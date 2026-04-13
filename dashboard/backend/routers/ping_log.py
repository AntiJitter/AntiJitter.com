from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import PingLog, User

router = APIRouter(prefix="/api/ping", tags=["ping"])


class PingEntry(BaseModel):
    ts: datetime
    latency_ms: float


class PingBatch(BaseModel):
    samples: List[PingEntry]


@router.post("/log")
async def log_pings(
    batch: PingBatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for entry in batch.samples:
        db.add(PingLog(user_id=user.id, ts=entry.ts, latency_ms=entry.latency_ms))

    # Purge records older than 24 hours to keep the table lean
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    await db.execute(
        delete(PingLog).where(
            PingLog.user_id == user.id,
            PingLog.ts < cutoff,
        )
    )
    await db.commit()
    return {"ok": True, "saved": len(batch.samples)}


@router.get("/history")
async def get_ping_history(
    hours: int = 2,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    hours = min(max(hours, 1), 24)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(PingLog)
        .where(PingLog.user_id == user.id, PingLog.ts >= cutoff)
        .order_by(PingLog.ts.asc())
    )
    logs = result.scalars().all()
    return {
        "samples": [
            {"ts": p.ts.isoformat(), "latency_ms": p.latency_ms}
            for p in logs
        ]
    }
