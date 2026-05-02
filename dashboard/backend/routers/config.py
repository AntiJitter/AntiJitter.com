"""GET /api/config returns WireGuard + bonding config for app clients.

The endpoint auto-provisions per-device WireGuard keys so one subscribed
account can run a phone and Windows PC at the same time without reusing the
same peer identity.
"""

import asyncio
import ipaddress
import logging
import re

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import Subscription, User, WireGuardDevice

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/config", tags=["config"])

# Bonding system uses 10.10.0.0/24 (Germany VPS WireGuard subnet).
_SUBNET = ipaddress.IPv4Network("10.10.0.0/24")
_IP_POOL = [str(ip) for ip in list(_SUBNET.hosts())[1:]]  # .2 -> .254

BONDING_PORTS = [4567, 443]
DEFAULT_DATA_LIMIT_MB = 50_000  # 50 GB
MAX_DEVICES_PER_SUBSCRIPTION = 3
DEFAULT_DEVICE_ID = "default"
_DEVICE_ID_RE = re.compile(r"[^A-Za-z0-9_.:-]+")

# Peers already registered with Germany during this API process lifetime.
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
    """Call the Germany VPS peer-management API to add the WireGuard peer."""
    if not settings.bonding_peer_api_token:
        logger.warning("bonding_peer_api_token not set; skipping peer registration")
        return

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

    result = await db.execute(select(WireGuardDevice.wireguard_peer_ip))
    used.update(row[0] for row in result.all() if row[0])

    for ip in _IP_POOL:
        if ip not in used:
            return ip
    raise HTTPException(status_code=503, detail="IP pool exhausted")


def _normalize_device_id(device_id: str | None) -> str:
    raw = (device_id or DEFAULT_DEVICE_ID).strip() or DEFAULT_DEVICE_ID
    normalized = _DEVICE_ID_RE.sub("-", raw)[:128].strip("-")
    return normalized or DEFAULT_DEVICE_ID


async def _device_for_config(
    db: AsyncSession,
    sub: Subscription,
    device_id: str,
    device_name: str | None,
) -> WireGuardDevice:
    result = await db.execute(
        select(WireGuardDevice).where(
            WireGuardDevice.subscription_id == sub.id,
            WireGuardDevice.device_id == device_id,
        )
    )
    device = result.scalar_one_or_none()
    clean_name = device_name[:128] if device_name else None

    if device:
        if clean_name and device.device_name != clean_name:
            device.device_name = clean_name
            await db.commit()
        return device

    result = await db.execute(
        select(WireGuardDevice).where(WireGuardDevice.subscription_id == sub.id)
    )
    devices = result.scalars().all()
    if len(devices) >= MAX_DEVICES_PER_SUBSCRIPTION:
        raise HTTPException(
            status_code=403,
            detail=f"Device limit reached ({MAX_DEVICES_PER_SUBSCRIPTION})",
        )

    # First modern device for an existing subscription adopts the legacy
    # single-peer columns so current users keep their original key/IP.
    if (
        not devices
        and sub.wireguard_private_key
        and sub.wireguard_public_key
        and sub.wireguard_peer_ip
    ):
        device = WireGuardDevice(
            subscription_id=sub.id,
            device_id=device_id,
            device_name=clean_name,
            wireguard_private_key=sub.wireguard_private_key,
            wireguard_public_key=sub.wireguard_public_key,
            wireguard_peer_ip=sub.wireguard_peer_ip,
        )
        db.add(device)
        await db.commit()
        await db.refresh(device)
        return device

    private_key, public_key = await _generate_keypair()
    peer_ip = await _next_peer_ip(db)

    await _register_peer_on_bonding_server(public_key, peer_ip)
    _registered_peers.add(public_key)

    device = WireGuardDevice(
        subscription_id=sub.id,
        device_id=device_id,
        device_name=clean_name,
        wireguard_private_key=private_key,
        wireguard_public_key=public_key,
        wireguard_peer_ip=peer_ip,
    )
    db.add(device)

    if not sub.wireguard_private_key:
        sub.wireguard_private_key = private_key
        sub.wireguard_public_key = public_key
        sub.wireguard_peer_ip = peer_ip

    await db.commit()
    await db.refresh(device)
    return device


def _bonding_hosts() -> list[str]:
    hosts = [h.strip() for h in settings.bonding_hosts.split(",") if h.strip()]
    if not hosts:
        return ["178.104.168.177"]
    return hosts


def _bonding_servers() -> list[str]:
    # Keep hosts grouped first so a client with multiple physical adapters can
    # pick distinct destination IPs before falling back to alternate ports.
    return [f"{host}:{port}" for host in _bonding_hosts() for port in BONDING_PORTS]


@router.get("")
async def get_config(
    x_antijitter_device_id: str | None = Header(default=None),
    x_antijitter_device_name: str | None = Header(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return full WireGuard + bonding config for the authenticated user."""
    result = await db.execute(
        select(Subscription).where(
            Subscription.user_id == user.id,
            Subscription.status.in_(["active", "trialing"]),
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=403, detail="No active subscription")

    device_id = _normalize_device_id(x_antijitter_device_id)
    device = await _device_for_config(db, sub, device_id, x_antijitter_device_name)

    if device.wireguard_public_key not in _registered_peers:
        await _register_peer_on_bonding_server(
            device.wireguard_public_key, device.wireguard_peer_ip
        )
        _registered_peers.add(device.wireguard_public_key)

    return {
        "wireguard": {
            "private_key": device.wireguard_private_key,
            "address": f"{device.wireguard_peer_ip}/24",
            "dns": "1.1.1.1",
            "peer_key": settings.server_wg_public_key,
            "allowed_ips": ["10.10.0.0/24"],
        },
        "bonding_servers": _bonding_servers(),
        "data_limit_mb": DEFAULT_DATA_LIMIT_MB,
    }
