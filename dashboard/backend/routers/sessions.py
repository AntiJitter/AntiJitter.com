import csv
import io

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import Session, User

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _fmt(s: Session) -> dict:
    duration = None
    if s.ended_at and s.started_at:
        duration = int((s.ended_at - s.started_at).total_seconds())
    return {
        "id": s.id,
        "started_at": s.started_at.isoformat(),
        "ended_at": s.ended_at.isoformat() if s.ended_at else None,
        "duration_seconds": duration,
        "avg_ping": round(s.avg_ping, 1) if s.avg_ping is not None else None,
        "max_spike": round(s.max_spike, 1) if s.max_spike is not None else None,
        "failover_count": s.failover_count,
    }


@router.get("/history")
async def session_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .where(Session.user_id == user.id, Session.ended_at.isnot(None))
        .order_by(Session.started_at.desc())
        .limit(30)
    )
    return {"sessions": [_fmt(s) for s in result.scalars().all()]}


@router.get("/export")
async def export_csv(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .where(Session.user_id == user.id, Session.ended_at.isnot(None))
        .order_by(Session.started_at.desc())
    )
    rows = result.scalars().all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Duration (s)", "Avg Ping (ms)", "Max Spike (ms)", "Failovers"])
    for s in rows:
        dur = _fmt(s)["duration_seconds"] or ""
        w.writerow([
            s.started_at.date(),
            dur,
            round(s.avg_ping, 1) if s.avg_ping else "",
            round(s.max_spike, 1) if s.max_spike else "",
            s.failover_count,
        ])

    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=antijitter-sessions.csv"},
    )
