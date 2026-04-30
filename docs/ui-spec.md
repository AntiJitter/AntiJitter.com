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
| The combined Wi-Fi + mobile-data tunnel | **Bonded connection** / **Game Mode** | "VPN", "tunnel" (in user copy) |
| The tunnel master on/off control | **Game Mode** | (don't change — brand name) |
| Send-strategy: every packet on every path | **Gaming** | "Redundant", "Duplicate" |
| Send-strategy: primary only, mobile data as failover | **Browsing** | "Failover", "Backup", "Standby" |
| Each underlying network (Wi-Fi, mobile data, Starlink) | **Path** | "interface", "link" |
| A network handing off (cell tower change, Starlink satellite swap) | **Handoff** | "switch", "drop" |
| Latency variance | **Jitter** | "ping variation" |
| Locking in low-latency state | **Lock in** | "guarantee", "ensure" |

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
│ ● Mobile data     68 ms              │
├──────────────────────────────────────┤
│ Sent                  4.6 MB         │  SessionSummaryCard
│ Received             82.1 MB         │
│ Mobile used           1.4 MB         │
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

## Windows app layout (current target)

Windows should move toward the same information hierarchy as Android while
keeping gateway controls explicit. The app is a utilitarian control surface, not
a marketing page.

Primary Windows screen:

- Header/account row.
- Game Mode hero card with active/off state and path count.
- Mode selector: **Gaming** and **Browsing**. Gaming should request
  `reply-mode:all`; Browsing should request `reply-mode:primary`.
- Active paths grid with sent, received, packet counts, and later latency/jitter.
- Session summary with sent, received, mobile data, failovers, unique RX, and
  dupes once backend/client stats exist.
- Temporary **DEV: route ALL traffic** row until route-all is a normal Windows
  mode.
- **Share to Xbox** panel for Windows gateway setup.

### Share to Xbox panel

The tested Windows sharing path is classic Internet Connection Sharing, not the
modern Windows Mobile hotspot source dropdown.

Guide the user through:

1. Start Game Mode and verify the Windows PC public IP is the Germany/Hetzner
   IP.
2. Open classic Network Connections.
3. Open the **AntiJitter** adapter properties.
4. Sharing tab -> allow other users to connect through this computer.
5. Choose the private adapter:
   - `Local Area Connection* N` for Microsoft Wi-Fi Direct / Windows hotspot.
   - Xbox Ethernet adapter for a wired Xbox test.
6. Confirm shared devices get `192.168.137.x` addresses.
7. Confirm the shared device public IP is the Hetzner IP and path counters rise.

UX caveats:

- Windows ICS usually shares to one private adapter at a time. Hotspot and Xbox
  Ethernet can fight for the same sharing slot.
- Do not tell users to choose the AntiJitter adapter in the modern Mobile
  hotspot "Share my Internet connection from" dropdown; Windows often does not
  offer it there.
- Open NAT is not guaranteed. Use "console sharing" or "improved NAT" until
  port forwarding / UPnP / allocated port ranges are implemented.
- Android hotspot sharing remains unsupported; do not copy this Windows gateway
  language to Android.

## Backend gaps that block UI completion

The Android UI now reserves slots for these but shows `—` until they exist:

1. **Probe-based RTT per path** — `BondingClient` already sends seq=0 probes during path setup. Extend to a periodic probe (every ~2s, like the web's ping logger) and store rolling RTT + jitter per path.
2. **Bonded latency** — derived from `min(rtt) + small overhead`, since bonding always delivers via the fastest-arriving path.
3. **Seamless failover counter** — increment when an active path goes inactive while another stays up. Needs a hook in the path-monitor `onLost`.
4. **Single-path baseline** — keep the slowest path's recent RTT as the "you'd be here without bonding" baseline for the delta badge.

## Changelog

Track every change here so the Android port is a translation, not a redesign.

### 2026-04-30 - Windows gateway proof and mode-aware replies
- Windows route-all proof worked: the Windows PC routed normal traffic through AntiJitter and showed the Germany/Hetzner public IP instead of Starlink.
- Classic Windows Internet Connection Sharing from the AntiJitter adapter to a Microsoft Wi-Fi Direct hotspot worked. A connected iPhone received a `192.168.137.x` address, showed the Hetzner public IP, and caused Windows AntiJitter path counters to rise during speedtest.
- Modern Windows Mobile hotspot settings may not list AntiJitter as a source adapter. The UI should guide classic adapter Sharing instead.
- Windows currently requests `reply-mode:all` and behaves like Gaming mode. Add a Windows Mode selector so Gaming maps to `reply-mode:all` and Browsing maps to `reply-mode:primary`.
- Android now sends mode-aware server controls too: Browsing requests `primary` to save mobile downlink where possible; Gaming requests `all` for redundancy.
- The Germany bonding server now uses two public IPv4s (`178.104.168.177`, `195.201.250.234`) so Windows can pin different physical adapters to different destination hosts.
- Keep Open NAT copy conservative. Current gateway sharing is double NAT; dedicated port forwarding or allocated public port ranges are future work.

### 2026-04-28 - Android path row readability
- Active path rows now put ping on the right edge as the primary value, with jitter directly below it in smaller dim text. Path names stay on the left with bytes and packet counts underneath.
- User-facing cellular copy is now **Mobile data** in Android UI and service path labels. Internal accounting can still use `cellular*` names where it reflects Android transport semantics.
- Wi-Fi rows can show a provider suffix when detected, starting with **Wi-Fi (Starlink)** when the physical Wi-Fi network can reach the Starlink dish gRPC endpoint at `192.168.100.1:9200`.
- Android now has a compact **Starlink** card below Session when the dish is detected. First cut is local reachability only: dish ping, current unreachable state, last outage length, recent reachable/unreachable events, and an opt-in alert toggle that requests Android notification permission when needed. Full obstruction/snow/SNR telemetry still needs Starlink gRPC protobuf integration and should remain a separate feature decision.
- We are not showing 4G/5G yet; Android transport type only tells us cellular/mobile data reliably without adding telephony permissions.
- Mode selector and session stats are more compact so active telemetry sits higher on phone screens. Session stats are a single row of four metrics with a small **Share Game Mode** action.
- **Share Game Mode** is a modal, not a full page yet. Keep it conservative: it can open Android hotspot and VPN settings for experiments, but current tests showed hotspot/USB tether clients bypass the app VPN. Do not frame Android sharing as supported onboarding.
- Hero card now includes a compact real path-latency sparkline for Wi-Fi and Mobile data. This uses Android `LatencyMonitor` samples only; do not port the dashboard's simulated Game Mode comparison line until we have true through-tunnel/bonded probe samples.
- Latency sparkline scales to a fixed 200 ms ceiling and applies median-of-3 smoothing for drawing only. Repeated above-cap samples, or severe single spikes, are pinned to the top edge with same-path markers so a Starlink handoff spike does not flatten the normal 30-120 ms range. Missing samples create visible gaps instead of diagonal reconnect lines. The visible legend should stay focused on path colors, not the cap mechanics.
- Android session **Mobile** now means total mobile path traffic, not only mobile upload. Path rows also show sent + received path bytes, matching what users compare against carrier data counters.
- **Failovers** now counts mobile rescues when the Wi-Fi primary appears stalled and mobile delivers tunnel traffic. It is intentionally not a raw path-switch counter, because normal packet racing would make that number noisy.

### 2026-04-27 - Android Apple-style polish pass
- Login is now a product landing/sign-in surface: dark gradient top wash, large "Lock in low latency" headline, three compact proof metrics, and a rounded sign-in panel. Account creation remains off-app for now.
- Home screen now uses one hero `HeroConnectionCard` combining Game Mode switch, status copy, and latency number. This reduces vertical fragmentation and makes the main state obvious at a glance.
- Card radius on Android moves to 24-28 dp for the app shell only, matching the requested Apple-style mobile feel. Dashboard card radius remains governed by the existing web spec unless explicitly changed later.
- Active paths keep the Speedify-style dense row model, but latency is promoted as the row's primary value and bytes/packets move to supporting text. Jitter remains on the right as a quieter secondary stat.
- Session summary moves to a 2x2 metric grid (`Sent`, `Received`, `Mobile`, `Failovers`) to reduce the old stacked table feel while keeping the same fields.
- Copy remains minimal and user-facing: "Game Mode", "Gaming", "Browsing", "Active paths", and "Seamless failovers" are unchanged.

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

### 2026-04-23 — Android: dual-icon + VPN attribution parity with Speedify
- `VpnService.setUnderlyingNetworks(...)` now called whenever a path is added or removed. This is what makes Android show **both Wi-Fi and Cellular icons** simultaneously in the status bar — the same effect Speedify produces. Without it, the system only attributes traffic to whichever transport happens to be the default route.
- `VpnService.Builder.setMetered(false)` declared on the TUN. This improves Android's metering treatment for the phone's VPN traffic. Cellular's metering still flows through via the underlying-networks call so the data-cap accounting stays correct.
- `BondingClient.activeNetworks()` exposes the current underlying `Network` array.
- Later Pixel 7 / Android 16 testing showed these two calls do **not** make Android hotspot or USB tethered clients route through the app VPN, even with **Always-on VPN + Block connections without VPN** enabled. Keep this as VPN attribution/UI parity only; do not claim Android tethering support.

### 2026-04-23 — Bonding: Gaming vs Browsing mode
Two send strategies on the same WireGuard tunnel:

- **Gaming** — every packet sent on every active path. Zero spike loss. Cellular data climbs at full duplication rate. Use for live games and voice.
- **Browsing** — non-cellular path is the primary; cellular sockets stay registered but only carry traffic when the primary is unavailable. Brief reconnect blip during a Wi-Fi drop is acceptable, cellular cap is preserved.

Implementation: `BondingClient.Mode` enum + `pickTargets()` on every outbound packet. `BondingVpnService` accepts the mode at start (`EXTRA_TUNNEL_MODE`) and via a new `ACTION_SET_MODE` intent for live changes — no reconnect needed when the user switches in the UI.

UI: a `ModeSelectorCard` (segmented Gaming / Browsing pill) below the Game Mode toggle. Active mode is teal-tinted; under the selector a one-line description tells the user what each mode actually does to their cellular usage.

Terminology table updated — "Gaming" and "Browsing" are user-facing mode names; "Game Mode" remains the brand name for the master toggle (the bonded tunnel itself).

### 2026-04-23 — Android: per-path latency from launch
- New `LatencyMonitor` (Kotlin, `bonding/`) probes Wi-Fi and Cellular every 2 s with TCP connect time to `1.1.1.1:443`. Sockets are bound to a `NET_CAPABILITY_NOT_VPN` Network so probes go through the physical interface even when our own tunnel is up. Rolling stddev over 30 samples gives jitter.
- `AppViewModel` owns the monitor lifecycle (`init` → start, `onCleared` → stop) and exposes `pathLatency` as a `StateFlow<Map<String, PathLatency>>`.
- `HomeScreen` now shows per-path latency before Game Mode is on. `ActivePathsCard` rows: `[●] Wi-Fi   23 ms   ±2 ms`. When Game Mode is on, a second line under each row carries `bytes · packets` from the bonded stats. Card label is "ACTIVE PATHS" regardless of tunnel state — they're active networks, not active bonded paths.
- `HeroLatencyCard` shows `min(rtt across measured paths)` as the live number. Title flips between "BEST PATH LATENCY" (off) and "BONDED LATENCY" (on). Subtitle copy advertises the saved-vs-slowest-path delta when Game Mode is on. Number colour follows the latency ramp (green/teal/orange/red).
- This is an approximation of bonded latency (real measurement requires through-tunnel probes; tracked under "Backend gaps" in the spec). It gives the user something live and meaningful from the moment the app opens.

### 2026-04-23 — Dashboard parity pass
Brings the web in line with the Android visual rhythm. Same card shapes, same density, same labels.

- New `ActivePathsCard` component on the dashboard: one tight panel with one-liner rows per path (`[● dot] [name] [Latency] [Loss] [Signal]`). Replaces the previous trio of full-width `ConnectionCard`s sitting side-by-side. Same component contract as Android's `ActivePathsCard`.
- Live row layout switched from `display:flex flexWrap:wrap` to a 2-column `grid` (`1fr 320px`) so the paths panel and the Game Mode panel sit at consistent widths instead of reflowing unpredictably with 3+ children.
- Added `pathsFromConns` filter — paths reporting `status: "inactive"` are hidden so we don't render a 5G card when the device is on 4G. Speedify shows everything regardless; we only show what's actually carrying traffic.
- Old `ConnectionCard.jsx` left in place but unused — keep for a future per-path detail drilldown.
