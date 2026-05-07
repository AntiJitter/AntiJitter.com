# GameLane 4G Mode

GameLane 4G is a planned Windows gateway mode for competitive console play. It
is different from the current AntiJitter redundant/VPS mode.

## What It Does

GameLane 4G keeps Starlink as the default internet path and steers only likely
latency-sensitive Xbox gameplay UDP flows directly over mobile data.

```text
Xbox gameplay UDP    -> direct 4G/mobile path
Xbox downloads/TCP   -> Starlink
Xbox UDP/443/QUIC    -> Starlink
Windows PC traffic   -> Starlink by default
```

The goal is lower baseline input delay than sending gameplay through an
AntiJitter VPS/POP while still keeping bulk traffic off the mobile plan.

## How It Differs From Redundant Mode

Redundant mode sends traffic through an AntiJitter POP and can duplicate packets
across Starlink and mobile data. That is useful for hiding Starlink dropouts,
but it adds relay latency and can burn mobile data.

GameLane 4G does not use the VPS for selected game flows. It optimizes for a
lower-latency direct path. It does not provide seamless redundancy.

## Why Not All UDP

Modern high-bandwidth traffic often uses UDP:

- UDP/443 QUIC and HTTP/3
- video streaming
- Discord/WebRTC
- speed tests
- launcher/backend services
- telemetry
- CDN downloads

Routing all UDP to mobile data would burn the mobile plan and can create
bufferbloat. GameLane uses a scoring classifier instead.

## Classifier Signals

A flow is considered a gameplay candidate only when several signals agree:

- source is the Xbox LAN IP or MAC
- protocol is UDP
- destination port is in a known multiplayer range
- destination port is not UDP/443
- packets are small, default `<= 600` bytes
- sustained bitrate is low, default `< 1.5 Mbps`
- timing is steady/game-like
- flow is not a bursty one-off download-like flow
- ASN/IP reputation can boost confidence, but is not sufficient alone

The current implementation ships the classifier and dry-run engine first.
Active WinDivert steering is intentionally not enabled until the packet capture
and NAT rewrite layer is implemented and tested.

## Dry-Run

Dry-run starts GameLane without changing routes or steering packets. It logs the
configured Xbox, Starlink, and mobile interfaces and reports that active
WinDivert steering is not available in this build.

User-facing mode name:

```text
GameLane 4G
```

Internal mode:

```text
gamelane4g
```

Logs are written to:

```text
%APPDATA%\AntiJitter\antijitter.log
```

Expected dry-run logs:

```text
[GameLane] mode enabled dry_run=true
[GameLane] Xbox configured: ip="" mac=""
[GameLane] LAN interface: "Xbox Ethernet / Windows ICS"
[GameLane] Starlink interface: "Ethernet 2"
[GameLane] 4G interface: "Wi-Fi"
[GameLane] WinDivert capture/steering not active yet; classifier dry-run scaffold is running
```

## Xbox Ethernet Setup

1. Connect Xbox to the Windows PC by Ethernet.
2. Connect Starlink to the Windows PC as the primary WAN.
3. Connect mobile data through hotspot, USB, or router as the secondary WAN.
4. Enable Windows sharing/ICS as needed for the Xbox LAN.
5. Select **GameLane 4G** in AntiJitter.
6. Start with dry-run and inspect logs before enabling future active steering.

## Known Limitations

- GameLane 4G is not seamless redundancy.
- If 4G spikes or drops, the game can lag or disconnect.
- If traffic switches between 4G and Starlink direct paths mid-session, the
  public IP/NAT mapping can change and the game session may break.
- Active steering requires a Windows packet capture and injection layer such as
  WinDivert or a production WFP driver.
- WinDivert requires Administrator privileges and driver installation.
- Classification needs per-game tuning.
- ASN/IP databases are useful hints but not reliable enough by themselves.
- Xbox platform traffic includes downloads, services, party systems, telemetry,
  and store traffic. Do not treat all Xbox traffic as gameplay.
- UDP/443 should stay on Starlink unless explicitly allowed for a known game.

## Next Implementation Step

The next step is a Windows-only WinDivert capture layer:

1. Capture forwarded Xbox packets from the LAN interface.
2. Build and update per-flow metadata.
3. Call the GameLane classifier.
4. For promoted flows, NAT/rewrite and send through the mobile interface.
5. Preserve reverse NAT mapping so replies return to the Xbox.
6. Leave all rejected traffic on the normal Starlink route.

Until that layer exists, GameLane 4G should be considered a safe UI/classifier
prototype, not an active router.
