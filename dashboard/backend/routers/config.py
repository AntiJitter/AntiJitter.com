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
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import Subscription, User

router = APIRouter(prefix="/api/config", tags=["config"])

# Bonding system uses 10.10.0.0/24 (Germany VPS WireGuard subnet)
_SUBNET = ipaddress.IPv4Network("10.10.0.0/24")
_IP_POOL = [str(ip) for ip in list(_SUBNET.hosts())[1:]]  # .2 → .254

BONDING_SERVER = "178.104.168.177:4567"  # TODO: game-mode.antijitter.com once DNS is set
DEFAULT_DATA_LIMIT_MB = 50_000  # 50 GB

# Peers we've already registered with Germany during this process's lifetime.
# After an API restart this resets, and we re-register on the next /api/config —
# which is idempotent (wg set replaces existing peers) and self-heals any drift
# between the SQLite keys and the live WireGuard server.
_registered_peers: set[str] = set()


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


async def _register_peer_on_bonding_server(public_key: str, peer_ip: str) -> None:
    """Call the Germany VPS peer-management API to add the WireGuard peer.

    Raises HTTPException if the call fails — we can't let the user connect
    with keys that aren't registered on the server (handshake would fail).
    """
    if not settings.bonding_peer_api_token:
        logger.warning("bonding_peer_api_token not set — skipping peer registration")
        return

    # Strip any CIDR suffix — the Germany server expects a bare IP
    bare_ip = peer_ip.split("/", 1)[0]

    url = f"{settings.bonding_peer_api_url}/peers"
    headers = {"Authorization": f"Bearer {settings.bonding_peer_api_token}"}
    payload = {"public_key": public_key, "peer_ip": bare_ip}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as e:
        logger.exception("peer API request failed")
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach bonding server to register peer: {e}",
        )

    if resp.status_code != 200:
        logger.error("peer API returned %s: %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=503,
            detail=f"Bonding server rejected peer registration ({resp.status_code})",
        )


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

        # Register on Germany VPS first — if this fails we don't persist
        # keys that can't actually connect
        await _register_peer_on_bonding_server(public_key, peer_ip)
        _registered_peers.add(public_key)

        sub.wireguard_private_key = private_key
        sub.wireguard_public_key = public_key
        sub.wireguard_peer_ip = peer_ip
        await db.commit()
    elif sub.wireguard_public_key not in _registered_peers:
        # Keys exist in DB but we haven't confirmed they're live on Germany
        # (API restart, earlier registration failure, stale DB from before the
        # peer API existed). Register now — wg set is idempotent.
        await _register_peer_on_bonding_server(
            sub.wireguard_public_key, sub.wireguard_peer_ip
        )
        _registered_peers.add(sub.wireguard_public_key)

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
