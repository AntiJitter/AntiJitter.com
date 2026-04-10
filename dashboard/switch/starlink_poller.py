#!/usr/bin/env python3
"""
AntíJitter SWITCH — Starlink gRPC Telemetry Poller
Polls the dish at 192.168.100.1:9200 every second and pushes real metrics
to the AntíJitter backend REST API.

Requires: grpcio, grpcio-tools, starlink-grpc-tools (see requirements.txt)
Run:      python3 starlink_poller.py
Systemd:  antijitter-starlink.service
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx

# ── Try to import starlink gRPC client ───────────────────────────────────────
try:
    import starlink_grpc
    GRPC_AVAILABLE = True
except ImportError:
    GRPC_AVAILABLE = False
    print("[Starlink] starlink-grpc-tools not installed — running in simulation mode")

# ── Config ────────────────────────────────────────────────────────────────────
DISH_IP        = "192.168.100.1"
DISH_PORT      = 9200
POLL_INTERVAL  = 1.0     # seconds
API_BASE       = "http://127.0.0.1:8000"
PUSH_INTERVAL  = 5       # push to API every N polls

# ── Dataclass for one telemetry snapshot ─────────────────────────────────────

@dataclass
class DishSnapshot:
    ts:                float = field(default_factory=time.time)
    downlink_ms:       Optional[float] = None   # dish → pop latency
    uplink_ms:         Optional[float] = None
    snr:               Optional[float] = None   # dB
    signal_quality:    Optional[float] = None   # 0-1
    obstruction_pct:   Optional[float] = None   # 0-100
    currently_obstructed: bool = False
    outage_cause:      Optional[str]  = None    # "NO_SATS", "OBSTRUCTED", etc.
    seconds_to_first_nonempty_slot: Optional[float] = None
    pop_ping_latency_ms: Optional[float] = None
    pop_ping_drop_rate:  Optional[float] = None  # 0-1
    downlink_throughput_bps: Optional[float] = None
    uplink_throughput_bps:   Optional[float] = None


# ── gRPC polling ──────────────────────────────────────────────────────────────

def _poll_dish_grpc() -> DishSnapshot:
    """Blocking gRPC call — run in executor to keep async loop free."""
    snap = DishSnapshot()
    try:
        context = starlink_grpc.ChannelContext(target=f"{DISH_IP}:{DISH_PORT}")

        # Status
        status = starlink_grpc.status_data(context)
        dish   = status.get("dish_status", {})
        alerts = dish.get("alerts", {})

        snap.currently_obstructed = dish.get("currently_obstructed", False)
        snap.seconds_to_first_nonempty_slot = dish.get("seconds_to_first_nonempty_slot")
        snap.snr              = dish.get("snr")
        snap.signal_quality   = dish.get("signal_quality")
        snap.obstruction_pct  = dish.get("fraction_obstructed", 0.0) * 100

        # Pop ping stats from status
        snap.pop_ping_latency_ms = dish.get("pop_ping_latency_ms")
        snap.pop_ping_drop_rate  = dish.get("pop_ping_drop_rate")

        # Outage cause (if in outage)
        outage = dish.get("outage", {})
        if outage:
            snap.outage_cause = outage.get("cause")

        # History bulk stats for throughput + loss
        history = starlink_grpc.history_bulk_data(context)
        current = history.get("history", {})
        snap.downlink_throughput_bps = current.get("throughput_download")
        snap.uplink_throughput_bps   = current.get("throughput_upload")

        context.close()
    except Exception as exc:
        print(f"[Starlink] gRPC error: {exc}")

    return snap


def _simulate_dish() -> DishSnapshot:
    """Simulated dish data for development without hardware."""
    import math, random
    t = time.time() % 60
    # Simulate a brief obstruction every ~45s
    obstructed = 42 < t < 45
    latency = 25 + 5 * math.sin(t * 0.3) + random.gauss(0, 2)
    if obstructed:
        latency = 300 + random.gauss(0, 30)

    return DishSnapshot(
        pop_ping_latency_ms=round(max(1.0, latency), 1),
        pop_ping_drop_rate=round(random.uniform(0.08, 0.25) if obstructed else random.uniform(0, 0.02), 3),
        snr=round(random.uniform(8, 12), 1),
        signal_quality=round(random.uniform(0.85, 0.99), 2),
        obstruction_pct=round(random.uniform(60, 90) if obstructed else random.uniform(0, 3), 1),
        currently_obstructed=obstructed,
        outage_cause="OBSTRUCTED" if obstructed else None,
        downlink_throughput_bps=round(random.uniform(50e6, 200e6), 0),
        uplink_throughput_bps=round(random.uniform(5e6, 30e6), 0),
    )


async def _poll_once(loop) -> DishSnapshot:
    if GRPC_AVAILABLE:
        return await loop.run_in_executor(None, _poll_dish_grpc)
    return _simulate_dish()


# ── HTTP push to backend ──────────────────────────────────────────────────────

async def _push(client: httpx.AsyncClient, token: str, snaps: list[DishSnapshot]):
    """POST aggregated telemetry to the backend."""
    if not snaps:
        return

    valid_pings = [s.pop_ping_latency_ms for s in snaps if s.pop_ping_latency_ms is not None]
    valid_drops = [s.pop_ping_drop_rate   for s in snaps if s.pop_ping_drop_rate   is not None]
    obstructed  = any(s.currently_obstructed for s in snaps)
    causes      = list({s.outage_cause for s in snaps if s.outage_cause})

    payload = {
        "avg_latency_ms":   round(sum(valid_pings) / len(valid_pings), 1) if valid_pings else None,
        "max_latency_ms":   round(max(valid_pings), 1)                    if valid_pings else None,
        "avg_drop_rate":    round(sum(valid_drops) / len(valid_drops), 4) if valid_drops else None,
        "obstructed":       obstructed,
        "outage_causes":    causes,
        "snr":              snaps[-1].snr,
        "signal_quality":   snaps[-1].signal_quality,
        "obstruction_pct":  snaps[-1].obstruction_pct,
        "downlink_mbps":    round(snaps[-1].downlink_throughput_bps / 1e6, 1)
                            if snaps[-1].downlink_throughput_bps else None,
        "uplink_mbps":      round(snaps[-1].uplink_throughput_bps  / 1e6, 1)
                            if snaps[-1].uplink_throughput_bps  else None,
        "sample_count":     len(snaps),
        "window_seconds":   PUSH_INTERVAL * POLL_INTERVAL,
    }

    try:
        r = await client.post(
            f"{API_BASE}/api/starlink/telemetry",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=3,
        )
        if not r.is_success:
            print(f"[Starlink] Push failed {r.status_code}: {r.text[:80]}")
    except Exception as exc:
        print(f"[Starlink] Push error: {exc}")


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


# ── Main loop ─────────────────────────────────────────────────────────────────

async def main():
    import os
    email    = os.environ.get("AJ_EMAIL",    "admin@antijitter.com")
    password = os.environ.get("AJ_PASSWORD", "")

    loop = asyncio.get_event_loop()

    async with httpx.AsyncClient() as client:
        # Auth
        token = None
        while not token:
            token = await _login(client, email, password)
            if not token:
                print("[Starlink] Auth failed — retrying in 5s")
                await asyncio.sleep(5)

        mode = "gRPC" if GRPC_AVAILABLE else "simulation"
        print(f"[Starlink] Authenticated. Mode={mode}. Polling every {POLL_INTERVAL}s")

        buffer: list[DishSnapshot] = []
        n = 0

        while True:
            snap = await _poll_once(loop)
            buffer.append(snap)
            n += 1

            # Console summary
            lat  = f"{snap.pop_ping_latency_ms:.1f}ms" if snap.pop_ping_latency_ms else "—"
            obs  = " [OBSTRUCTED]" if snap.currently_obstructed else ""
            print(f"[Starlink] ping={lat}  snr={snap.snr}  obstruction={snap.obstruction_pct:.1f}%{obs}")

            if n % PUSH_INTERVAL == 0:
                await _push(client, token, buffer)
                buffer.clear()

            await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
