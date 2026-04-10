from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..database import get_db
from ..models import Subscription, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


def _user_payload(user: User, sub: Subscription | None) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "subscription": {
            "plan": sub.plan,
            "status": sub.status,
            "has_wireguard": bool(sub.wireguard_private_key),
        }
        if sub
        else None,
    }


@router.post("/register", status_code=201)
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {"token": create_access_token(user.id), "user": _user_payload(user, None)}


@router.post("/login")
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User)
        .options(selectinload(User.subscriptions))
        .where(User.email == body.email)
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    active_sub = next(
        (s for s in user.subscriptions if s.status in ("active", "trialing")), None
    )
    return {"token": create_access_token(user.id), "user": _user_payload(user, active_sub)}


@router.get("/me")
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).options(selectinload(User.subscriptions)).where(User.id == user.id)
    )
    user = result.scalar_one()
    active_sub = next(
        (s for s in user.subscriptions if s.status in ("active", "trialing")), None
    )
    return _user_payload(user, active_sub)
