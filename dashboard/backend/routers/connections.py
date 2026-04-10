import asyncio
import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_user
from ..models import User

router = APIRouter(prefix="/api/connections", tags=["connections"])

# Map interface name prefixes → type metadata
IFACE_TYPES = {
    "eth":  {"type": "starlink", "label": "Starlink",     "icon": "satellite"},
    "usb":  {"type": "phone",    "label": "Phone Tether", "icon": "phone"},
    "wlan": {"type": "wifi",     "label": "WiFi",         "icon": "wifi"},
    "wwan": {"type": "cellular", "label": "Cellular",     "icon": "cellular"},
    "sim":  {"type": "cellular", "label": "SIM Card",     "icon": "cellular"},
    "ppp":  {"type": "cellular", "label": "Cellular",     "icon": "cellular"},
}

PING_TARGET = "1.1.1.1"


async def _run(cmd: str) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(), stderr.decode()


async def _ping_ms(iface: str) -> Optional[float]:
    """Ping via a specific interface. Returns ms or None on failure."""
    rc, out, _ = await _run(
        f"ping -I {iface} -c 2 -W 1 -q {PING_TARGET} 2>/dev/null"
    )
    if rc != 0:
        return None
    # Parse "rtt min/avg/max/mdev = 23.1/24.5/25.9/1.4 ms"
    m = re.search(r"= [\d.]+/([\d.]+)/", out)
    return round(float(m.group(1)), 1) if m else None


def _classify(name: str) -> dict:
    for prefix, meta in IFACE_TYPES.items():
        if name.startswith(prefix):
            return meta
    return {"type": "unknown", "label": name, "icon": "unknown"}


async def _scan_interfaces() -> list[dict]:
    """Read all interfaces from `ip link show` and enrich with ping."""
    _, out, _ = await _run("ip link show")

    ifaces = []
    # Each interface block starts with "N: name: <...> state UP/DOWN"
    for match in re.finditer(
        r"^\d+:\s+(\S+?)(?:@\S+)?:\s+<([^>]*)>.*?state\s+(\w+)",
        out,
        re.MULTILINE,
    ):
        name, flags, state = match.group(1), match.group(2), match.group(3)
        if name in ("lo",):
            continue

        meta = _classify(name)
        is_up = state == "UP"

        # Ping only if interface is up — don't block on down interfaces
        ping = await _ping_ms(name) if is_up else None

        ifaces.append({
            "name": name,
            "type": meta["type"],
            "label": meta["label"],
            "icon": meta["icon"],
            "up": is_up,
            "ping_ms": ping,
            "hint": _hint(name, is_up, meta["type"]),
        })

    return ifaces


def _hint(name: str, up: bool, itype: str) -> Optional[str]:
    if itype == "phone" and not up:
        return "Plug in your phone via USB and enable USB tethering to add a bonded path"
    if itype == "starlink" and not up:
        return "Starlink cable not detected — check eth0 connection"
    return None


@router.get("/scan")
async def scan(user: User = Depends(get_current_user)):
    ifaces = await _scan_interfaces()
    up_count = sum(1 for i in ifaces if i["up"] and i["ping_ms"] is not None)
    return {
        "interfaces": ifaces,
        "active_paths": up_count,
        "usb_tether_present": any(i["name"].startswith("usb") for i in ifaces),
    }


class ToggleIn(BaseModel):
    interface: str
    enable: bool


@router.post("/toggle")
async def toggle(body: ToggleIn, user: User = Depends(get_current_user)):
    # Whitelist — only touch known interface prefixes, never system interfaces
    meta = _classify(body.interface)
    if meta["type"] == "unknown":
        raise HTTPException(status_code=400, detail=f"Unknown interface: {body.interface}")

    action = "up" if body.enable else "down"
    rc, _, err = await _run(f"ip link set {body.interface} {action}")
    if rc != 0:
        raise HTTPException(status_code=500, detail=err.strip() or "ip link failed")

    # Give the interface 800ms to come up before pinging
    if body.enable:
        await asyncio.sleep(0.8)

    ping = await _ping_ms(body.interface) if body.enable else None
    return {"interface": body.interface, "up": body.enable, "ping_ms": ping}
