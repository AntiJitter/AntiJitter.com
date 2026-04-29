# AntiJitter AI Project Context

Read this file before doing any work in this repository. It is the durable
handoff context for Claude, Codex, and any other AI assistant.

## Current Source Of Truth

- Use `main` as the source branch unless the user explicitly says otherwise.
- Do not use the old `claude/*` branches as active development branches. They
  were merged or retired during cleanup.
- Create a short-lived branch for each logical task, for example
  `codex/windows-route-all` or `claude/dashboard-fix`.
- Open a pull request into `main`. Do not merge your own PR unless the user asks.
- After a PR is merged, delete the feature branch locally and remotely.
- Keep commits small and imperative, for example `add Windows route-all mode`.

## Product Reality

AntiJitter is a multi-path UDP bonding VPN for unstable gaming connections,
especially Starlink plus mobile data. It sends WireGuard packets through
multiple network paths to a VPS bonding server. The server deduplicates packets
and forwards the first arrival through WireGuard, reducing handoff spikes and
packet loss.

In user-facing copy, avoid leading with "VPN". The technical implementation is
a VPN, but the product promise is **Game Mode** and **bonded connection**:
lower-jitter delivery for gaming and voice.

The long-term main product is **AntiJitter Switch**: a physical router that does
this bonding at the gateway, then shares the bonded connection over Ethernet and
Wi-Fi to consoles and PCs.

The current Android app is still valuable, but only for the phone itself.
Testing on Pixel 7 / Android 16 showed that Android Wi-Fi hotspot and USB
tethering bypass the app VPN for tethered clients even with Always-on VPN and
Block connections without VPN enabled. Do not claim that the Android or iOS app
can share a bonded hotspot to Xbox/PC. Phrase it as a phone-only bonded
connection unless future testing proves otherwise.

The near-term engineering priority is the **Windows app**, because Windows can
act as the gateway for an Xbox or PC through Internet Connection Sharing,
Ethernet, or Windows hotspot. The first Windows goal is to prove that a tethered
Xbox/PC sees the Germany/Hetzner VPS IP and avoids Starlink handoff spikes.

## Positioning And Promise Boundaries

`docs/marketing-brief.md` contains useful launch copy and positioning, but some
older details conflict with current test results. When there is a conflict,
this `CLAUDE.md` file and the latest user test results win.

Canonical one-line pitch:

> AntiJitter bonds Wi-Fi and mobile data into one low-jitter gaming connection.

Good variants:

- "Lock in low latency, even on Starlink."
- "Bond Wi-Fi + mobile data so Starlink spikes do not reach your game."
- "Starlink gaming, minus the handoff spikes."

Product story:

- **AntiJitter Android app**: shipping/prototype app for the phone's own traffic.
  It proves the bonding experience and shows real value on obstructed Starlink.
- **AntiJitter Windows app**: current engineering focus for PC/Xbox gateway
  proof. It should demonstrate that Windows can share the bonded route to a
  console through Ethernet or Windows hotspot.
- **AntiJitter Switch**: Kickstarter hardware goal and clean consumer product.
  This is the correct product for console/whole-home sharing.

Target customers, in priority order:

1. Starlink RV/cabin/rural gamers with mobile data available.
2. Console and PC gamers who need a gateway product rather than a phone-only app.
3. Streamers and voice-chat users who suffer from handoffs and jitter spikes.
4. Digital nomads and travel users on unstable hotel Wi-Fi or hotspot setups.

What to claim:

- We reduce spikes, handoff loss, and jitter by sending traffic over multiple
  paths.
- We show real path latency, jitter, data use, and seamless failovers.
- Software already proves the bonding tech; Switch makes it plug-and-play for
  consoles and home networks.

What not to claim:

- Do not say Android or iOS can share a bonded hotspot to Xbox/PC.
- Do not say "eliminates lag" or "guarantees" latency.
- Do not say console support is solved until Windows gateway testing or Switch
  hardware proves it.
- Do not quote simulated dashboard numbers as measured results.
- Do not imply mobile data is free; users still pay their carrier.
- Do not present route-all dev toggles as final production UX.

## Repo Layout

```text
index.html                  Public landing page for antijitter.com
style.css                   Landing page CSS
android/                    Android app, Kotlin + Compose + VpnService
client/                     Windows desktop app, Go + Wails + React
dashboard/
  backend/                  FastAPI backend for auth, config, billing, telemetry
  frontend/                 React dashboard at app.antijitter.com
server/                     Go bonding server for Germany VPS
deploy/                     Deployment scripts
docs/
  ui-spec.md                Single source of truth for UI/design decisions
  security-review-*.md      Read-only security reviews
  marketing-brief.md        Positioning and launch notes
```

## System Architecture

### Public Website

- `antijitter.com` is served by GitHub Pages from `main`.
- The public landing page is `index.html` plus `style.css`.

### Web App / Dashboard

- `app.antijitter.com` runs on the Finland VPS from `/opt/antijitter`.
- Backend is FastAPI in `dashboard/backend`.
- Frontend is React/Vite in `dashboard/frontend`.
- Database is SQLite in production today.
- `/api/config` returns per-user WireGuard and bonding config.

### Bonding Server

- Germany VPS host: `game-mode.antijitter.com`.
- WireGuard subnet: `10.10.0.0/24`.
- Go server lives in `server/`.
- Multi-port UDP bonding is used so mobile carriers that block one UDP port may
  still work on another.
- Do not casually modify server protocol code. The protocol is shared with
  Android and Windows and a previous protocol mismatch cost significant time.

### Shared Bonding Protocol

- Every WireGuard UDP packet is wrapped as:

```text
[4-byte big-endian sequence number][payload]
```

- `seq = 0` with payload `probe` is a reachability probe; the server echoes it.
- Server deduplicates packets by sequence number and forwards the first arrival.
- Android, Windows, and server must stay byte-for-byte compatible.

## Android Status

Android is implemented and working for the phone's own traffic.

Important files:

- `android/app/src/main/java/com/antijitter/app/vpn/BondingVpnService.kt`
- `android/app/src/main/java/com/antijitter/app/bonding/BondingClient.kt`
- `android/app/src/main/java/com/antijitter/app/bonding/LatencyMonitor.kt`
- `android/app/src/main/java/com/antijitter/app/bonding/StarlinkMonitor.kt`
- `android/app/src/main/java/com/antijitter/app/ui/HomeScreen.kt`
- `android/app/src/main/java/com/antijitter/app/ui/LoginScreen.kt`

Current Android features:

- Game Mode master VPN toggle.
- Gaming mode: every packet is sent on every active path.
- Browsing mode: Wi-Fi/non-cellular is primary; mobile data is sampled and used
  when the primary appears stalled.
- Per-path latency and jitter display.
- Smoothed capped latency sparkline with gaps for missing samples.
- Mobile data accounting uses upload + download.
- Seamless failover counter increments when mobile delivers while the primary
  appears stalled.
- Starlink detection uses `192.168.100.1:9200` on Wi-Fi and can show
  `Wi-Fi (Starlink)`.
- Starlink card shows local dish reachability, dish ping, recent events, and an
  opt-in alerts toggle.
- `setUnderlyingNetworks(...)` and `setMetered(false)` are used so Android shows
  both Wi-Fi and mobile icons and treats the VPN as layered over both paths.

Known Android limitations:

- Android hotspot and USB tethered clients bypass the app VPN in current tests.
  Do not promise bonded hotspot sharing from Android.
- Always-on VPN and Block connections without VPN can be explained for phone
  protection, but they did not make tethering route through AntiJitter in tests.
- Starlink telemetry is local reachability only. Full obstruction/snow/SNR/POP
  telemetry needs Starlink gRPC/protobuf integration.
- Latency is currently physical path latency, not a true through-tunnel bonded
  probe. It is still useful and honest enough for path quality display.

## Windows Status And Next Priority

Windows code exists in `client/` and is the current priority for Xbox testing.

Important files:

- `client/app.go` - Wails backend, login, toggle, lifecycle, stats.
- `client/main.go` - Wails entry point.
- `client/api/client.go` - fetches `/api/config`.
- `client/bonding/client.go` - Go UDP bonding client.
- `client/bonding/bind.go` - UDP socket binding helpers.
- `client/bonding/bind_windows.go` - Windows `IP_UNICAST_IF`.
- `client/iface/detect.go` - detect usable Windows adapters and probe paths.
- `client/iface/route_windows.go` - add/remove per-adapter `/32` server routes.
- `client/tunnel/wireguard.go` - wireguard-go + wintun tunnel management.
- `client/frontend/src/` - Wails React UI.

Current Windows architecture:

- Runs as Administrator because Wintun and route manipulation require it.
- Starts a local UDP bonding listener.
- Starts wireguard-go with endpoint `127.0.0.1:<bonding-port>`.
- Detects IPv4 adapters and excludes the AntiJitter TUN subnet.
- Adds `/32` host routes to bonding server IPs through each adapter gateway.
- Uses unconnected UDP sockets plus `WriteToUDP`.
- Applies `IP_UNICAST_IF`, but the host routes are the important Windows fix.

Critical Windows lesson:

- On multi-homed Windows, binding a socket to a local source IP or setting
  `IP_UNICAST_IF` alone is not enough. Windows can still choose the default
  route. The reliable approach is explicit per-adapter `/32` routes to the
  bonding server IPs, plus socket binding. Do not remove
  `client/iface/route_windows.go` without replacing it with a proven equivalent.

Known Windows gaps:

- Backend `/api/config` currently returns `allowed_ips = ["10.10.0.0/24"]`.
  For Xbox/PC proof-of-concept, the Windows client likely needs a local
  route-all override to `0.0.0.0/0`, while preserving host routes to bonding
  servers so the bonding sockets do not loop into the tunnel.
- No Gaming/Browsing mode parity yet; current Windows bonding sends every packet
  on every active path.
- Stats are much simpler than Android: no received bytes, failovers, unique RX,
  duplicate RX, per-path latency/jitter, or sparkline.
- Mobile/secondary data accounting currently treats any path not named
  `Starlink` as mobile; this is not robust on Windows adapter names.
- UI is older than Android and has encoding artifacts from earlier edits.
- No Windows Starlink card yet.
- No guided "Share to Xbox" workflow yet.

Recommended Windows next steps:

1. Add a local dev route-all option for Windows Game Mode.
2. Verify Windows PC public IP becomes the Germany/Hetzner VPS IP when Game Mode
   is active.
3. Verify AntiJitter path counters rise under Windows speedtest traffic.
4. Configure Windows Internet Connection Sharing or equivalent from the
   AntiJitter tunnel to Xbox Ethernet / Windows hotspot.
5. Verify Xbox public IP becomes the VPS IP and Starlink handoff spikes are
   hidden by mobile path delivery.
6. Port Android's stats model and UI concepts to Windows after route-all works.

## AntiJitter Switch

AntiJitter Switch is the strategic product: a physical router that bonds
Starlink/Wi-Fi/Ethernet plus mobile uplinks and shares the bonded connection to
gaming devices over Wi-Fi/Ethernet.

Keep Android and Windows work aligned with this:

- Android proves the bonding experience for phone users.
- Windows proves the gateway model for Xbox/PC.
- Switch is the clean consumer product that avoids Android/iOS tethering limits.

Do not over-promise mobile app hotspot behavior in marketing. It is better to
say:

- Android app: bonded connection for your phone.
- Windows app: gateway testing for PC/Xbox.
- AntiJitter Switch: plug-and-play bonded router for consoles and whole-home
  gaming setups.

## UI Direction

`docs/ui-spec.md` is the design source of truth. Read it before UI work.
If older wireframes or comments conflict with the current Android design, keep
the current Android design direction.

Current UI direction:

- Minimal, dark, Apple-style utility UI.
- Teal brand accent, green healthy, orange marginal, red degraded.
- Avoid marketing-heavy hero layouts inside the app.
- Use compact cards and dense readable telemetry.
- Game Mode is the master toggle.
- Gaming and Browsing are segmented modes.
- "Mobile data" is the user-facing term, not "cellular".
- Use "Seamless failovers" as the value-proposition metric.
- Heavy tabular numerals are the visual center of the UI; numbers are more
  important than explanatory text.
- Keep dashboards compact. Prefer dense readable telemetry over large marketing
  cards inside the app.

Canonical palette:

```text
black      #0a0a0a
surface    #111111
border     #1e1e1e
white      #f5f5f7
dim        #86868b
teal       #00c8d7
green      #30d158
orange     #ff9f0a
red        #ff453a
```

Latency color ramp:

- `< 50 ms`: green, excellent.
- `< 100 ms`: teal, good.
- `< 200 ms`: orange, marginal.
- `>= 200 ms`: red, unplayable.

Locked terminology:

| Concept | Use | Avoid |
| --- | --- | --- |
| Master bonded connection | Game Mode | VPN mode |
| Combined connection | Bonded connection | Tunnel in user copy |
| Every packet on every path | Gaming | Redundant / Duplicate |
| Primary path plus mobile rescue | Browsing | Standby / Backup mode |
| Underlying network | Path | Interface / link in user copy |
| Path rescue event | Seamless failover | Failover caught |
| Satellite/tower transition | Handoff | Drop / switch |
| Latency variance | Jitter | Ping variation |
| Cellular network | Mobile data | Cellular / LTE in UI copy |

Android HomeScreen is currently the best visual reference for app UI.
Windows should be modernized toward the same information hierarchy:

- Header/status.
- Game Mode hero latency card.
- Mode selector.
- Active paths with ping right-aligned and jitter below.
- Session stats.
- Starlink status.
- Share/gateway guidance for Xbox.

## Security And Scope Guardrails

Security review exists in `docs/security-review-codex-2026-04-27.md`.

General guardrails:

- Do not commit `.env`, private keys, WireGuard keys, VPS credentials, or
  generated secrets.
- Do not modify files under `/etc/`.
- Do not change server bonding protocol unless the task explicitly requires it.
- Do not modify backend, server, deployment, or infrastructure code during UI
  work unless the user explicitly changes scope.
- If a UI feature appears to need backend changes, explain that in the PR
  description before touching backend code.
- Keep Android bonding/protocol/VPN/WireGuard edits separate from UI-only PRs.
- Keep Windows route/bonding changes separate from UI-only PRs.

## Build And Test Notes

Android:

- GitHub Actions builds the APK on push/merge to `main` via
  `.github/workflows/android.yml`.
- The debug APK is published to the `android-latest` GitHub Release.
- Local Windows environment may not have Java installed, so GitHub Actions is
  the reliable Android build path.

Windows:

- Requires Go, Node, Wails CLI, and Administrator privileges for real tunnel
  testing.
- Build instructions are in `client/Makefile`.
- Wails dev mode can test UI, but real Wintun/WireGuard/bonding behavior must be
  tested in the packaged/admin Windows app.
- Logs are written to `%APPDATA%\AntiJitter\antijitter.log`.

Dashboard:

- Finland VPS deploy is manual today: pull repo, build frontend, restart API.
- Do not assume dashboard simulated stats are real. Some older dashboard graph
  work started with simulated values.

## Current Test Setup Notes

User test environment:

- Starlink is intentionally partially obstructed, producing many real outages
  and handoff spikes. This is useful for validating AntiJitter.
- Android phone has Starlink Wi-Fi plus mobile data.
- Android app successfully hides Starlink handoffs for phone traffic.
- Android hotspot and USB tethering did not route PC/Xbox through the VPN.
- Windows PC and Xbox testing should focus on proving the gateway model.

Expected route-all success signal:

- Phone-only Android speedtest should show the Germany/Hetzner VPS IP when
  route-all is enabled.
- Windows route-all speedtest should show the Germany/Hetzner VPS IP.
- A device shared through Windows should also show the VPS IP if gateway sharing
  is working.
- If it shows the Starlink public IP, traffic is bypassing AntiJitter.

## Assistant Operating Rules

- Start by reading `CLAUDE.md` and `docs/ui-spec.md`.
- Check `git status -sb` before edits.
- Work from `main`, create a task branch, and open a PR.
- Prefer small, single-purpose PRs.
- Do not force-push shared/user branches.
- Do not merge your own PR unless the user explicitly asks.
- If you find a bug outside scope, document it in the PR or notes instead of
  opportunistically fixing unrelated code.
