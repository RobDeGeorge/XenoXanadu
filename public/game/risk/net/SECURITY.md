# Risk match-server — Security Audit

A plain-English security review of `net/server.js`, with every control mapped to
the real-world project / standard it follows (so we're not reinventing internet
security). Verified by `net/test-sec.js`.

## Threat model

`server.js` is a small, hand-rolled WebSocket server that runs the game engine as
the authority for casual multiplayer Risk. It is **not** an account system or a
public service. Realistic adversaries: a malicious web page a player visits, a
prankster on the same network or with the room link, and accidental floods/bugs.

**The most important fact:** there is **no remote-code-execution surface.** The
server has no `eval`, no `child_process`/shell, no filesystem writes, and never
`require()`s anything from user input (audited — zero such sinks). The only thing
a network peer can do is submit game *intents*, which the engine validates and
rejects if illegal. So the worst realistic outcome is disruption of a game, not
compromise of the host.

## Controls (and what each follows)

| # | Control | Defends against | Follows |
|---|---------|-----------------|---------|
| 1 | **Localhost-only bind by default** (`127.0.0.1`; `HOST=lan` to expose) | Accidental exposure to LAN/internet | Redis/MongoDB "bind 127.0.0.1 by default" lesson (both were mass-compromised when they defaulted to all-interfaces) |
| 2 | **64 KB frame cap** → close `1009` | Memory-exhaustion DoS via a giant announced frame length | `ws` `maxPayload` (default 100 MiB; we use OWASP's "64 KB or less" since moves are tiny). Closes with RFC 6455 code 1009 |
| 3 | **Bounded buffering + fragment cap** | Slow-drip "hold a huge frame open" memory growth; fragment-bomb | RFC 6455 framing; `ws` `maxFragments` |
| 4 | **Origin allowlist** (localhost + `ORIGINS=`; native clients allowed; `ALLOW_ANY_ORIGIN=1` to disable) | **Cross-Site WebSocket Hijacking (CSWSH)** — a malicious page opening a socket to your server from a victim's browser | OWASP WebSocket Cheat Sheet ("validate Origin with an allowlist, not a denylist") |
| 5 | **Per-IP + global connection caps** (`MAX_CONN_PER_IP=16`, `MAX_CONN=200`) → 429/503 | Socket-exhaustion DoS | OWASP ("limit total connections with per-user or per-IP restrictions") |
| 6 | **Per-socket message rate limit** (token bucket, 30/s burst 60) → close `1008` | Message floods / CPU exhaustion | OWASP ("implement rate limiting"); closes with RFC 1008 (policy violation) |
| 7 | **Ping/pong heartbeat + socket idle timeout** (30 s ping, 120 s idle) | Dead/zombie/slowloris connections holding resources | `ws` README's canonical `isAlive` heartbeat pattern |
| 8 | **Handshake/headers timeout** (10 s) | Slowloris on the HTTP upgrade | Node `http` `headersTimeout`/`requestTimeout` |
| 9 | **RFC-6455 frame validation** — require client masking (`1002`), reject bad RSV bits, enforce control-frame FIN + ≤125, UTF-8 validate text (`1007`) | Malformed-frame crashes / protocol confusion | RFC 6455 §5; `ws` `skipUTF8Validation=false` |
| 10 | **Backpressure guard** (drop a socket whose write buffer exceeds 8 MB) | Slow-reader memory growth | OWASP ("backpressure controls to prevent memory exhaustion") |
| 11 | **Server is authoritative; clients send intents only** | Cheating, illegal moves, state desync | Standard authoritative-server model (Colyseus, every real multiplayer game) |
| 12 | **Per-player redacted snapshots** (your hand only; deck withheld) | Information disclosure of hidden game info | Least-privilege / need-to-know |
| 13 | **Turn + action authorization on every message** | Acting out of turn / as another seat | OWASP ("authorize each action, not just the connection") |
| 14 | **Input hygiene** — `JSON.parse` (never `eval`), typed-field checks, control-char-stripped names, room/map caps | Injection, prototype-pollution attempts, log/render abuse | OWASP ("treat all messages as untrusted; use JSON.parse not eval; validate structure") |
| 15 | **Room lifecycle** — empty/stale rooms reaped (TTL 30 min), `MAX_ROOMS=100` | Unbounded room/memory growth | Resource-lifecycle hygiene |
| 16 | **Optional shared secret** (`ROOM_PASSWORD=…`) | Uninvited people using your exposed server | Lightweight auth (OWASP allows handshake-time auth) |
| 17 | **Security logging** (`[sec]` lines for blocked origins, caps, floods — never message contents) | Blind to abuse | OWASP ("log security violations; avoid logging sensitive data") |

## Out of scope (by design)

- **TLS / `wss://`** — terminate it at the tunnel or platform (Cloudflare Tunnel,
  ngrok, Fly.io, a reverse proxy). The OWASP "always use WSS in production" rule is
  satisfied by the tunnel/host, not by this process. On localhost/LAN, plain `ws://`
  is acceptable for a casual game.
- **Accounts / identity / persistence** — it's an ephemeral party game; rooms vanish
  on restart. Lightweight gating is the optional room password.
- **Network-layer DDoS** — handled by the tunnel/CDN if you expose it, not here.

## Residual risks & limits (slice 1)

- **No reconnection:** if a player drops mid-game their seat is freed and the turn
  can stall until the room is reaped. (Planned with the AI-sponsorship slice — an
  absent seat can fall back to the heuristic bot.)
- **Room codes are ~1M combinations.** Fine when the server is localhost/LAN; if you
  expose it publicly, set `ROOM_PASSWORD` so codes aren't the only gate.
- **Shared-secret password is server-wide and sent in the clear over `ws://`.** Only
  meaningful behind `wss://` (a tunnel). It's a "keep randoms out," not real auth.
- Hand-rolled WebSocket framing is intentionally minimal (text JSON only). It's
  covered by `test-sec.js`, but for a hardened public deployment you'd swap in the
  `ws` library — the room/engine logic wouldn't change.

## How to run, by exposure

```bash
node server.js                                   # localhost only (safest; same machine)
HOST=lan node server.js                          # expose to your LAN (friends on your Wi-Fi)
HOST=lan ROOM_PASSWORD=hunter2 node server.js    # LAN + a shared secret
# Internet: keep it on localhost and put a TLS tunnel in front, then share the wss:// URL:
node server.js &  cloudflared tunnel --url http://localhost:8790
ORIGINS=https://your-page-origin node server.js  # if you serve the page from a real origin
```

Tunable via env: `PORT, HOST, MAX_PAYLOAD, MAX_CONN, MAX_CONN_PER_IP, MAX_ROOMS,
MSG_RATE, MSG_BURST, IDLE_MS, ROOM_TTL_MS, ORIGINS, ALLOW_ANY_ORIGIN, ROOM_PASSWORD`.

## References
- `ws` (websockets/ws) — README (heartbeat/`isAlive`, `maxPayload`) and `doc/ws.md`
  (`maxPayload` default `104857600`/100 MiB, `maxFragments`, `skipUTF8Validation`).
- OWASP WebSocket Security Cheat Sheet — WSS, Origin allowlist/CSWSH, per-action auth,
  input validation, message-size limits (~64 KB), rate limiting, idle timeouts/heartbeat,
  backpressure.
- RFC 6455 (The WebSocket Protocol) — framing, masking, close codes (1002/1007/1008/1009).
- Redis/MongoDB localhost-bind-by-default history — why we don't listen on `0.0.0.0`.
