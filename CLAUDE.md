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

2026-04-30 Windows gateway proof:

- Windows route-all now works as a proof path. The Windows PC showed the
  Germany/Hetzner public IP instead of Starlink when Game Mode was active.
- Classic Windows Internet Connection Sharing from the AntiJitter adapter to
  the Microsoft Wi-Fi Direct adapter also worked: an iPhone joined the Windows
  hotspot, received a `192.168.137.x` address, saw the Hetzner IP, and caused
  AntiJitter Windows path counters to rise during speedtest traffic.
- Classic Windows Internet Connection Sharing from the AntiJitter adapter to
  Ethernet also worked with Xbox: the Xbox immediately started a large Call of
  Duty update through AntiJitter, proving gateway traffic was flowing. Xbox NAT
  showed **Moderate**, which is usable for testing but not an Open NAT claim.
- This proves the Windows gateway direction for shared clients. Open NAT,
  polished setup, and traffic-class protection are still not final product
  claims.
- Modern Windows "Mobile hotspot" settings may not offer the AntiJitter adapter
  as the source. The reliable manual test path is the classic adapter
  Properties -> Sharing tab on the AntiJitter adapter.
- Large console downloads make full Gaming redundancy expensive on mobile data.
  Windows needs a **Normal** mode for everyday traffic and a future game-only
  protection feature so updates/downloads do not duplicate over mobile unless
  explicitly requested.

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
- Current Germany bonding IPs: `178.104.168.177` plus floating IPv4
  `195.201.250.234`.
- WireGuard subnet: `10.10.0.0/24`.
- Go server lives in `server/`.
- Multi-port UDP bonding is used so mobile carriers that block one UDP port may
  still work on another.
- For Windows multi-homing, the bonding server should listen on explicit public
  hosts with `--bond-hosts=178.104.168.177,195.201.250.234` and
  `--bond-ports=4567,443`.
- Server default reply mode should stay `primary`. Clients can request
  `primary` or `all` per client/session. User-facing **Normal** mode should use
  `primary`; Gaming and the current Windows route-all proof use `all`.
- The server must isolate clients by WireGuard message indexes. Do not
  reintroduce a global `key := "default"` client bucket or broadcast replies
  across clients.
- Do not casually modify server protocol code. The protocol is shared with
  Android and Windows and a previous protocol mismatch cost significant time.

### Shared Bonding Protocol

- Every WireGuard UDP packet is wrapped as:

```text
[4-byte big-endian sequence number][payload]
```

- `seq = 0` with payload `probe` is a reachability probe; the server echoes it.
- `seq = 0` can also carry backward-compatible control payloads. Current
  control payloads are `reply-mode:primary` and `reply-mode:all`.
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
- Normal mode: Wi-Fi/non-cellular is primary; mobile data is sampled and used
  when the primary appears stalled.
- Mode-aware server replies: Normal requests `reply-mode:primary` to reduce
  mobile downlink usage; Gaming requests `reply-mode:all` for full redundancy.
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
- Normal mode can still use mobile data during real Starlink stalls, high
  latency, or speedtests. Recent tests showed low server-side redundancy in
  Normal/Browsing and full redundancy in Gaming after PR #66.
- Android Normal/Browsing may still share the same trap Windows had before
  PR #70: routine real-payload sampling on mobile can make the server's
  `reply-mode:primary` choose mobile as the latest inbound path. If Android
  Normal shows unexpectedly high mobile usage, investigate removing routine
  mobile real-payload samples and keeping mobile warm with probes plus
  stall-triggered payload only, or add explicit server-side primary path
  selection.

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
- Uses Windows route pinning plus socket binding. `IP_UNICAST_IF` helps, but
  route pinning is the important fix.
- Current dev route-all path overrides WireGuard `AllowedIPs` to `0.0.0.0/0`
  locally and installs split-default routes through Wintun.
- The API still returns `allowed_ips = ["10.10.0.0/24"]`; the route-all behavior
  is a Windows client-side dev/test override, not a backend contract.
- With two public bonding IPs, Windows pins distinct adapters to distinct
  server hosts, for example Starlink Ethernet -> `178.104.168.177` and mobile
  Wi-Fi -> `195.201.250.234`.
- Wintun is packaged/installed by the app; users should not manually download
  `wintun.dll`.
- Windows now has user-facing **Normal** and **Gaming** modes. Gaming requests
  `reply-mode:all` and sends every packet on every active path. Normal requests
  `reply-mode:primary`, keeps mobile paths warm with probes, and only sends
  real mobile payload when the primary path appears stalled. This preserves
  Starlink throughput and avoids using mobile data for routine downloads.
- Current Windows Normal speedtest proof: Starlink Ethernet + Android mobile
  hotspot both active, Normal mode showed about 286 Mbps down through the
  Hetzner IP while mobile downlink stayed tiny compared with Starlink. This is
  expected and desirable.
- Windows Gaming speedtest proof: full two-path redundancy can exceed Normal
  throughput when both downlink paths are used, but it consumes mobile data.

Critical Windows lesson:

- On multi-homed Windows, binding a socket to a local source IP or setting
  `IP_UNICAST_IF` alone is not enough. Windows can still choose the default
  route. The reliable approach is explicit per-adapter `/32` routes to the
  bonding server IPs, plus socket binding. Do not remove
  `client/iface/route_windows.go` without replacing it with a proven equivalent.

Known Windows gaps:

- Normal/Gaming mode parity exists, but failover tuning still needs more real
  outage tests. Normal should show low mobile data while Starlink is healthy,
  then mobile should rise when Starlink stalls.
- Stats are still simpler than Android: no failovers, unique RX, duplicate RX,
  or true through-tunnel bonded probes yet.
- Mobile/secondary data accounting currently treats any path not named
  `Starlink` as mobile; this is not robust on Windows adapter names.
- UI has moved toward the Android HomeScreen direction, but more compact polish
  is still planned.
- No Windows Starlink card yet.
- No guided "Share to Xbox" workflow yet. Classic ICS works manually, but the
  app does not configure or validate it.
- Xbox/Open NAT is not solved. Current gateway path is double NAT:
  Xbox/device -> Windows ICS -> AntiJitter tunnel -> VPS NAT -> Internet.
  Open NAT likely needs later port-forwarding or allocated public port ranges.
- UI should emphasize downlink bytes and packets for users. Uplink send counts
  are useful diagnostics, but can mislead because they are attempted sends.

Recommended Windows next steps:

1. Add a guided "Share to Xbox" panel for classic ICS:
   AntiJitter adapter -> Sharing -> Microsoft Wi-Fi Direct adapter or Xbox
   Ethernet adapter.
2. Keep testing Normal mode during real Starlink handoffs. Expected signal:
   mobile downlink stays low during healthy Starlink, then rises during primary
   stalls without dropping the tunnel.
3. Verify Xbox public IP becomes the VPS IP and Starlink handoff spikes are
   hidden by mobile path delivery.
4. Add per-path latency/jitter monitor to Windows.
5. Add better stats: mobile data, failovers, unique RX, dupes, and downlink
   packet counts. Keep user-facing path stats focused on downlink.
6. Modernize Windows UI toward Android HomeScreen design.
7. Add console NAT groundwork later: API-allocated public port ranges, server
   forwarding to the user's WireGuard IP, and Windows forwarding to Xbox.
8. Add game-only protection later: detect game traffic and keep large console
   updates/downloads in Normal mode unless the user explicitly enables full
   redundancy for all traffic.
9. Add per-device WireGuard credentials. One user/subscription currently maps to
   one WireGuard key and peer IP, so running Android and Windows simultaneously
   on the same account can disrupt an active tunnel.

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
- Gaming and Normal are segmented modes. Older code/docs may still say
  Browsing; use Normal for user-facing copy going forward.
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
| Primary path plus mobile rescue | Normal | Browsing / Standby / Backup mode |
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

- Phone-only Android speedtest should show the Germany/Hetzner VPS IP when Game
  Mode is enabled.
- Windows route-all speedtest should show the Germany/Hetzner VPS IP.
- A device shared through Windows should also show the VPS IP if gateway sharing
  is working.
- If it shows the Starlink public IP, traffic is bypassing AntiJitter.

2026-04-30 measured signals:

- Android Normal/Browsing mode produced `Client reply mode set: primary` logs for both
  Starlink and mobile paths, with low server redundancy during normal traffic.
- Android Gaming mode produced `Client reply mode set: all` and roughly 50%
  redundancy during sustained two-path traffic.
- Windows route-all proof produced `Client reply mode set: all` and two
  registered paths from different public IPs.
- Windows shared-hotspot client received `192.168.137.x`, saw the Hetzner public
  IP, and increased Windows AntiJitter path counters during speedtest.
- Xbox connected via Windows Ethernet ICS, showed Moderate NAT, and immediately
  downloaded a large game update through the AntiJitter gateway. This proved
  traffic flow but also exposed the need to avoid full Gaming redundancy for
  large console downloads.
- A later 3+ hour Call of Duty session on Xbox through Windows Ethernet ICS had
  zero disconnects. In-game ping was roughly 40-70 ms, mostly around 60 ms, and
  Starlink-only play was previously unstable enough to rubber-band and drop back
  to lobby. This is the strongest current proof that Windows gateway bonding is
  useful for real console gaming.
- During that session Windows reported about 671 MB of mobile/4G usage over
  several hours, which is acceptable for testing but still motivates Normal mode
  and future game-only protection.
- Starting the Android phone app with the same AntiJitter account while Xbox was
  in-game caused one lobby disconnect. The likely cause is shared WireGuard
  identity: `/api/config` currently returns one private key and one
  `10.10.0.x` address per subscription/user. Do not assume one account can run
  multiple simultaneous clients until per-device WireGuard peers are implemented.

2026-05-01 Windows mode/UI findings:

- PR #70 moved Windows from route-all proof toward a usable gateway beta:
  packaged Wintun/WebView startup hardening, taller fixed window, Android-style
  compact dark UI, capped latency chart, Normal/Gaming mode selector, and
  downlink-focused path stats.
- Windows Normal mode now maps to `reply-mode:primary` and primary-path send
  behavior. Mobile paths stay reachable via probes and only carry real payload
  when the primary path appears stalled. Do not reintroduce routine mobile
  payload sampling in Normal mode without also fixing server primary-path
  selection, because sampling can make the server reply down the slower mobile
  path and cap speedtests.
- Windows Gaming mode maps to `reply-mode:all` and sends every packet over all
  active paths. It is the right mode for active games and voice, but it can burn
  mobile data during downloads.
- Normal mode with Starlink Ethernet plus Android mobile hotspot produced about
  286 Mbps down while the mobile card showed only a few MB/packets. Treat small
  mobile downlink counts in Normal mode as proof the path is warm, not a bug.
- The Windows latency chart should stay capped around 200-250 ms with a red
  unplayable threshold line, so 1000-2000 ms Starlink spikes do not flatten the
  normal 40-120 ms range.

## Assistant Operating Rules

- Start by reading `CLAUDE.md` and `docs/ui-spec.md`.
- Check `git status -sb` before edits.
- Work from `main`, create a task branch, and open a PR.
- Prefer small, single-purpose PRs.
- Do not force-push shared/user branches.
- Do not merge your own PR unless the user explicitly asks.
- If you find a bug outside scope, document it in the PR or notes instead of
  opportunistically fixing unrelated code.
