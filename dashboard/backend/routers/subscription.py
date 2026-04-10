import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import Subscription, User

router = APIRouter(prefix="/api/subscription", tags=["subscription"])

PLANS = {
    "solo": {"label": "AntíJitter", "usd": 5, "devices": "unlimited"},
}


def _stripe():
    stripe.api_key = settings.stripe_secret_key
    return stripe


@router.post("/create")
async def create_checkout(
    plan: str = "solo",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if plan not in PLANS:
        raise HTTPException(status_code=400, detail=f"Invalid plan — choose: {list(PLANS)}")

    price_id = settings.stripe_price_solo if plan == "solo" else settings.stripe_price_family
    if not price_id:
        raise HTTPException(status_code=503, detail="Stripe prices not configured yet")

    s = _stripe()
    session = s.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        subscription_data={"trial_period_days": 7},
        success_url=(
            "http://localhost:3000/dashboard/subscription/success"
            "?session_id={CHECKOUT_SESSION_ID}"
        ),
        cancel_url="http://localhost:3000/dashboard/subscription",
        customer_email=user.email,
        metadata={"user_id": str(user.id), "plan": plan},
    )
    return {"url": session.url}


@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = _stripe().Webhook.construct_event(
            payload, sig, settings.stripe_webhook_secret
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    etype = event["type"]
    data = event["data"]["object"]

    if etype == "checkout.session.completed":
        user_id = int(data["metadata"]["user_id"])
        plan = data["metadata"]["plan"]
        sub = Subscription(
            user_id=user_id,
            plan=plan,
            status="trialing",
            stripe_customer_id=data["customer"],
            stripe_subscription_id=data["subscription"],
        )
        db.add(sub)
        await db.commit()

    elif etype == "invoice.payment_succeeded":
        result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == data["subscription"]
            )
        )
        sub = result.scalar_one_or_none()
        if sub:
            sub.status = "active"
            await db.commit()

    elif etype == "invoice.payment_failed":
        result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == data["subscription"]
            )
        )
        sub = result.scalar_one_or_none()
        if sub:
            sub.status = "past_due"
            await db.commit()

    elif etype == "customer.subscription.deleted":
        result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == data["id"]
            )
        )
        sub = result.scalar_one_or_none()
        if sub:
            sub.status = "inactive"
            await db.commit()
            # Kick off key revocation inline
            if sub.wireguard_public_key:
                import asyncio
                try:
                    proc = await asyncio.create_subprocess_shell(
                        f"wg set {settings.wg_interface} peer {sub.wireguard_public_key} remove",
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await proc.communicate()
                except Exception:
                    pass
                sub.wireguard_public_key = None
                sub.wireguard_private_key = None
                sub.wireguard_peer_ip = None
                await db.commit()

    return {"ok": True}


@router.get("/status")
async def subscription_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )
    subs = result.scalars().all()
    active = next((s for s in subs if s.status in ("active", "trialing")), None)

    if not active:
        return {"has_subscription": False}

    return {
        "has_subscription": True,
        "plan": active.plan,
        "status": active.status,
        "has_wireguard": bool(active.wireguard_private_key),
        "expires_at": active.expires_at.isoformat() if active.expires_at else None,
        "plan_details": PLANS[active.plan],
    }
