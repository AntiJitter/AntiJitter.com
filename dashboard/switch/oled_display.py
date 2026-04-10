#!/usr/bin/env python3
"""
AntíJitter SWITCH — OLED Display Service
Hardware: 128×64 SSD1306 on I2C (SDA=GPIO2, SCL=GPIO3 on Pi)

Layout:
  Row 1 (0–14):   Status icons  [⚡ GAME]  [SAT]  [◈ VPN]  [4G]
  Row 2 (16–46):  Big ping number — centre stage
  Row 3 (48–63):  ●●●●○  N paths active

Run:  python3 oled_display.py
Systemd unit: antijitter-oled.service
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
from PIL import Image, ImageDraw, ImageFont

# ── Try to import luma.oled — falls back to headless/dev mode ───────────────
try:
    from luma.core.interface.serial import i2c
    from luma.oled.device import ssd1306
    serial = i2c(port=1, address=0x3C)
    device = ssd1306(serial, width=128, height=64)
    HARDWARE = True
except Exception:
    device = None
    HARDWARE = False
    print("[OLED] No hardware detected — running in headless debug mode")

# ── Config ───────────────────────────────────────────────────────────────────
API_BASE     = "http://127.0.0.1:8000"
POLL_INTERVAL = 0.5   # seconds between display refreshes
MAX_PING_GOOD = 50    # ms — green
MAX_PING_WARN = 80    # ms — amber

WIDTH, HEIGHT = 128, 64

# ── Fonts — fall back to PIL default if custom font not installed ─────────────
def _font(size: int):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
    except Exception:
        return ImageFont.load_default()

FONT_SMALL  = _font(10)
FONT_LARGE  = _font(28)
FONT_MEDIUM = _font(13)


@dataclass
class DisplayState:
    ping_ms:      Optional[float] = None
    game_mode:    bool            = True
    vps_connected: bool           = True
    active_paths: int             = 0
    total_paths:  int             = 0
    starlink_up:  bool            = False
    cellular_up:  bool            = False
    last_update:  float           = field(default_factory=time.time)


# ── Drawing ───────────────────────────────────────────────────────────────────

def _ping_color(ms: Optional[float]) -> int:
    """Return 255 (white) always — SSD1306 is monochrome. Brightness via contrast."""
    return 255


def _draw_frame(state: DisplayState) -> Image.Image:
    img  = Image.new("1", (WIDTH, HEIGHT), 0)   # black background
    draw = ImageDraw.Draw(img)

    # ── Row 1: status icons (y = 0..13) ──────────────────────────────────────
    x = 2

    # Game Mode lightning bolt ⚡
    if state.game_mode:
        # Simple lightning: polygon
        bolt = [(x+5,0),(x+9,0),(x+4,7),(x+8,7),(x+2,14),(x+7,14),(x+3,7),(x+7,7),(x+12,0)]
        draw.polygon([(p[0],p[1]) for p in bolt], fill=255)
        draw.text((x+14, 2), "GAME", font=FONT_SMALL, fill=255)
        x += 46
    else:
        draw.text((x, 2), "GAME OFF", font=FONT_SMALL, fill=128)
        x += 56

    # Satellite dish (Starlink) — abstract arc, not their logo
    if state.starlink_up:
        draw.arc([x, 2, x+10, 12], start=200, end=340, fill=255, width=2)
        draw.line([x+5, 12, x+5, 14], fill=255, width=1)
        draw.line([x+2, 14, x+8, 14], fill=255, width=1)
        x += 14

    # ◈ VPN diamond — AntíJitter's own icon
    if state.vps_connected:
        cx, cy = x+5, 7
        draw.polygon([(cx,cy-6),(cx+5,cy),(cx,cy+6),(cx-5,cy)], outline=255)
        draw.polygon([(cx,cy-3),(cx+2,cy),(cx,cy+3),(cx-2,cy)], fill=255)
        x += 14

    # Cellular bars
    if state.cellular_up:
        for i, h in enumerate([3, 5, 7, 10]):
            bx = x + i*4
            draw.rectangle([bx, 14-h, bx+2, 14], fill=255)
        x += 18

    # ── Row 2: big ping number (y = 16..46) ──────────────────────────────────
    if state.ping_ms is not None:
        ping_str = f"{int(state.ping_ms)}"
        unit_str = "ms"

        # Centre the ping number
        bbox = draw.textbbox((0, 0), ping_str, font=FONT_LARGE)
        pw = bbox[2] - bbox[0]
        px = (WIDTH - pw) // 2 - 10   # shift left slightly for "ms"
        draw.text((px, 16), ping_str, font=FONT_LARGE, fill=255)

        # "ms" superscript
        draw.text((px + pw + 3, 24), unit_str, font=FONT_SMALL, fill=200)
    else:
        draw.text((44, 24), "---", font=FONT_MEDIUM, fill=128)

    # ── Row 3: path dots + count (y = 50..63) ────────────────────────────────
    total = max(state.total_paths, state.active_paths, 1)
    dot_w = 9
    total_w = total * dot_w
    dot_x = (WIDTH - total_w) // 2

    for i in range(total):
        active = i < state.active_paths
        cx, cy = dot_x + i * dot_w + 3, 57
        if active:
            draw.ellipse([cx-3, cy-3, cx+3, cy+3], fill=255)
        else:
            draw.ellipse([cx-3, cy-3, cx+3, cy+3], outline=180)

    path_label = f"{state.active_paths} path{'s' if state.active_paths != 1 else ''}"
    bbox = draw.textbbox((0, 0), path_label, font=FONT_SMALL)
    draw.text((WIDTH - (bbox[2]-bbox[0]) - 2, 52), path_label, font=FONT_SMALL, fill=160)

    return img


def _render(state: DisplayState):
    img = _draw_frame(state)
    if HARDWARE:
        device.display(img)
    else:
        # Debug: print ASCII art to terminal
        pixels = img.load()
        rows = []
        for y in range(0, HEIGHT, 2):
            row = ""
            for x in range(WIDTH):
                row += "█" if pixels[x, y] else " "
            rows.append(row)
        print("\033[H\033[J" + "\n".join(rows))   # clear + print


# ── API polling ───────────────────────────────────────────────────────────────

async def _fetch_state(client: httpx.AsyncClient, token: str) -> DisplayState:
    headers = {"Authorization": f"Bearer {token}"}
    state = DisplayState()

    try:
        r = await client.get(f"{API_BASE}/api/status", headers=headers, timeout=2)
        if r.is_success:
            d = r.json()
            state.ping_ms = d.get("bonded", {}).get("latency_ms")
    except Exception:
        pass

    try:
        r = await client.get(f"{API_BASE}/api/connections/scan", headers=headers, timeout=2)
        if r.is_success:
            d = r.json()
            ifaces = d.get("interfaces", [])
            state.active_paths = d.get("active_paths", 0)
            state.total_paths  = len([i for i in ifaces if i["type"] != "unknown"])
            state.starlink_up  = any(i["up"] for i in ifaces if i["type"] == "starlink")
            state.cellular_up  = any(i["up"] for i in ifaces if i["type"] in ("cellular", "phone"))
    except Exception:
        pass

    return state


async def _login(client: httpx.AsyncClient, email: str, password: str) -> Optional[str]:
    try:
        r = await client.post(
            f"{API_BASE}/api/auth/login",
            json={"email": email, "password": password},
            timeout=5,
        )
        if r.is_success:
            return r.json().get("token")
    except Exception:
        pass
    return None


async def main():
    import os
    email    = os.environ.get("AJ_EMAIL", "admin@antijitter.com")
    password = os.environ.get("AJ_PASSWORD", "")

    async with httpx.AsyncClient() as client:
        token = None

        # Show boot screen
        boot_state = DisplayState(ping_ms=None, game_mode=False, vps_connected=False)
        _render(boot_state)
        await asyncio.sleep(1)

        # Auth loop
        while not token:
            token = await _login(client, email, password)
            if not token:
                print("[OLED] Auth failed — retrying in 5s")
                await asyncio.sleep(5)

        print(f"[OLED] Authenticated. Hardware={'yes' if HARDWARE else 'no (debug)'}")

        # Main display loop
        while True:
            state = await _fetch_state(client, token)
            _render(state)
            await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
