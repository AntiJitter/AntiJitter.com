"""GET /api/config — returns WireGuard + bonding config for the Windows app.

The Windows client calls this on startup to get everything it needs:
  - WireGuard private key + peer IP (auto-provisioned if not yet set)
  - Server public key
  - Bonding server address (Germany VPS)
  - 4G data limit

Network interfaces are auto-detected by the client — the server doesn't
know (or need to know) which adapters the user has.

This endpoint auto-provisions WireGuard keys if the user doesn't have them yet,
so the Windows app is fully self-configuring.
"""

import asyncio
import ipaddress

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import Subscription, User

router = APIRouter(prefix="/api/config", tags=["config"])

# Bonding system uses 10.10.0.0/24 (Germany VPS WireGuard subnet)
_SUBNET = ipaddress.IPv4Network("10.10.0.0/24")
_IP_POOL = [str(ip) for ip in list(_SUBNET.hosts())[1:]]  # .2 → .254

BONDING_SERVER = "game-mode.antijitter.com:4567"
DEFAULT_DATA_LIMIT_MB = 50_000  # 50 GB


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
    """Generate a WireGuard key pair using the wg CLI."""
    private_key = await _run("wg genkey")
    public_key = await _run(f"echo '{private_key}' | wg pubkey")
    return private_key, public_key


async def _next_peer_ip(db: AsyncSession) -> str:
    """Allocate the next available IP from the 10.10.0.0/24 pool."""
    result = await db.execute(select(Subscription.wireguard_peer_ip))
    used = {row[0] for row in result.all() if row[0]}
    for ip in _IP_POOL:
        if ip not in used:
            return ip
    raise HTTPException(status_code=503, detail="IP pool exhausted")


@router.get("")
async def get_config(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return full WireGuard + bonding config for the authenticated user."""
    # Find active subscription
    result = await db.execute(
        select(Subscription).where(
            Subscription.user_id == user.id,
            Subscription.status.in_(["active", "trialing"]),
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=403, detail="No active subscription")

    # Auto-provision WireGuard keys if not yet set
    if not sub.wireguard_private_key:
        private_key, public_key = await _generate_keypair()
        peer_ip = await _next_peer_ip(db)

        sub.wireguard_private_key = private_key
        sub.wireguard_public_key = public_key
        sub.wireguard_peer_ip = peer_ip

        # Add peer to live WireGuard on Germany VPS (best-effort)
        try:
            await _run(
                f"wg set {settings.wg_interface} peer {public_key} "
                f"allowed-ips {peer_ip}/32 persistent-keepalive 25"
            )
        except RuntimeError:
            pass  # wg not available in dev

        await db.commit()

    return {
        "wireguard": {
            "private_key": sub.wireguard_private_key,
            "address": f"{sub.wireguard_peer_ip}/24",
            "dns": "1.1.1.1",
            "peer_key": settings.server_wg_public_key,
            "allowed_ips": ["10.10.0.0/24"],
        },
        "bonding_server": BONDING_SERVER,
        "data_limit_mb": DEFAULT_DATA_LIMIT_MB,
    }
