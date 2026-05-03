# AntiJitter Game Optimization Plan

Last updated: 2026-05-03

This document captures the current Windows/Xbox test findings and the engineering
work that can make AntiJitter feel less sluggish in competitive games.

AntiJitter's core value is not "more Mbps". It is keeping a real-time game
session alive when Starlink handoffs, obstruction spikes, or mobile tower
changes would otherwise create packet loss, rubber-banding, or a disconnect.
The next product step is to reduce the extra baseline latency that the bonding
architecture adds, while keeping that stability.

## Current Measured Result

Recent Windows gateway test:

- Player location: Norway.
- AntiJitter POP: Germany / Hetzner.
- Shared device: Xbox over Windows Internet Connection Sharing.
- Game: Call of Duty.
- Session length: about 3 hours.
- Result: zero disconnects.
- In-game ping: roughly 40-70 ms, mostly around 60-70 ms.
- Windows path counters:
  - Starlink path: about 1.40 GB down, 1,265,251 packets.
  - Mobile data path: about 1.36 GB down, 1,239,902 packets.

This is a strong proof that Gaming mode is doing the right stability job. The
user previously saw Starlink-only gameplay rubber-band and disconnect back to
lobby; with AntiJitter Windows gateway, the same Xbox session stayed connected.

The remaining problem is competitive feel. A stable 60-70 ms is playable, but
for ranked FPS it still feels heavier than 20-40 ms. Riot's VALORANT netcode
writeups are useful context: they treat tens of milliseconds as meaningful in
competitive fights, and their infrastructure target was broad 35 ms ping
coverage. AntiJitter should be honest about this. We can reduce spikes and
disconnects immediately, but lowering baseline ping requires regional routing,
game-aware routing, and hot-path performance work.

## Data Usage Reality

The 3-hour Xbox test used about:

```text
Starlink down:    1.40 GB / 3 h = 0.47 GB per hour
Mobile down:      1.36 GB / 3 h = 0.45 GB per hour
Combined down:    2.76 GB / 3 h = 0.92 GB per hour
```

For Gaming mode, this is realistic. Gaming mode sends each packet across every
active path and the server replies on every active path, so mobile data can
approach Starlink data during a live game. That is the intended tradeoff:
maximum continuity, higher mobile usage.

This number is higher than the public "pure online game traffic" estimates many
ISPs publish, because our Windows gateway test is not pure game UDP only. It is
route-all console traffic through a shared Windows connection. The Xbox can also
generate party chat, Xbox services, NAT keepalives, telemetry, dashboard calls,
game backend traffic, and occasional background traffic. WireGuard and bonding
headers add overhead too.

Marketing guidance:

- Normal mode: should be described as low mobile use while Starlink is healthy.
  Do not quote a fixed mobile GB/hour number until we collect more sessions.
- Gaming mode: market as "active match protection" and say users should budget
  roughly 0.3-0.8 GB/hour of mobile data for console/PC Gaming mode, based on
  current real Xbox gateway testing.
- A safe plain-English line: "A 3-hour Call of Duty test used about 1.4 GB of
  mobile data in full Gaming mode. Normal mode uses much less when Starlink is
  healthy."
- Do not run game downloads or large updates in Gaming mode. The app should
  keep Normal as the default and later add game-only protection.

## Why Norway -> Germany -> Norway Feels High

AntiJitter adds a relay. The path is not:

```text
Xbox -> game host
```

It is:

```text
Xbox -> Windows -> Starlink/mobile -> AntiJitter POP -> game host
game host -> AntiJitter POP -> Starlink/mobile -> Windows -> Xbox
```

If the player is in Norway and the party host or selected game host is also in
Norway, a Germany POP can create a trombone route. Germany may still be good for
central EU matchmaking, but it is not automatically best for Nordic-to-Nordic
sessions.

The best POP is the one minimizing:

```text
client path latency to POP
+ POP latency to game server/host
+ queueing/processing overhead
+ jitter/loss penalty
```

The best server is not always closest to the user and not always closest to the
game server. It is the best end-to-end route for the current game, current
underlying paths, and current congestion.

## Product Principle

AntiJitter should not promise to reduce baseline ping in every case. A VPN relay
can increase baseline ping when the direct route was already good. The promise
should be:

- lower jitter during Starlink/mobile handoffs,
- fewer packet-loss events reaching the game,
- fewer disconnects,
- better route choices when a nearby POP exists,
- lower effective latency than a bad direct route when the direct ISP path is
  unstable or poorly routed.

For competitive users, the product must become "stable plus smart routing", not
just "stable through Germany".

## Optimization Roadmap

### 1. Add Regional Game POPs

Priority: very high.

The largest ping win is reducing relay distance and bad peering. Add more
bonding POPs and let clients choose or auto-select.

Recommended first regions:

- Nordic: Oslo, Stockholm, Copenhagen, or Helsinki.
- Central EU: Frankfurt or Nuremberg/Germany.
- West EU: Amsterdam.
- UK/Ireland: London or Dublin.
- Later: Paris, Warsaw, Madrid, Milan.

For the Norway Xbox test, a Nordic POP should be tested immediately against
Germany. If the party/game host is also Nordic, a Nordic POP will likely reduce
the baseline ping more than any code optimization.

Implementation:

- Add `BONDING_REGIONS` to the API config, each with multiple public IPs.
- Keep Germany as default until we have enough probes.
- Add a Windows region selector first: `Auto`, `Germany`, `Nordic`, etc.
- Add automatic recommendation after we collect enough measurements.

### 2. Build a Real POP Scoring Algorithm

Priority: very high.

The client should not pick the POP by geography alone. It should continuously
measure:

- Starlink -> each POP.
- Mobile data -> each POP.
- Each POP -> game destination, when known.
- Packet loss and jitter for each path.
- Recent failover events.
- Mobile data policy.

Initial score:

```text
score =
  min(client_path_rtt_to_pop)
+ estimated_pop_to_game_rtt
+ jitter_penalty
+ loss_penalty
+ queue_penalty
+ mobile_cost_penalty_for_Normal_mode
```

For Gaming mode, the client should prefer the POP with the lowest stable first
arrival, not necessarily the fastest single path. For Normal mode, the score
should favor Starlink primary quality and mobile conservation.

### 3. Add Game-Aware Routing

Priority: very high.

Windows route-all proved the gateway, but route-all is wasteful. Competitive
mode should protect game and voice traffic without duplicating console updates,
YouTube, app stores, and OS downloads.

Approaches:

- DNS/SNI observation for known game services.
- Destination IP/ASN database per game.
- Windows Filtering Platform later for local flow classification.
- Server-side connection observation for UDP flows after the tunnel.
- Manual "Protect this device / Xbox" profile as a simpler first step.

Rules:

- Small UDP game/voice packets: eligible for Gaming duplication.
- Bulk TCP/QUIC video/downloads: Normal primary-only.
- Console updates: never duplicate by default.
- Party voice: likely duplicate in Gaming mode.

This becomes a strong premium feature: "game-only protection".

### 4. Make Redundancy Adaptive

Priority: high.

Today Gaming mode is simple and effective: every packet on every active path.
That is reliable, but it consumes mobile data. The competitive version should
make duplication more selective without risking disconnects.

Candidate modes:

- Full Gaming: every game packet on every path.
- Smart Gaming: duplicate while Starlink is unstable, primary-only while it is
  clean.
- Burst rescue: duplicate for N seconds after a Starlink latency spike,
  obstruction event, packet loss, or missing ACK/probe.
- FEC/parity: send parity packets over mobile instead of full duplicates.

Start simple:

- Duplicate all small UDP packets during active game sessions.
- Do not duplicate large packets or bulk flows.
- In Normal mode, keep mobile warm with probes only and send mobile payload only
  during primary stalls.

### 5. Explicit Server Primary Path Selection

Priority: high.

Windows Normal previously showed a trap: routine mobile payload sampling could
make the server's `reply-mode:primary` choose mobile because mobile was the
latest inbound path. This burned mobile data and capped speedtests.

The durable fix is explicit primary path selection:

- Client sends `primary-path:<path-id>` control payload.
- Server stores primary per WireGuard peer/session.
- `reply-mode:primary` replies only to that path unless it is stale or failed.
- Server can fall back to the most recent healthy path after a timeout.

This makes Normal mode predictable on Windows and Android, and it prevents
mobile from becoming the downlink by accident.

### 6. Measure True Through-Tunnel Latency

Priority: high.

Current UI path latency is useful, but it is not the same as game RTT through
the AntiJitter tunnel and POP. Add probes for:

- Physical path RTT: Starlink/mobile to POP.
- Bonded tunnel RTT: client -> bonding server -> client.
- POP egress RTT: POP -> likely game destination.
- End-to-end flow RTT when observable.

Expose:

- best path latency,
- bonded RTT estimate,
- jitter,
- failovers,
- duplicate percent,
- mobile rescue bytes,
- route region.

The UI should explain less and show better numbers.

### 7. Server Hot-Path Optimization

Priority: medium-high after regional POPs.

The server should avoid adding avoidable milliseconds or jitter. Riot's server
performance writeups are a useful benchmark mindset: measure hot paths, keep
frames/queues short, avoid OS scheduling surprises, and validate each tweak.

Actions:

- Profile the Go bonding server under realistic packet rates.
- Remove allocations in the packet hot path.
- Reuse buffers with `sync.Pool` or fixed ring buffers.
- Avoid per-packet logging.
- Keep dedup data structures bounded and cache-friendly.
- Consider batched UDP reads/writes (`recvmmsg`/`sendmmsg` style) if Go's normal
  `ReadFromUDP`/`WriteToUDP` becomes a bottleneck.
- Add per-listener worker isolation only after profiling shows one goroutine is
  bottlenecked.
- Use `SO_REUSEPORT` only if we need multi-core listener scaling and can keep
  per-client state consistent.
- Track p50/p95/p99 server processing time.

Target:

- server processing p99 under 1 ms at expected load,
- no visible jitter introduced by Go GC,
- no UDP receive buffer drops during speedtests or duplicate Gaming mode.

### 8. Linux / VPS Network Tuning

Priority: medium-high.

UDP drops create visible game problems. Microsoft's AKS UDP troubleshooting doc
calls out `net.core.rmem_max`, `net.core.rmem_default`, `/proc/net/udp`, and
`RcvbufErrors` as concrete diagnostics for receive buffer pressure.

Baseline checks on every POP:

```bash
sysctl net.core.rmem_max net.core.rmem_default net.core.wmem_max net.core.wmem_default
cat /proc/net/snmp | grep Udp
cat /proc/net/udp
ss -u -n -i
tc qdisc show dev eth0
```

Potential tuning to test, not blindly ship:

```bash
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.udp_rmem_min = 8192
net.ipv4.udp_wmem_min = 8192
```

Important: bigger buffers prevent burst drops, but they can also hide overload
and add queueing delay. For gaming, the goal is enough buffer to survive bursts,
not deep queues. Measure p99 latency before and after.

### 9. Queue Discipline And Bufferbloat

Priority: medium.

Queueing delay can make a stable path feel sluggish. Investigate:

- `fq_codel` or `fq` on VPS egress.
- Per-client fair queueing if multiple customers share one POP.
- Avoiding large TCP/video/download queues in front of game UDP.
- Prioritizing small game UDP inside AntiJitter, especially on Switch.

Do not apply random "gaming sysctl" recipes. Measure:

- queue length,
- UDP drop counters,
- p95/p99 packet processing time,
- game RTT before/after,
- throughput impact.

### 10. MTU And Fragmentation

Priority: medium.

MTU probably does not reduce ping much for game packets. Most game packets are
small. MTU matters more for speedtests, downloads, and avoiding fragmentation.

Current Windows MTU is 1280. This is safe across mobile and IPv6-like paths, but
it can reduce large-packet throughput. Test:

- 1280: safe baseline.
- 1360 or 1380: likely still safe for WireGuard + bonding overhead.
- 1420: common WireGuard-ish target, but may be too high on mobile paths with
  extra encapsulation.

Test method:

- Measure Windows Normal speedtest and Gaming speedtest.
- Measure in-game ping/jitter, not just Mbps.
- Check for fragmentation and packet loss.
- Keep Xbox gateway tests wired and repeatable.

Decision rule:

- If 1380 improves speed without packet loss, consider it.
- If any game stutter or mobile path loss appears, keep 1280.
- Do not market MTU as a ping fix.

### 11. Windows Client Optimization

Priority: medium.

Windows gateway is the near-term console product. Improve connect time and
runtime behavior:

- Cache last working POP and per-adapter server assignment.
- Probe POPs/adapters in parallel.
- Start with the last known good path, then add slower paths after tunnel up.
- Keep Wintun driver installed and avoid reinstall paths.
- Keep bonding sockets warm across mode changes when possible.
- Add connection progress text:
  - detecting adapters,
  - pinning routes,
  - testing Starlink,
  - testing mobile data,
  - starting tunnel,
  - sharing ready.
- Move route and socket setup off the UI thread.
- Add "last successful setup" diagnostics to logs.

### 12. Android Client Optimization

Priority: medium.

Android Normal mode should match Windows Normal behavior:

- Wi-Fi/Starlink primary.
- Mobile probes keep the path warm.
- Mobile real payload only during primary stall.
- `reply-mode:primary` while Normal is selected.
- `reply-mode:all` while Gaming is selected.

Avoid routine mobile real-payload sampling unless server primary path selection
is explicit. Sampling can make the server reply to mobile and burn data.

Investigate:

- lower stall threshold for Gaming-like responsiveness without full duplication,
- Starlink dish event pre-warnings,
- Android network callback speed,
- foreground-service priority,
- socket reuse and path warmup.

### 13. Starlink-Specific Signals

Priority: medium.

Starlink is not just "Wi-Fi". It has dish state, obstruction state, satellite
handoffs, and local reachability signals. Use them.

Known local endpoint:

- `192.168.100.1:9200` for Starlink dish telemetry experiments.

Potential features:

- obstruction event -> temporarily duplicate,
- dish unreachable -> mobile rescue,
- high dish ping or recent outages -> pre-arm Gaming behavior,
- Starlink POP/geography display if discoverable,
- historical "handoff timeline" in session report.

This can make AntiJitter feel smarter than a generic bonding VPN.

### 14. NAT / Console Experience

Priority: medium, product-dependent.

Moderate NAT is usable, and the current Xbox test worked for hours. Open NAT is
not required for the core anti-disconnect proof, but it may matter for party
chat, matchmaking, and user perception.

Future Open NAT path:

- API allocates a public port range per user/device.
- Bonding server forwards that range to the user's WireGuard IP.
- Windows app forwards that range to Xbox's `192.168.137.x` ICS IP.
- UI shows "Open NAT setup" only after validation.

Do this later as a paid/pro console feature if demand is real.

### 15. Multi-Provider POP Testing

Priority: medium.

Do not assume Hetzner is always the best game relay just because it is cheap and
fast. Game routing depends on peering.

Test providers:

- Hetzner: cheap, good EU footprint, current baseline.
- OVH: often strong EU peering and DDoS posture.
- Leaseweb: strong Amsterdam/Frankfurt options.
- DigitalOcean/Vultr: convenient broad POPs, sometimes different peering.
- Cloud providers: more expensive, but useful for comparison.

Measure:

- client path RTT from Starlink and mobile,
- POP-to-game RTT,
- packet loss,
- jitter,
- cost per TB,
- CPU headroom,
- support for floating/additional IPv4s.

### 16. AntiJitter Switch Advantages

Priority: product roadmap.

The physical router can do things Windows and Android cannot do cleanly:

- classify Xbox/PlayStation/PC traffic at the gateway,
- avoid Windows ICS quirks,
- enforce game-only duplication,
- shape traffic with SQM/QoS,
- expose Ethernet and Wi-Fi sharing as the primary UX,
- keep mobile data policy predictable,
- support Open NAT/port ranges in one appliance.

Switch is the clean competitive product. Windows is the proof and beta.

## Measurement Plan

Every competitive test should record:

- game title and platform,
- user location,
- party host/game server region if known,
- AntiJitter POP,
- mode: Normal, Gaming, Smart Gaming if added,
- underlying paths and public IPs,
- Xbox NAT type,
- in-game ping min/median/p95/max,
- disconnects,
- rubber-band events,
- Starlink path down bytes/packets,
- mobile path down bytes/packets,
- failovers,
- server duplicate percent,
- server replies,
- POP CPU and UDP drop counters.

Test matrix:

1. Direct Starlink, no AntiJitter.
2. Direct mobile, no AntiJitter.
3. AntiJitter Germany Normal.
4. AntiJitter Germany Gaming.
5. AntiJitter Nordic Normal.
6. AntiJitter Nordic Gaming.
7. AntiJitter Auto region.
8. AntiJitter game-only protection when built.

## Short-Term Engineering Priorities

1. Add a Nordic POP and compare Norway Xbox gameplay against Germany.
2. Add explicit server primary path selection.
3. Add game-only routing/protection design for Windows gateway.
4. Add true through-tunnel latency probes.
5. Improve Windows connect time with cached last-good path and parallel probes.
6. Add POP selector and route diagnostics to Windows.
7. Verify Android Normal mobile data after the anti-sampling fix.
8. Profile the Go bonding server under 2-path Gaming speedtest traffic.
9. Tune Linux UDP buffers only after measuring drops.
10. Build a repeatable Xbox test report format.

## What To Market Now

Use:

- "A 3+ hour Call of Duty session over Windows gateway had zero disconnects."
- "Gaming mode used about 1.4 GB of mobile data over that 3-hour test."
- "Normal mode is the default for downloads and everyday use so mobile data
  stays protected while Starlink is healthy."
- "Gaming mode is for active matches and real-time voice."
- "AntiJitter reduces handoff spikes and disconnects. It does not guarantee a
  lower ping than direct fiber or a local game server."

Avoid:

- "Eliminates lag."
- "Guaranteed lower ping."
- "Open NAT solved."
- "Android hotspot sharing works."
- "Gaming mode is cheap on mobile data."

## Sources And Context

- Riot Games, "Peeking into VALORANT's Netcode" - useful explanation of why
  tens of milliseconds matter in competitive FPS, why buffering adds effective
  latency, and why regional infrastructure matters:
  https://www.riotgames.com/en/news/peeking-valorants-netcode
- Riot Games, "VALORANT's 128-Tick Servers" - useful server-performance mindset:
  profile hot paths, keep processing budgets tight, and validate OS/hardware
  tuning with load tests:
  https://www.riotgames.com/en/news/valorants-128-tick-servers
- Microsoft Learn, "Diagnose and solve UDP packet drops" - concrete Linux UDP
  buffer counters and `RcvbufErrors` guidance:
  https://learn.microsoft.com/en-us/azure/aks/troubleshoot-udp-packet-drops
- WireGuard project overview - WireGuard is UDP-based, cross-platform, and high
  performance, but AntiJitter's bonding and routing choices determine the game
  feel on top:
  https://www.wireguard.com/
- Xbox Cloud Gaming FAQ - public Microsoft context that streaming performance
  depends on user location and other factors; useful reminder that path location
  matters even for Microsoft-scale gaming infrastructure:
  https://www.xbox.com/en-US/cloud-gaming
