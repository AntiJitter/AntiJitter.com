import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import AsyncSessionLocal, get_db
from ..models import Game, GameRequest

router = APIRouter(prefix="/api/games", tags=["games"])

INITIAL_GAMES = [
    {"name": "Call of Duty", "slug": "call-of-duty", "icon": "🎮", "asn": "AS21840", "regions": ["EU", "NA", "APAC"]},
    {"name": "Valorant", "slug": "valorant", "icon": "🎯", "asn": "AS6507", "regions": ["EU", "NA", "APAC"]},
    {"name": "League of Legends", "slug": "league-of-legends", "icon": "⚔️", "asn": "AS6507", "regions": ["EU", "NA", "APAC"]},
    {"name": "Steam / CS2", "slug": "steam", "icon": "🕹️", "asn": "AS32590", "regions": ["EU", "NA", "APAC"]},
    {"name": "Discord", "slug": "discord", "icon": "💬", "asn": "AS36459", "regions": ["Global"]},
    {"name": "Apex Legends", "slug": "apex-legends", "icon": "🎮", "asn": "AS20815", "regions": ["EU", "NA", "APAC"]},
    {"name": "FIFA / EA FC", "slug": "ea-fc", "icon": "⚽", "asn": "AS20815", "regions": ["EU", "NA"]},
    {"name": "Battlefield", "slug": "battlefield", "icon": "🎖️", "asn": "AS20815", "regions": ["EU", "NA"]},
    {"name": "Xbox Live / Halo", "slug": "xbox-live", "icon": "🟢", "asn": "AS8075", "regions": ["EU", "NA", "APAC"]},
    {"name": "Rainbow Six Siege", "slug": "rainbow-six", "icon": "🛡️", "asn": "AS29550", "regions": ["EU", "NA", "APAC"]},
]


async def fetch_asn_prefixes(asn: str) -> list[str]:
    url = f"https://stat.ripe.net/data/announced-prefixes/data.json?resource={asn}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            data = resp.json()
            if data.get("status") == "ok":
                return [p["prefix"] for p in data["data"]["prefixes"]]
    except Exception:
        pass
    return []


async def sync_game(game: Game) -> None:
    if not game.asn:
        return
    prefixes = await fetch_asn_prefixes(game.asn)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(Game).where(Game.id == game.id).values(
                ip_ranges=prefixes,
                range_count=len(prefixes),
                last_synced=datetime.now(timezone.utc),
            )
        )
        await db.commit()


async def seed_games() -> None:
    async with AsyncSessionLocal() as db:
        for g in INITIAL_GAMES:
            existing = await db.execute(select(Game).where(Game.slug == g["slug"]))
            if not existing.scalar_one_or_none():
                db.add(Game(**g))
        await db.commit()

        # Kick off ASN sync for games with no ranges yet
        result = await db.execute(select(Game).where(Game.range_count == 0))
        games = result.scalars().all()

    await asyncio.gather(*[sync_game(g) for g in games])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class GameOut(BaseModel):
    id: int
    name: str
    slug: str
    icon: str
    asn: Optional[str]
    regions: list
    status: str
    range_count: int
    last_synced: Optional[datetime]

    model_config = {"from_attributes": True}


class GameRequestIn(BaseModel):
    game_name: str
    platform: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    submitted_email: Optional[str] = None


class GameRequestOut(BaseModel):
    id: int
    game_name: str
    platform: Optional[str]
    notes: Optional[str]
    votes: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[GameOut])
async def list_games(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Game).where(Game.status == "active").order_by(Game.name)
    )
    return result.scalars().all()


@router.get("/stats")
async def games_stats(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Game).where(Game.status == "active"))
    games = result.scalars().all()
    total_ranges = sum(g.range_count for g in games)
    last_synced = max((g.last_synced for g in games if g.last_synced), default=None)
    return {
        "game_count": len(games),
        "range_count": total_ranges,
        "last_synced": last_synced,
    }


@router.get("/requests", response_model=list[GameRequestOut])
async def list_requests(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GameRequest)
        .where(GameRequest.status.in_(["pending", "in_review"]))
        .order_by(GameRequest.votes.desc(), GameRequest.created_at.desc())
    )
    return result.scalars().all()


@router.post("/request", response_model=GameRequestOut, status_code=201)
async def submit_request(body: GameRequestIn, db: AsyncSession = Depends(get_db)):
    # Prevent obvious duplicate requests (same game name, case-insensitive)
    existing = await db.execute(
        select(GameRequest).where(
            GameRequest.game_name.ilike(body.game_name),
            GameRequest.status.in_(["pending", "in_review"]),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A request for this game already exists — upvote it instead.")

    req = GameRequest(**body.model_dump())
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


@router.post("/requests/{request_id}/vote")
async def vote_request(request_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GameRequest).where(GameRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    req.votes += 1
    await db.commit()
    return {"votes": req.votes}


@router.post("/sync")
async def trigger_sync(background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Game).where(Game.status == "active"))
    games = result.scalars().all()
    for game in games:
        background_tasks.add_task(sync_game, game)
    return {"syncing": len(games)}
