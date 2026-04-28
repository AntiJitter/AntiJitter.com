# AntiJitter — Marketing Brief

*Single source of truth for product positioning, copy, and launch strategy. Keep this file updated as the product evolves.*

---

## One-line pitch

**AntiJitter bonds your Wi-Fi and mobile data into one zero-spike gaming connection.**

Variants by channel:
- Reddit/organic: *"Bond Wi-Fi + 4G so Starlink spikes never reach your game."*
- Kickstarter headline: *"Lock in low latency — even on Starlink."*
- App store subtitle: *"Zero-spike gaming on any connection."*

---

## The problem we solve

Starlink and mobile connections spike. A single route — even a fast one — has moments where latency doubles or a handoff drops packets. Games are real-time; one spike means a death, a missed shot, or a disconnect. No existing product fixes this at the transport layer for ordinary gamers without a rack of gear.

**What AntiJitter does in plain English:**
Every packet your game sends leaves through two paths at once — your Wi-Fi and your mobile data. The server on the other end keeps the first copy that arrives and silently drops the duplicate. If one path spikes or drops a handoff, the other path already delivered. The game never sees the spike.

This is *bonding*, not load-balancing. No DNS tricks. No proxy. Real multi-path UDP.

---

## Target customers (priority order)

| Segment | Pain | Why AntiJitter fits |
|---|---|---|
| **Starlink RV / cabin gamers** | Satellite handoff spikes ruin ranked play | Their mobile data already exists; we just use it |
| **Rural home gamers** | Starlink is the only "broadband", no fallback | Same as above; $5/mo is nothing vs a new ISP |
| **Esports players / streamers in remote areas** | Competitive matches on satellite = disadvantage | Per-path live metrics prove they're protected |
| **Digital nomads** | Hotel Wi-Fi drops; hotspot is the backup | Phone app is the whole product — no router required |
| **Console + Starlink users** | No software path; need hardware | SWITCH is the answer (Kickstarter) |

---

## Two-product story

### AntiJitter App — *shipping now*
- Android app + WireGuard bonding server
- Game Mode toggle: one tap, dual-path active
- Gaming mode (every packet on every path) vs Browsing mode (Wi-Fi primary, mobile as failover)
- Per-path live latency + jitter + seamless failover count
- **$5/month** — one Starbucks drink

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
| Console support | Pair & Share (proxy, TCP only) | SWITCH (native UDP) |
| Active game indicator | No | Yes (roadmap) |
| Price | $9.99–14.99/mo | $5/mo |

**Positioning statement:** Speedify is a general-purpose bandwidth tool that also works for gaming. AntiJitter is a gaming tool, full stop. We show real milliseconds, not bars. We count seamless failovers. We built the hardware piece Speedify never did.

### vs Haste / Outfox / WTFast
Those are routing tools — they pick a better single path. They don't bond. If the path drops, you drop. AntiJitter is additive: your paths plus our bonding server equals zero-spike delivery.

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
| Failover-only: Wi-Fi primary, mobile backup | **Browsing** | "Standby", "Backup mode" |
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

- **Android app** — Game Mode toggle, Gaming/Browsing mode, per-path latency + jitter, session stats, seamless failover counter (placeholder), share dialog for hotspot setup
- **Bonding server** — Germany VPS, WireGuard + multi-path UDP dedup, BBR + fq, protocol seq-header fix shipped
- **Dashboard** — `app.antijitter.com`, React SPA, WebSocket latency stream, StarlinkPingChart, Stripe scaffold, user auth
- **Protocol** — seq header, sliding-window dedup, fan-out on all active paths
- **Dual status-bar icons** — `setUnderlyingNetworks` wired; Android shows both Wi-Fi + cellular icons simultaneously

---

## What is NOT built (roadmap / honest disclaimer)

- **Windows app** — bonding client in Go exists; native GUI + WireGuard tunnel management in progress
- **SWITCH hardware** — concept stage; Kickstarter pre-launch
- **iOS** — not planned until Android + Windows are stable
- **Game-only routing** — ASN IP ranges in DB, not yet wired into AllowedIPs (routes all traffic today)
- **Multi-user server isolation** — single bonding server handles one user safely; multi-user security fixes pending before second user onboards
- **True through-tunnel bonded latency** — current HeroLatencyCard shows `min(path RTTs)` as an approximation; real bonded probe requires seq-tagged round-trips through the tunnel
- **Console support** — requires SWITCH hardware or Always-on VPN + Block connections without VPN on Android for hotspot path

---

## Kickstarter strategy

**Angle:** Software already ships → technology is proven → hardware extends to consoles + travel use.

**Reward tiers (draft):**
- $5 — 3 months AntiJitter App (early-backer rate)
- $59 — SWITCH early bird (limited)
- $79 — SWITCH standard
- $149 — SWITCH + lifetime app subscription

**Validation milestones to hit before launch:**
1. Pixel tether test confirmed working (Always-on VPN path)
2. Windows beta with at least 5 external testers
3. One YouTube creator (Starlink-focused, 10k+ subs) demos the before/after latency chart

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
- **"Zero-spike gaming on any connection"** — technical, app store friendly
- **"Your Wi-Fi has a backup. Now it works."** — problem/solution
- **"Starlink gaming, minus the spikes"** — segment-specific
- **"Bond it. Game it. Never drop."** — rhythmic, social-friendly

---

## What NOT to claim

- Do not say "eliminates lag" — we reduce spikes, not baseline latency
- Do not say "guarantees" anything — use "lock in" which implies effort, not certainty
- Do not say "VPN" in user-facing copy — accurate technically but carries privacy/security connotations we don't want
- Do not imply 4G is free — users pay their carrier; we just use the data they already have
- Do not claim console support until SWITCH ships or tether test is confirmed
- Do not quote simulated benchmark numbers as measured results
