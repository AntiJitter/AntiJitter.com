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

## Terminology

Use these phrases consistently across web, Android, marketing, and notifications. Stick to the Speedify-style wording — the user already knows it, and inventing new terms makes the value harder to grasp.

| Concept | Use this | Don't use |
|---|---|---|
| One UDP packet duplicated across paths and the dupe dropped on arrival | (don't expose to user) | "packets saved", "redundant packets" |
| A moment when one path dropped and the tunnel kept going on the other(s) | **Seamless failover** | "failover caught", "outage avoided", "connection rescued" |
| The combined Wi-Fi + cellular tunnel | **Bonded connection** / **Game Mode** | "VPN", "tunnel" (in user copy) |
| Each underlying network (Wi-Fi, cellular, Starlink) | **Path** | "interface", "link" |
| A network handing off (cell tower change, Starlink satellite swap) | **Handoff** | "switch", "drop" |
| Latency variance | **Jitter** | "ping variation" |

## Speedify references (what to steal vs skip)

We've benchmarked against Speedify's mobile UI. Adopt the mental model where it's better than ours, ignore the parts that come from being a generic VPN tool.

**Adopt:**
- Top-bar Game Mode toggle as a Switch in a tinted card, not a giant green button. Saves vertical space and matches how users mentally model "VPN apps".
- One-liner per path: `[●] Wi-Fi    3.2 MB    412 pkts`. Dense, glanceable.
- Speedify's terminology where it overlaps (Bonding mode, Failover, etc.) — see Terminology table.

**Skip (we are not a generic VPN):**
- Bypass / App Bypass / Firewall / IP Leak Protection / Internet Kill Switch / DNS Service / Encryption toggle. Settings should fit on one screen: Connect at startup, Notifications, Cellular cap, Account.
- News & Events feed.
- Pair & Share (interesting v2+ concept, not now).
- Blanket "Performance Tests" page — surface `/jitter-test` link instead.

**Improve on:**
- Per-path live latency + jitter + packet loss (Speedify only shows signal bars). Real gaming metrics.
- Active game indicator (Speedify can't show this — not gaming-focused).
- Seamless failovers count as a hero metric, not buried in stats.

## Android `HomeScreen` layout (current target)

Implemented in `android/app/src/main/java/com/antijitter/app/ui/HomeScreen.kt`. Mirror this on the dashboard's mobile breakpoint.

```
┌──────────────────────────────────────┐
│ AntíJitter             Sign out      │  Header
├──────────────────────────────────────┤
│ Game Mode             ─•─ Switch     │  GameModeToggleBar
│ Bonded paths active                  │   (tinted teal when ON)
├──────────────────────────────────────┤
│           — ms                       │  HeroLatencyCard
│     Measuring vs single-path…        │   (placeholder until probe RTTs)
├──────────────────────────────────────┤
│ ACTIVE PATHS                         │  ActivePathsCard
│ ● Wi-Fi      3.2 MB    412 pkts      │   one-liner per path
│ ● Cellular   1.4 MB    198 pkts      │
├──────────────────────────────────────┤
│ Sent                  4.6 MB         │  SessionSummaryCard
│ Received             82.1 MB         │
│ Cellular used         1.4 MB         │
│ Seamless failovers        —          │
├──────────────────────────────────────┤
│ DEV: route ALL traffic    [switch]   │  DevRouteAllRow (anchored, removable)
└──────────────────────────────────────┘
```

## Components Android needs (Compose translations)

| React component | Android equivalent | Status |
|---|---|---|
| `ConnectionCard` (×3) | `ActivePathsCard` (one-liner rows) | shipped |
| `BondingPanel` toggle | `GameModeToggleBar` | shipped |
| `BondingPanel` big stats | `HeroLatencyCard` + `SessionSummaryCard` | shipped (latency placeholder) |
| `StarlinkPingChart` | TBD (Compose Canvas line chart) | not yet built |
| Header tabs + status pill | n/a (Android is one screen for now) | — |

## Backend gaps that block UI completion

The Android UI now reserves slots for these but shows `—` until they exist:

1. **Probe-based RTT per path** — `BondingClient` already sends seq=0 probes during path setup. Extend to a periodic probe (every ~2s, like the web's ping logger) and store rolling RTT + jitter per path.
2. **Bonded latency** — derived from `min(rtt) + small overhead`, since bonding always delivers via the fastest-arriving path.
3. **Seamless failover counter** — increment when an active path goes inactive while another stays up. Needs a hook in the path-monitor `onLost`.
4. **Single-path baseline** — keep the slowest path's recent RTT as the "you'd be here without bonding" baseline for the delta badge.

## Changelog

Track every change here so the Android port is a translation, not a redesign.

### 2026-04-23 — initial spec + dashboard fixes
- Status pill renamed `Live` → `Connected` (no longer collides with tab).
- Jitter shows `—` with "Collecting samples…" note when `samples < 8`.
- Added "lines overlap when no spikes" explainer to chart legend.
- Added `−Δ ms vs Starlink alone` delta pill on BondingPanel when both stats exist.
- Subtitle under `Starlink Latency` moved below the controls row on narrow viewports (no longer stacked next to title on mobile).
- BondingPanel small stat `Failovers caught` → `Seamless failovers` (Speedify-style framing). Added Terminology table to lock this and other phrasing across surfaces.
- `StarlinkPingChart` simulation rewritten: Game Mode line now `min(starlink, baseline*1.10)` continuously, not only during 4× spikes. Baseline can be computed from as few as 3 trailing samples, with a global-floor fallback so the line diverges from the first sample. The previous behaviour overlapped completely until enough history accumulated, which looked broken even when the chart showed an obvious spike.

### 2026-04-23 — Android HomeScreen Speedify-inspired redesign
- Replaced the giant "Turn on Game Mode" button with a top-bar Switch in a tinted card (`GameModeToggleBar`). Tints teal when ON, dim when OFF.
- New `HeroLatencyCard` reserves a 48 sp bonded-latency slot (currently `—` — needs probe-based RTT measurement in `BondingClient`).
- Per-path stats compressed into one-liner rows (`ActivePathsCard`): `[● dot] [name] [bytes sent] [packets]`. Dropped the previous three-row card per path.
- New `SessionSummaryCard` carries Sent / Received / Cellular used / Seamless failovers in a label-value layout matching the dashboard's small-stat strip.
- Removed the "How it works" `HelpCard` from the main screen — to be moved to a future Settings → About link.
- DEV route-all toggle stays at the bottom, anchored with the same `BEGIN/END DEV-TOGGLE` comment markers for easy removal.

### 2026-04-23 — Dashboard parity pass
Brings the web in line with the Android visual rhythm. Same card shapes, same density, same labels.

- New `ActivePathsCard` component on the dashboard: one tight panel with one-liner rows per path (`[● dot] [name] [Latency] [Loss] [Signal]`). Replaces the previous trio of full-width `ConnectionCard`s sitting side-by-side. Same component contract as Android's `ActivePathsCard`.
- Live row layout switched from `display:flex flexWrap:wrap` to a 2-column `grid` (`1fr 320px`) so the paths panel and the Game Mode panel sit at consistent widths instead of reflowing unpredictably with 3+ children.
- Added `pathsFromConns` filter — paths reporting `status: "inactive"` are hidden so we don't render a 5G card when the device is on 4G. Speedify shows everything regardless; we only show what's actually carrying traffic.
- Old `ConnectionCard.jsx` left in place but unused — keep for a future per-path detail drilldown.
