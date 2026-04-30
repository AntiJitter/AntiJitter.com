# AntiJitter — Marketing Brief

*Single source of truth for product positioning, copy, and launch strategy. Keep this file updated as the product evolves.*

---

## One-line pitch

**AntiJitter bonds Wi-Fi and mobile data into one low-jitter gaming connection.**

Variants by channel:
- Reddit/organic: *"Bond Wi-Fi + mobile data so Starlink spikes do not reach your game."*
- Kickstarter headline: *"Lock in low latency — even on Starlink."*
- App store subtitle: *"Low-jitter gaming on unstable connections."*

---

## The problem we solve

Starlink and mobile connections spike. A single route — even a fast one — has moments where latency doubles or a handoff drops packets. Games are real-time; one spike means a death, a missed shot, or a disconnect. No existing product fixes this at the transport layer for ordinary gamers without a rack of gear.

**What AntiJitter does in plain English:**
Game Mode sends traffic through Wi-Fi and mobile data to the same server. In Gaming mode, packets can race across both paths and the server keeps the first copy that arrives. In Normal mode, Wi-Fi stays primary and mobile data is used as a rescue path. If Starlink spikes or drops a handoff, the other path can keep the session alive.

This is *bonding*, not load-balancing. No DNS tricks. No proxy. Real multi-path UDP.

---

## Target customers (priority order)

| Segment | Pain | Why AntiJitter fits |
|---|---|---|
| **Starlink RV / cabin gamers** | Satellite handoff spikes ruin ranked play | Their mobile data already exists; we just use it |
| **Rural home gamers** | Starlink is the only "broadband", no fallback | Same as above; $5/mo is nothing vs a new ISP |
| **Esports players / streamers in remote areas** | Competitive matches on satellite = disadvantage | Per-path live metrics prove they're protected |
| **Digital nomads** | Hotel Wi-Fi drops; hotspot is the backup | Phone app is the whole product — no router required |
| **Console + Starlink users** | Need a gateway, not a phone-only app | Windows gateway beta now proves the path; SWITCH is the clean consumer product |

---

## Two-product story

### AntiJitter App — *shipping now*
- Android app + WireGuard bonding server
- Game Mode toggle: one tap, dual-path active
- Gaming mode (every packet on every path) vs Normal mode (Wi-Fi primary, mobile as failover)
- Per-path live latency + jitter + seamless failover count
- **$5/month** — one Starbucks drink

### AntiJitter Windows gateway - *proof/beta*
- Windows app routes the PC through the bonded tunnel and can be shared with classic Windows Internet Connection Sharing
- Tested Windows hotspot sharing: a device connected to the Windows hotspot saw the Germany/Hetzner IP and raised AntiJitter counters
- Tested Xbox Ethernet sharing: Xbox traffic flowed through AntiJitter and Xbox NAT showed Moderate
- This is the stepping stone for Xbox/PC sharing before SWITCH hardware
- Open NAT is not promised yet; console NAT needs separate forwarding work

### SWITCH — *Kickstarter, TBD*
- Pocket travel router: plugs into Ethernet or USB-C, runs AntiJitter bonding natively
- No phone required. Xbox, PlayStation, PC, Nintendo Switch — anything with Ethernet or Wi-Fi
- Kickstarter angle: software already shipping proves the tech is real
- Price target: ~$79 hardware + $5/mo service

---

## Competitive positioning

### vs Speedify
| | Speedify | AntiJitter |
|---|---|---|
| Focus | Bandwidth (downloads, streaming) | Latency + jitter (gaming, voice) |
| Hardware | None | SWITCH (roadmap) |
| Per-path metrics | Signal bars | Live ms + jitter + loss |
| Console support | Pair & Share / Connectify for sharing | Windows gateway proof now; SWITCH roadmap |
| Active game indicator | No | Yes (roadmap) |
| Price | $9.99–14.99/mo | $5/mo |

**Positioning statement:** Speedify is a general-purpose bandwidth tool that also works for gaming. AntiJitter is a gaming tool, full stop. We show real milliseconds, not bars. We count seamless failovers. On Windows, we proved the old-school ICS sharing path without requiring a second paid hotspot app.

### vs Haste / Outfox / WTFast
Those are routing tools — they pick a better single path. They don't bond. If the path drops, you drop. AntiJitter is additive: your paths plus our bonding server reduces the spikes the game sees.

### vs nothing (the honest comparison)
Most gamers just plug in Starlink. AntiJitter gives them a quantified upgrade: before/after ping charts, jitter numbers, failover counts. The dashboard is evidence, not just a toggle.

---

## Locked terminology

Copy must use these terms consistently across app, marketing, and video. Do not invent synonyms.

| Concept | Use | Avoid |
|---|---|---|
| The bonded tunnel product | **Game Mode** | "VPN mode", "tunnel" |
| A path dropped and the other kept going | **Seamless failover** | "failover caught", "outage avoided" |
| The combined Wi-Fi + mobile tunnel | **Bonded connection** / **Game Mode** | "VPN", "tunnel" (in user copy) |
| Fan-out: every packet on every path | **Gaming** | "Redundant", "Duplicate" |
| Failover-only: Wi-Fi primary, mobile backup | **Normal** | "Browsing", "Standby", "Backup mode" |
| Each underlying network | **Path** | "interface", "link" |
| Satellite/tower handoff | **Handoff** | "switch", "drop" |
| Latency variance | **Jitter** | "ping variation", "lag spike" |
| Achieving low-latency state | **Lock in** | "guarantee", "ensure" |
| Mobile cellular network | **Mobile data** | "cellular", "4G", "LTE" (in UI copy) |

---

## Voice and tone

- **Direct, not hype.** Real numbers, real charts. If we say "< 50 ms" we mean it.
- **Gaming-aware, not bro-y.** Know the difference between ranked and casual. Don't say "frag" or "no cap".
- **Norwegian clarity.** Short sentences. No fluff. Metrics over adjectives.
- **Honest about limits.** "This is an approximation until we add through-tunnel probes" is better than overclaiming. Users who catch a lie churn and post about it.

Sample headline pairs — preferred vs rejected:

| Preferred | Rejected |
|---|---|
| "Lock in low latency" | "Crush your enemies with insane ping" |
| "Seamless failovers: 3 this session" | "We saved your connection 3 times!" |
| "Bond Wi-Fi + mobile data" | "Supercharge your internet" |
| "97 ms → 31 ms with Game Mode" | "10× faster gaming" |

---

## Visual identity

| Token | Value | Use |
|---|---|---|
| Background | `#0a0a0a` | Page/app background |
| Surface | `#111` | Cards |
| Brand teal | `#00c8d7` | AntiJitter brand, Game Mode active state |
| Healthy/good | `#30d158` | Latency < 50 ms, connected state |
| Warning | `#ff9f0a` | Latency 100–200 ms, Starlink line in charts |
| Danger | `#ff453a` | Latency ≥ 200 ms, packet loss, degraded |
| Primary text | `#f5f5f7` | Body copy on dark backgrounds |
| Secondary text | `#86868b` | Labels, captions |

Typography: heavy numerals (800 weight), tabular-nums on all live metrics, minimal prose weight. The numbers ARE the UI.

---

## What's actually built today (April 2026)

- **Android app** — Game Mode toggle, Gaming/Normal mode, per-path latency + jitter, session stats, seamless failover counter, phone-only bonded traffic
- **Bonding server** — Germany VPS, WireGuard + multi-path UDP dedup, two public bonding IPs, per-client reply modes, WireGuard-index client isolation
- **Dashboard** — `app.antijitter.com`, React SPA, WebSocket latency stream, StarlinkPingChart, Stripe scaffold, user auth
- **Windows gateway proof** — route-all Windows PC traffic through AntiJitter; classic ICS hotspot sharing made a connected device show the Hetzner public IP; Xbox Ethernet ICS produced Moderate NAT and started a large game update through AntiJitter
- **Protocol** — seq header, sliding-window dedup, fan-out on all active paths, backward-compatible `seq=0` control payloads for reply mode
- **Dual status-bar icons** — `setUnderlyingNetworks` wired; Android shows both Wi-Fi + cellular icons simultaneously

---

## What is NOT built (roadmap / honest disclaimer)

- **Windows polished modes** — Windows route-all works, but Gaming/Normal UI parity is not built yet
- **SWITCH hardware** — concept stage; Kickstarter pre-launch
- **iOS** — not planned until Android + Windows are stable
- **Game-only routing** — ASN IP ranges in DB, not yet wired into AllowedIPs (routes all traffic today)
- **Production multi-user hardening** — basic per-client isolation shipped, but auth, rate limits, abuse controls, and ops hardening still need work
- **True through-tunnel bonded latency** — current HeroLatencyCard shows `min(path RTTs)` as an approximation; real bonded probe requires seq-tagged round-trips through the tunnel
- **Console/Open NAT support** — Windows gateway sharing is proven for at least one hotspot client, but Xbox testing and Open NAT forwarding are not done
- **Android hotspot sharing** — Android hotspot and USB tethered clients bypass the app VPN in current tests
- **Game-only protection** — not built yet; large console updates can burn mobile data in Gaming mode, so game/update classification is future premium/pro work

---

## Kickstarter strategy

**Angle:** Software already ships → technology is proven → hardware extends to consoles + travel use.

**Reward tiers (draft):**
- $5 — 3 months AntiJitter App (early-backer rate)
- $59 — SWITCH early bird (limited)
- $79 — SWITCH standard
- $149 — SWITCH + lifetime app subscription

**Validation milestones to hit before launch:**
1. Windows gateway proof: shared client sees the Germany/Hetzner IP through AntiJitter
2. Xbox Ethernet or Windows hotspot test confirms console traffic uses the bonded tunnel
3. Windows beta with at least 5 external testers
4. One YouTube creator (Starlink-focused, 10k+ subs) demos the before/after latency chart

---

## Distribution channels

| Channel | Tactic |
|---|---|
| r/Starlink | "I bonded Starlink + 4G for gaming — here's the latency chart" post (show real data) |
| r/gaming, r/competitivegaming | Game Mode case studies with per-title latency numbers |
| RV/full-time travel Facebook groups | Practical framing: "stable gaming on the road" |
| YouTube Starlink creators | Demo video: before (Starlink alone) vs after (bonded), screen + chart |
| Product Hunt | Launch when Windows beta ships |
| Hacker News | "Show HN: I built multi-path UDP bonding for Starlink gamers" |
| App Store / Play Store | ASO: "starlink gaming", "mobile data bonding", "reduce ping" |

---

## Sample taglines (pick one per campaign)

- **"Lock In, Don't Lag Out"** — primary brand tagline
- **"Low-jitter gaming on unstable connections"** — technical, app store friendly
- **"Your Wi-Fi has a backup. Now it works."** — problem/solution
- **"Starlink gaming, minus the spikes"** — segment-specific
- **"Bond it. Game through the spikes."** — rhythmic, social-friendly

---

## What NOT to claim

- Do not say "eliminates lag" — we reduce spikes, not baseline latency
- Do not say "guarantees" anything — use "lock in" which implies effort, not certainty
- Do not say "VPN" in user-facing copy — accurate technically but carries privacy/security connotations we don't want
- Do not imply 4G is free — users pay their carrier; we just use the data they already have
- Do not claim Android/iOS hotspot sharing works; Android hotspot and USB tethering bypassed the app VPN in tests
- Do not claim Xbox/Open NAT is solved until Xbox traffic and forwarding are tested end to end
- Do not quote simulated benchmark numbers as measured results
