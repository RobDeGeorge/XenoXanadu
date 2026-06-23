# Risk — Online Multiplayer (match-server)

Play Risk with friends across browsers. One person runs a small **authoritative
match-server**; everyone else connects to it from the Risk page. The server holds
the one real game (using the same `engine.js` the browser uses), validates every
move, rolls all dice, and sends each player a redacted view (you see only your own
cards).

Now supports **reconnection** (drop and rejoin your seat), **spectators** (watch any
room), and **AI seats** (the host can fill seats with heuristic generals played
server-side) — so two friends can play a 4-player game against bots.

## Run it

Zero dependencies — no `npm install`. You need Node 18+ (Node 21+ for the test
harnesses, which use the built-in `WebSocket` client).

```bash
cd public/game/risk/net
node server.js                 # localhost only — ws://127.0.0.1:8790  (safe default)
HOST=lan node server.js        # expose to your home network (friends on your Wi-Fi)
PORT=9000 node server.js       # custom port
```

It binds to **localhost only by default** — others can't reach it until you opt in
with `HOST=lan` (or a tunnel). See **[SECURITY.md](SECURITY.md)** for the full audit
and all env knobs.

Then open the Risk page (served locally, e.g. `cd public && python3 -m http.server 8000`
→ http://localhost:8000/game/risk/), scroll to **Play Online**:

1. **Host** picks Map / Manual-draft at the top, enters a name, clicks **Create Room**,
   and shares the 4-letter code.
2. **Everyone else** enters the same server address + code and clicks **Join**.
3. Host clicks **Start** (2–6 players). Play proceeds turn by turn, synced to all.

## Playing across the internet

Each browser only ever talks to the match-server (and, later, its *own* local Ollama).
- **Same machine:** default `ws://localhost:8790` works.
- **Same LAN:** run with `HOST=lan` and share `ws://<host-lan-ip>:8790`.
- **Over the internet:** keep it on localhost and put a **TLS tunnel** in front (an
  `https://` page can only open `wss://`) — `cloudflared tunnel --url http://localhost:8790`,
  `ngrok http 8790`, or Tailscale — and share the resulting `wss://…` URL. Or deploy
  `server.js` to an always-on host (see below). When exposing publicly,
  set `ROOM_PASSWORD=…` (and `ORIGINS=` if your page has a real origin).

## Deploy to the cloud (always-on, recommended)

So friends just click the page and play — no one has to run a server each time.
The repo ships a zero-dependency **Fly.io** setup (`Dockerfile` + `fly.toml` in this
folder). Fly terminates TLS automatically, so the hosted `https://` arcade can open a
`wss://` socket to it. **Build/deploy from the parent `risk/` directory** — the image
needs `../engine.js`, `../maps.js`, `../generals.js`, `../bots.js`:

```bash
cd public/game/risk
flyctl auth login
flyctl launch --no-deploy --config net/fly.toml --name risk-xenoxanadu   # first time; pick your own name/region
flyctl secrets set ORIGINS="https://xenoxanadu.com" ROOM_PASSWORD="pick-a-secret" --config net/fly.toml
flyctl deploy --config net/fly.toml
curl https://risk-xenoxanadu.fly.dev/healthz        # -> ok
```

`ORIGINS` only needs your public site — **`localhost` / `127.0.0.1` / `*.local` origins are
always allowed** (see `originAllowed` in `server.js`), so you can still test a locally-served
page (`http://localhost:8000/game/risk/`) against the deployed `wss://` server without listing it.

Then set the Play Online address on the Risk page to `wss://<your-app>.fly.dev`
(`index.html` already defaults to `wss://risk-xenoxanadu.fly.dev`; change it if you
chose a different app name). Game state lives in memory in one process — the config
keeps a single warm machine and never stops it; **don't scale past one machine.**
Railway / Render work the same way (one Node service, `HOST=0.0.0.0`, the platform's
`$PORT`, health check `/healthz`).

## How it works

```
browsers ──(intents)──▶  match-server  ──(redacted snapshots + dice events)──▶ browsers
                         holds engine.js
                         = single source of truth
```

- **Authority:** clients send *intents* (`deploy`, `attack`, `fortify`, …). The server
  validates each with the engine (illegal/out-of-turn → rejected), applies it, and
  broadcasts. Clients never mutate the real state, so desync and cheating are impossible.
- **Hidden info:** snapshots are redacted per player — your hand in full, everyone
  else's as a count; the deck is never sent.
- **Randomness:** all dice/shuffles happen only on the server.

### Files
- `server.js` — the match-server (hand-rolled WebSocket + rooms + engine authority + hardening).
- `client.js` — browser transport (`window.RiskNet`), loaded by the Risk page.
- `SECURITY.md` — full security audit (each control mapped to `ws`/OWASP/RFC 6455).
- `test-net.js` — Node harness: two simulated players exercise create/join/redaction/
  turn-gating/sync. `node test-net.js` (the full browser↔server path was validated
  end-to-end during development with a real headless browser).
- `test-sec.js` — security regression: payload cap, rate-limit flood, safe bind. `node test-sec.js`

### Protocol (JSON text frames)
Client→server: `create`, `join{spectate?}`, `rejoin{code,token}`, `config`, `addAI`,
`removeAI`, `start`, `intent{action,…}`.
Server→client: `created`/`joined`, `lobby{members,bots,spectators}`,
`start{mySeat,token}`, `state{snapshot}`, `event{kind:"dice"|"log"}`, `error{msg}`.

### Features
- **Reconnection:** `start` hands each human a per-seat token; a dropped player sends
  `rejoin{code,token}` to reclaim their seat. Rooms survive drops until idle past
  `roomTtlMs` (the reconnect window). The browser auto-reconnects and also offers a
  "Reconnect to room …" button after a refresh.
- **Spectators:** `join{spectate:true}` watches any room (even full/started) with a
  fully-redacted view (no hand is revealed); spectators can't send intents.
- **AI seats:** the host `addAI`/`removeAI`s heuristic generals (from `bots.js`),
  played server-side and paced by `AI_DELAY_MS`. Lets a couple of friends play a
  larger game against bots.

## Known limits
- No AI-seat *sponsorship* yet (a player's local Ollama driving a seat over the net).
- One game per room.
