import asyncio
import ipaddress

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import Subscription, User

router = APIRouter(prefix="/api/wireguard", tags=["wireguard"])

_SUBNET = ipaddress.IPv4Network("10.8.0.0/24")
# .1 is the server; hand out .2 → .254
_IP_POOL = [str(ip) for ip in list(_SUBNET.hosts())[1:]]


async def _run(cmd: str) -> str:
    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode().strip())
    return stdout.decode().strip()


async def _generate_keypair() -> tuple[str, str]:
    private_key = await _run("wg genkey")
    public_key = await _run(f"echo '{private_key}' | wg pubkey")
    return private_key, public_key


async def _next_ip(db: AsyncSession) -> str:
    result = await db.execute(select(Subscription.wireguard_peer_ip))
    used = {row[0] for row in result.all() if row[0]}
    for ip in _IP_POOL:
        if ip not in used:
            return ip
    raise HTTPException(status_code=503, detail="IP pool exhausted")


async def _active_sub(user: User, db: AsyncSession) -> Subscription:
    result = await db.execute(
        select(Subscription).where(
            Subscription.user_id == user.id,
            Subscription.status.in_(["active", "trialing"]),
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=403, detail="No active subscription")
    return sub


@router.post("/provision")
async def provision(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = await _active_sub(user, db)
    if sub.wireguard_private_key:
        raise HTTPException(status_code=409, detail="WireGuard already provisioned — use /config to download")

    private_key, public_key = await _generate_keypair()
    peer_ip = await _next_ip(db)

    # Best-effort: add peer to live wg interface (will fail gracefully in dev)
    try:
        await _run(
            f"wg set {settings.wg_interface} peer {public_key} "
            f"allowed-ips {peer_ip}/32 persistent-keepalive 25"
        )
    except RuntimeError:
        pass  # wg not present in dev environment

    sub.wireguard_public_key = public_key
    sub.wireguard_private_key = private_key
    sub.wireguard_peer_ip = peer_ip
    await db.commit()

    return {"peer_ip": peer_ip, "public_key": public_key}


@router.post("/revoke")
async def revoke(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Subscription).where(Subscription.user_id == user.id)
    )
    sub = result.scalar_one_or_none()
    if not sub or not sub.wireguard_public_key:
        raise HTTPException(status_code=404, detail="No WireGuard peer to revoke")

    try:
        await _run(
            f"wg set {settings.wg_interface} peer {sub.wireguard_public_key} remove"
        )
    except RuntimeError:
        pass

    sub.wireguard_public_key = None
    sub.wireguard_private_key = None
    sub.wireguard_peer_ip = None
    await db.commit()

    return {"revoked": True}


@router.get("/config", response_class=PlainTextResponse)
async def get_config(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = await _active_sub(user, db)
    if not sub.wireguard_private_key:
        raise HTTPException(
            status_code=404,
            detail="No config yet — POST /api/wireguard/provision first",
        )

    return f"""[Interface]
PrivateKey = {sub.wireguard_private_key}
Address = {sub.wireguard_peer_ip}/32
DNS = 1.1.1.1

[Peer]
PublicKey = {settings.server_wg_public_key}
Endpoint = {settings.vps_ip}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
"""
