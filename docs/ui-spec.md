# AntiJitter UI Spec

Single source of truth for UI on **app.antijitter.com/dashboard** (React) and the **Android app** (Compose). Both surfaces should look like one product. Web ships first because it has the foundation; Android catches up to this spec.

## Palette

```
--black:     #0a0a0a   page background
--surface:   #111      cards, header
--border:    #1e1e1e   card outlines, dividers
--white:     #f5f5f7   primary text
--dim:       #86868b   secondary text, labels
--teal:      #00c8d7   AntiJitter brand, "good" Game Mode
--teal-dim:  rgba(0,200,215,0.06)  active Game Mode card bg
--green:     #30d158   healthy / connected
--orange:    #ff9f0a   warning / 4G / Starlink line
--red:       #ff453a   degraded / unplayable threshold / lost
```

Latency colour ramp (used for the hero `97.9 ms` number and any latency text):

| Range | Colour | Meaning |
|---|---|---|
| `< 50 ms`  | green   | Excellent |
| `< 100 ms` | teal    | Good (gaming-grade) |
| `< 200 ms` | orange  | Marginal |
| `≥ 200 ms` | red     | Unplayable |

## Type

| Use | Size | Weight |
|---|---|---|
| Hero number (current ping) | 36–40 | 800 |
| Card titles | 14 | 600–700 |
| Body / metric values | 12–13 | 600 |
| Labels (uppercased) | 10–11 | 600, letterSpacing 0.05em |
| Captions / disclaimers | 11 | 400, dim |

`fontVariantNumeric: tabular-nums` on every number so they don't jitter as digits change.

## Status text

Avoid the word "Live" in two places at once. Use:

- Header status pill: **"Connected"** when websocket up, **"Reconnecting…"** when down. The green/red dot stays. Do NOT say "Live" because the active tab is also called "Live".
- Tab name: keep "Live".

## Cards

### MetricCard / ConnectionCard
- Background `--surface`, 1px `--border`, radius 12, padding `20px 24px`.
- Header row: `[icon] [name] ........... [statusDot]`
- Three metric rows: label left (dim), value right (white, tabular).
- Degraded state: red border + red latency text.

### Hero chart card (StarlinkPingChart)
- Title row: `Starlink Latency` left, time-window pills + big current-ms right.
- Stats strip: `Median/Avg | Jitter | Handoffs | Samples`.
- Legend: `Starlink (orange filled)` + `With Game Mode (teal dashed)`.
- Threshold line: dashed red at 200 ms labelled "Unplayable".
- Handoff markers: vertical red dashed lines.
- **Sample-confidence guard**: when `samples < 8`, jitter must show `—` not a computed number. Add note `"Collecting samples…"` under the strip.
- **Honest legend**: when `gameMode == starlink` for the whole window (no spikes seen), add a one-line note: *"Lines overlap when no spikes — Game Mode diverges during latency peaks."*

### Game Mode panel (BondingPanel)
- When ON: teal-tinted background, glow on dot, big teal stat block (Latency / Packet loss / Throughput) + small stats (Uptime / Packets routed / Failovers).
- When OFF: grey, single explanation paragraph.
- When locked (no subscription): blurred preview + "$5/mo" pill + "Unlock" CTA.
- **Delta badge**: when both `bonded.latency_ms` and the chart's Starlink baseline exist, show a small pill under the latency: `−Δ ms vs Starlink alone`. Teal text on translucent teal background.

## Components Android needs (Compose translations)

| React component | Android equivalent | Status |
|---|---|---|
| `ConnectionCard` | `PathHealthCard` | not yet built |
| `BondingPanel` | the existing top "Game Mode" Card on `HomeScreen` | partial |
| `StarlinkPingChart` | TBD (Compose Canvas line chart) | not yet built |
| Header tabs + status pill | top app bar | not yet built |

Android currently shows Sent/Received/Cellular bytes only — that's VPN-style metrics. Replace with: **Latency, Jitter, Packet loss, Packets saved, per-path health, current game**. Same hierarchy as web.

## Changelog

Track every change here so the Android port is a translation, not a redesign.

### 2026-04-23 — initial spec + dashboard fixes
- Status pill renamed `Live` → `Connected` (no longer collides with tab).
- Jitter shows `—` with "Collecting samples…" note when `samples < 8`.
- Added "lines overlap when no spikes" explainer to chart legend.
- Added `−Δ ms vs Starlink alone` delta pill on BondingPanel when both stats exist.
- Subtitle under `Starlink Latency` moved below the controls row on narrow viewports (no longer stacked next to title on mobile).
