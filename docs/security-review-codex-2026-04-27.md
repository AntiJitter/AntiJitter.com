# AntiJitter Security Review - Codex - 2026-04-27

Scope: read-only review of the active Android/dashboard branch for authentication, authorization, secrets, bonding protocol, Android VPN setup, server deployment scripts, API surface, frontend token/XSS posture, and third-party dependency exposure. No code fixes were made.

## Findings

### Critical

1. **Critical - `dashboard/backend/config.py:10`, `dashboard/backend/auth.py:31` - JWT signing key has a production-usable static default.**  
   If `SECRET_KEY` is missing in production, every access token is signed with the checked-in default `change-me-in-production-use-openssl-rand-hex-32`. Anyone who knows the source can mint valid JWTs for arbitrary user IDs.  
   **Recommended fix:** fail application startup when `SECRET_KEY` is unset or still matches any placeholder value; require a high-entropy secret from the environment or a secret manager.

2. **Critical - `server/main.go:115`, `server/main.go:185` - bonding server is keyed as a single global client and broadcasts WireGuard replies to all registered client paths.**  
   `key := "default"` merges all users into one dedupe/window state, and WireGuard replies are sent to every `clientState` primary path. In multi-user deployment this can leak encrypted WireGuard traffic/metadata across users, waste cellular data, and cause one user's sequence numbers to suppress another user's packets.  
   **Recommended fix:** partition client state by authenticated peer identity, WireGuard peer IP, or another per-user binding before production multi-user use; send replies only to the owning client's active path set.

### High

3. **High - `dashboard/backend/routers/connections.py:109`, `dashboard/backend/routers/connections.py:122` - authenticated command injection in interface toggling.**  
   Interface names only need to start with an allowed prefix such as `eth`; `eth0; <cmd>` still classifies as known and is interpolated into `create_subprocess_shell()`. Any authenticated user who can reach `/api/connections/toggle` can potentially run shell commands on the host.  
   **Recommended fix:** replace shell execution with argument-vector subprocess calls and validate interface names against actual names returned by `ip -json link`, not prefix-only string checks.

4. **High - `dashboard/backend/routers/auth.py:38`, `dashboard/backend/routers/auth.py:52` - login and registration lack rate limiting and lockout controls.**  
   `/api/auth/register` and `/api/auth/login` do not throttle by IP/account and there is no password attempt tracking. This makes password spraying, credential stuffing, and account enumeration materially easier.  
   **Recommended fix:** add per-IP and per-account rate limits, backoff, alerting, and generic responses where possible.

5. **High - `dashboard/backend/config.py:24`, `dashboard/backend/routers/config.py:83`, `server/peerapi.go:53` - peer registration uses a bearer token over plain HTTP by default.**  
   The Finland API posts the shared `bonding_peer_api_token` to `http://178.104.168.177:4568/peers`. If this path is not strictly private/firewalled, the token and peer registration traffic can be observed or modified.  
   **Recommended fix:** require HTTPS or a private authenticated network path for peer registration, fail startup if the URL is `http://` outside local/private ranges, and firewall port 4568 to the Finland VPS only.

6. **High - `dashboard/backend/models.py:40`, `dashboard/backend/models.py:41`, `dashboard/backend/routers/config.py:155` - WireGuard private keys are stored in plaintext and returned from the API.**  
   Subscription rows hold `wireguard_private_key` directly, and `/api/config` returns that private key to clients. A database leak or over-broad backend access compromises users' tunnel credentials until revoked.  
   **Recommended fix:** encrypt private keys at rest with envelope encryption, restrict DB/service access, rotate/revoke keys on suspected exposure, and avoid returning the private key except during explicitly authorized provisioning/download flows.

7. **High - `dashboard/backend/routers/config.py:105`, `dashboard/backend/routers/config.py:132`, `dashboard/backend/routers/wireguard.py:39`, `dashboard/backend/routers/wireguard.py:67` - WireGuard peer IP allocation is race-prone.**  
   `_next_peer_ip()` reads all used IPs and later commits without a uniqueness constraint or transactional lock. Concurrent provisioning requests can allocate the same peer IP to multiple subscriptions.  
   **Recommended fix:** enforce a unique database constraint on `wireguard_peer_ip` and allocate inside a transaction with retry-on-conflict semantics.

8. **High - `dashboard/frontend/package.json:21`, `dashboard/frontend/package.json:22` - frontend dependency audit reports high-severity Electron/electron-builder advisories.**  
   `npm.cmd audit --audit-level=low --json` reported 23 total vulnerabilities: 15 high, 6 moderate, 2 low. Directly affected dev/runtime desktop packaging dependencies include `electron`, `electron-builder`, `vite`, `@vitejs/plugin-react`, and `wait-on`; notable transitive advisories include Electron use-after-free/injection issues, `tar` path traversal, `@xmldom/xmldom` XML injection/DoS, `postcss` XSS, and `follow-redirects` auth-header leakage.  
   **Recommended fix:** update Electron and build tooling to advisory-cleared versions, regenerate the lockfile, rerun `npm audit`, and avoid shipping Electron builds until the direct Electron advisories are resolved or accepted as non-shipping dev-only risk.

### Medium

9. **Medium - `dashboard/backend/main.py:21` - CORS allows every origin with every method/header.**  
   The API currently sets `allow_origins=["*"]`, `allow_methods=["*"]`, and `allow_headers=["*"]`. Bearer-token APIs are less exposed than cookie APIs, but this still broadens browser-origin reach and makes future credentialed endpoints riskier.  
   **Recommended fix:** restrict CORS to `https://app.antijitter.com`, local dev origins, and any explicitly supported app origins.

10. **Medium - `dashboard/frontend/src/contexts/AuthContext.jsx:9`, `dashboard/frontend/src/contexts/AuthContext.jsx:39`, `dashboard/frontend/src/hooks/useMetrics.js:22` - dashboard JWTs live in `localStorage` and are also placed in the WebSocket query string.**  
    Any XSS on the dashboard can read the token, and query-string tokens can end up in reverse-proxy access logs or browser/network diagnostics. The token lifetime is also seven days by default (`dashboard/backend/config.py:12`).  
    **Recommended fix:** prefer HttpOnly/SameSite secure cookies or a short-lived access token plus refresh flow; pass WebSocket auth through a subprotocol or short-lived one-time ticket rather than a long-lived URL parameter.

11. **Medium - `android/app/src/main/java/com/antijitter/app/store/AuthStore.kt:11`, `android/app/src/main/java/com/antijitter/app/store/AuthStore.kt:22` - Android auth token is stored in unencrypted DataStore.**  
    DataStore is app-private but not encrypted. A rooted device, debug backup mistake, or local compromise can recover the bearer token while it remains valid.  
    **Recommended fix:** store tokens in EncryptedSharedPreferences/Jetpack Security or Android Keystore-backed storage, and shorten token lifetime with refresh/revocation support.

12. **Medium - `dashboard/backend/main.py:144`, `dashboard/backend/main.py:153` - metrics WebSocket accepts unauthenticated connections and has no per-client rate/connection limits.**  
    The WebSocket is accepted before token validation and streams indefinitely even with no token. This is useful for demo metrics, but it gives anonymous clients an always-on connection path and consumes server work every 0.5 seconds.  
    **Recommended fix:** require authentication for production dashboard metrics or split public demo metrics from authenticated user-session logging; add connection caps and idle limits.

13. **Medium - `dashboard/backend/routers/games.py:90`, `dashboard/backend/routers/games.py:143`, `dashboard/backend/routers/games.py:162`, `dashboard/backend/routers/games.py:173` - public game request/vote/sync endpoints lack abuse controls and strict input bounds.**  
    Public request and vote endpoints can be spammed, `GameRequestIn` has no length/URL/email constraints, and `/api/games/sync` can trigger background RIPE syncs without authentication.  
    **Recommended fix:** add rate limits, max lengths, URL/email validation, CAPTCHA or moderation for public writes, and restrict `/sync` to admin/internal use.

14. **Medium - `index.html:652` - public landing page injects game API fields through `innerHTML`.**  
    `g.icon`, `g.name`, and `g.range_count` are rendered into a template string. Today the game list is mostly seeded server data, but any compromised DB/admin path or future user-sourced game field can become stored XSS on `antijitter.com`.  
    **Recommended fix:** build DOM nodes with `textContent` for all API fields or sanitize with a trusted HTML sanitizer before insertion.

15. **Medium - `server/bonding/protocol.go:80`, `android/app/src/main/java/com/antijitter/app/bonding/Protocol.kt:69` - bonding dedupe is unauthenticated and can re-accept old ciphertext after restart/idle resets.**  
    The 4-byte sequence header is not authenticated by the bonding layer. WireGuard should reject replayed encrypted packets, but the bonding layer will forward replayed datagrams again after a 10s idle reset or session restart detection.  
    **Recommended fix:** treat WireGuard as the cryptographic anti-replay boundary in the current design, and document that the bonding layer is only a delivery/dedup shim; if non-WireGuard payloads are ever carried, add per-client authentication and replay protection first.

16. **Medium - `server/bonding/protocol.go:100`, `server/bonding/protocol.go:115`, `server/bonding/protocol.go:141`, `android/app/src/main/java/com/antijitter/app/bonding/Protocol.kt:50` - sequence rollover and dedupe arithmetic have edge-case risk.**  
    Go uses `uint32` sequence arithmetic and Kotlin uses a signed `AtomicInteger` masked to unsigned for dedupe. At high packet rates or long sessions, wraparound near `2^32` can interact badly with `seq + threshold` and `minSeq + window` comparisons.  
    **Recommended fix:** add explicit wraparound tests and documented behavior around rollover; consider forced session reset before rollover or wider sequence numbers in a future protocol version.

17. **Medium - `server/setup-route-all.sh:50`, `server/setup-route-all.sh:51`, `server/setup-route-all.sh:52` - route-all firewall rules are broad.**  
    The script allows all forwarding from and to `wg0` and MASQUERADEs the full WireGuard subnet. It does not restrict inbound WAN-to-WireGuard forwarding to established/related traffic or game/service destinations.  
    **Recommended fix:** use stateful FORWARD rules (`-m conntrack --ctstate ESTABLISHED,RELATED`) and explicit source/destination constraints that match the intended game-routing model.

18. **Medium - `server/deploy-bonding.sh:6`, `server/setup-route-all.sh:7` - deployment instructions encourage `curl | sudo bash` from a moving branch.**  
    Running root scripts directly from a mutable branch expands supply-chain risk: a compromised branch, DNS/TLS interception, or accidental branch update immediately becomes root code execution on the VPS.  
    **Recommended fix:** pin deploy commands to reviewed commit SHAs or signed release artifacts and verify checksums before running as root.

### Low

19. **Low - `dashboard/backend/routers/config.py:92`, `dashboard/backend/routers/config.py:97`, `dashboard/backend/routers/connections.py:123` - backend errors can disclose operational details.**  
    Some HTTP errors include upstream exception text, bonding-server status, or raw `ip` command stderr. These details are helpful during development but leak network and host information to clients.  
    **Recommended fix:** log detailed errors server-side and return stable, generic client messages with correlation IDs.

20. **Low - `dashboard/backend/routers/auth.py:14`, `dashboard/backend/routers/auth.py:19` - password policy is minimal.**  
    Registration accepts any string password with no minimum length or common-password checks. Bcrypt hashing is a good baseline (`dashboard/backend/auth.py:15`), but weak passwords remain easy to guess.  
    **Recommended fix:** enforce a minimum length, reject known breached/common passwords, and add client-side guidance that mirrors server-side validation.

21. **Low - `android/app/src/main/AndroidManifest.xml:6`, `android/app/src/main/AndroidManifest.xml:10` - Android permissions should be reviewed before Play/internal distribution.**  
    `CHANGE_NETWORK_STATE` and `FOREGROUND_SERVICE_SYSTEM_EXEMPTED` are powerful/sensitive and may draw policy review. They may be justified for a VPN, but the app should keep a short rationale for each permission.  
    **Recommended fix:** document why each permission is required and remove any permission that is not necessary after the Android VPN implementation stabilizes.

### Info / Positive Notes

22. **Info - `dashboard/backend/auth.py:15` - password hashing uses bcrypt through Passlib.**  
    This is an appropriate baseline for password storage. The main gaps are rate limiting and password quality controls, not plaintext password storage.

23. **Info - `android/app/src/main/java/com/antijitter/app/bonding/BondingClient.kt:98`, `android/app/src/main/java/com/antijitter/app/bonding/BondingClient.kt:105` - Android bonding UDP sockets are protected and network-bound.**  
    The bonding client calls `VpnService.protect()` before `Network.bindSocket()` for path sockets and probe sockets, which is the right pattern to avoid routing loops through the app's own VPN.

24. **Info - `android/app/src/main/AndroidManifest.xml:30` - the VPN service is not exported and is protected by `BIND_VPN_SERVICE`.**  
    This reduces external intent abuse against `BondingVpnService`; passing config JSON with a private key through the explicit in-app service intent is still sensitive, but not directly exposed to other apps by manifest export.

25. **Info - repository scan - no `.env`, `.key`, `.pem`, SQLite, or database files are tracked.**  
    `dashboard/backend/.env.example` contains placeholders only. The real risk is placeholder defaults being accepted at runtime, not committed live secrets found in this review.

## Verification Performed

- Read required project context: `CLAUDE.md` and `docs/ui-spec.md`.
- Reviewed the requested files and adjacent security-relevant modules.
- Ran `npm.cmd audit --audit-level=low --json` in `dashboard/frontend`; result: 23 vulnerabilities total, including 15 high.
- Searched for checked-in secret-like files with `rg --files -g ".env" -g "*.key" -g "*.pem" -g "*.db" -g "*.sqlite"`; no tracked live secret/database files found.
