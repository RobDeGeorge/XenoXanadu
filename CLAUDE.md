# XenoXanadu — AI Agent Guide

## Project Overview

XenoXanadu is a **pure static arcade of classic games**, each rebuilt by hand and playable in
the browser. Hosted on GitHub Pages at **xenoxanadu.com**. No framework, no build step — the
contents of `public/` are published as-is.

> History: this repo was previously a SvelteKit US-national-parks field guide. That site was
> popped out into a standalone `NationalParks/` project (a sibling folder) and XenoXanadu was
> rebranded into this games site. The parks source is no longer here.

## Structure

```
public/                 Everything that ships (this folder IS the website)
  index.html            Arcade homepage / game hub — one card per game
  ai-setup.html         "Bring Your Own Model" hub — connect/test a local LLM (shared by all AI games)
  CNAME                 xenoxanadu.com
  .nojekyll             Serve dotfiles/underscored paths verbatim
  lib/
    byom.js             Shared client-side LLM pipeline (window.XenoBYOM) — see "Local-LLM games"
    eval.js             Shared eval/data-collection layer (window.XenoEval) — see "Model eval & prompt tuning"
  game/
    chess/              Full chess (check, mate, castling) — 🤖 optional local-model opponent
    connect-four/       Connect Four — 🤖 optional local Ollama opponent + 🧪 benchmark harness
    dots-and-boxes/     Retro neon Dots & Boxes — 🤖 optional local-model opponent
    texas-holdem/       No-limit Hold'em tournament — 🤖 a whole table of local-model personalities
    hangman/            Neon Hangman — pass-&-play secret word, or 🤖 model picks/guesses the word
    minesweeper/        Neon Minesweeper — built-in logic solver for hints/auto-solve; 🤖 model narrates each deduction
    rock-paper-scissors/  RPS (+ Lizard-Spock) — pattern-predicting bot offline; 🤖 model predicts your throw & trash-talks
    backgammon/         Full backgammon (dice, bar, bearing off, gammons) — built-in heuristic AI; 🤖 optional local-model opponent
    risk/               ⭐ FLAGSHIP — Risk: Global Domination. Low-poly SVG board, dice combat, cards, continent bonuses, 2–6 players. MULTIPLE BOARDS — a map picker chooses from a registry: the classic 42-territory world plus hand-designed "fun" boards (Clash = fast 4×4 grid, Arena = symmetric wheel, Bridges = island choke-points, Starfall = themed star). Named AI "generals" with personalities. Built-in heuristic bots play fully offline; 🤖 a local model can PLAY the generals (Pattern A — model picks deploy/attack/fortify from engine-supplied legal options, heuristic fallback). Split: engine.js (pure rules; built-in CLASSIC_MAP + installMap to swap boards) / maps.js (board registry: window.RiskMaps, each board is data the engine installs) / generals.js / bots.js / ai-parse.js / main.js. ONLINE MULTIPLAYER (beta) lives in net/ — a zero-dependency authoritative match-server reusing engine.js under Node; friends create/join a room by code and play across browsers (see net/README.md)
    go/                 Go (9/13/19) — captures, ko, area scoring; scalable heuristic bot; 🤖 model picks & explains territory (Pattern A)
    gomoku/             Five-in-a-row (15×15) — threat-scan bot w/ depth control; 🤖 optional local-model opponent (Pattern A)
    hex/                Hex connection game (no draws) — path-resistance bot, bridge flags; 🤖 optional local-model opponent (Pattern A)
    mancala/            Mancala (Kalah) — minimax "elder" AI, extra-turn/capture; 🤖 optional local-model opponent (Pattern A)
    sudoku/             Sudoku — unique-solution generator + constraint solver; 🤖 model narrates each deduction (Pattern B1, like minesweeper)
    mahjong/            Mahjong solitaire — solvable turtle layouts, stuck/hint solver; 🤖 model narrates the hint (Pattern B1)
    mastermind/         Mastermind — play either side; Knuth minimax solver; 🤖 model narrates how clues prune candidates (Pattern B1)
    pong/               Pong — canvas real-time, adaptive "just-barely-beatable" paddle; 🤖 optional model trash-talk only (Pattern B2)
    dominion/           Dominion-style deckbuilder (engine/strategies/main split) — big-money/engine/attack bots; 🤖 optional model seat (Pattern B2)
    blackjack/          Blackjack — house-rule dealer + basic-strategy coach + count tell; 🤖 optional model dealer/coach voice (Pattern B2)
    sand-falling/       "Sand Garden" falling-sand sim + optional Node AI bridge
.github/workflows/
  deploy.yml            Uploads public/ to GitHub Pages (no build)
```

## Conventions

- **Each game is self-contained in its own folder** under `public/game/<name>/` with an
  `index.html` entry point. No shared bundler; games don't import from each other.
- Folder names are **kebab-case, no leading underscore** (e.g. `connect-four`/`dots-and-boxes`).
  The author's wider workspace prefixes folders with `_`; that convention is dropped here.
- The homepage (`public/index.html`) is plain HTML/CSS with a `.card` grid. To add a game:
  create `public/game/<name>/`, then add an `<a class="card" href="game/<name>/index.html">`.

## Local-LLM games (🤖)

The model is **Bring Your Own**: the site ships the pipeline, the *visitor* runs the model on
their own machine. Nothing goes to a XenoXanadu server (there isn't one) — the browser talks
straight to the user's endpoint.

**`public/lib/byom.js`** (global `window.XenoBYOM`) is the shared, dependency-free pipeline used
by every AI game. It is common infrastructure, not a game importing another game — that's the one
sanctioned exception to "games don't import from each other". It provides:
- Provider abstraction: **Ollama native** (`/api/tags`, `/api/chat`) *and* **OpenAI-compatible**
  (`/v1/models`, `/v1/chat/completions`) — so LM Studio / llama.cpp / Jan / vLLM also work.
- One config (`endpoint`/`provider`/`model`/`apiKey`) persisted in `localStorage` (`xeno.byom.v1`),
  shared across games — the user connects once.
- `listModels`, streaming `chat({messages,onToken,onThinking,signal})`, and `test()`.
- **Connection diagnostics**: `fetch` hides *why* a local call failed (down vs CORS vs mixed-content
  vs Private Network Access), so errors carry actionable `remedies` instead of a bare failure.

**`public/ai-setup.html`** is the canonical "connect a model" hub: live connection tester +
an origin-tailored `OLLAMA_ORIGINS` command. Every AI game links to it.

Games:
- **chess** — `XenoBYOM.chat` directly. The engine computes the *legal* move list and the model
  must pick one from it (replies `MOVE: <SAN>`), so it can't make an illegal move; an unparseable
  reply falls back to a sensible legal move. AI hooks into `doMove`/`newGame`/`undo`.
- **connect-four** — uses `XenoBYOM.chat` directly (browser → user's model, no server).
- **dots-and-boxes** — `XenoBYOM.chat`. The browser tags every legal edge (does it complete a
  box / hand one over?) and the model picks one by number (`MOVE: <n>`); unparseable → best-ranked
  fallback. One configurable AI seat; handles the extra-turn chain via `claimEdge`.
- **backgammon** — single-file, like checkers. The engine enumerates every legal *full turn* for a
  dice roll (handling the use-both-dice / play-the-larger-die / bar-entry / bear-off rules), so the
  human is only ever offered sub-moves on a maximal legal turn and the AI/model pick from the same
  set — nothing illegal is possible. A built-in heuristic AI (pip race + blot-danger + made-points,
  Easy/Medium/Hard) plays offline / on the hosted site; tick the box to let a local model choose
  instead — it's handed the numbered list of legal turns and replies `MOVE: <n>` (unparseable →
  heuristic fallback). Counts gammons/backgammons.
- **texas-holdem** — a full no-limit Hold'em **tournament** (rising blinds, side pots, knockouts).
  Split into files (unlike the other single-file games): `engine.js` is a **pure, DOM-free** poker
  core (deck, 7-card evaluator, betting state-machine, side pots, tournament) that also runs under
  Node — it has a self-test/fuzz harness; `personalities.js` is the persona pool; `main.js` is the
  table UI + AI. **One model fills every AI seat**, each with a random *personality* injected into
  its prompt (so a single small model yields a table of distinct characters); a **per-seat model
  override** lets power users assign different models (same endpoint) to specific seats. The browser
  hands the model only its *legal* actions (numbered) and it replies `ACTION: <n>`, so it can't make
  an illegal bet; an unparseable reply falls back to a persona-weighted heuristic. **That same
  heuristic also runs the bots when no model is connected** — so unlike the other AI games, Hold'em
  is fully playable offline / on the hosted site (pure JS bots); the local LLM is an enhancement,
  not a requirement. You can **take a seat** or **spectate** an all-AI table.
- **hangman** — three modes (`main.js`): **2p** pass-&-play where one player types *any* word into a
  masked (`type=password` + 👁 toggle) "look away" entry screen, then hands the device over to guess;
  **ai-word** where the model secretly picks a themed word and you guess (with in-character taunts and a
  one-time mercy letter near the end); **ai-guess** where you type a word and the model cracks it letter
  by letter, reasoning streamed to a panel. The model only ever returns a single legal letter / a
  validated word; offline (hosted site or no model) it falls back to `words.js` (themed word bank) for
  picking and a letter-frequency strategy for guessing, so all modes work without a model.
- **risk** — the flagship. Classic Risk on a hand-built **low-poly neon world map** (42 territories / 6
  continents, drawn as deterministic SVG polygons from each territory's layout anchor; adjacency edges
  rendered under them, cross-continent links dashed as "sea routes", Alaska↔Kamchatka wraps the top edge).
  Split like texas-holdem into a **pure, DOM-free** `engine.js` (topology = single source of truth for both
  rules *and* map geometry; `node engine.js` runs a self-check + random self-play) / `generals.js` (the
  named-general persona pool, each a strategy-weight profile + voice) / `bots.js` (heuristic planners:
  `planReinforcements`/`planAttack`/`planFortify`, personality-weighted, **always legal**, used both as the
  offline opponent and as the model's fallback) / `ai-parse.js` (pure, DOM-free reply parsing/allocation,
  shared by main.js and the test) / `main.js` (SVG UI, dice, cards, phase flow, model-turn driver).
  **🤖 When a local model is connected and set to "play", the MODEL makes the moves** — same legal-options
  contract as chess/backgammon (Pattern A): for each phase the engine hands it a NUMBERED list of legal
  options (deploy targets, assaults, fortifies) and it replies with a number / a deploy allocation; an
  unreadable reply falls back to the heuristic planner, so it can never play illegally and a flaky model
  can't wedge the turn. Its reasoning streams into the side panel, coloured by general. With no model (or
  the box unticked) the heuristic bots play and the general just gets a canned taunt. Two Node harnesses:
  `test-bots.js` self-plays full games with the real planners and asserts invariants; `test-ai.js` drives
  a **real local model** through one of each phase decision using the shipping prompts + parsers and checks
  every reply maps to a legal move. 2–6 players (mix of humans pass-&-play + AI generals).
  **Starting armies**: by default they're auto-scattered, but ticking "Place troops manually" runs a
  classic one-at-a-time **draft** (engine `phase:"setup"` + `setupRemaining[pid]` pool; `placeSetupArmy`
  drops one army then passes to the next player with armies left; when all pools empty it `beginTurn(0)`
  into reinforce). Humans click their territories one army at a time; AI players draft via
  `RiskBots.planSetupPlacement` (always heuristic, even when a model is set to play — a per-army model
  call would be far too slow). main.js drives it with `runSetupBots`/`postSetup`.
  **Online multiplayer** (beta, `net/`): an authoritative **match-server** (`net/server.js`, zero-dependency
  — hand-rolled WebSocket + the same `engine.js`/`bots.js` run under Node) holds the one real game per room,
  validates every intent with the engine (illegal/out-of-turn → rejected), rolls all dice, and broadcasts a
  **redacted** snapshot per player (your own hand in full; opponents' as a count; deck withheld). One person
  runs it (`cd net && node server.js`, self-host/tunnel/deploy); friends Create/Join a room by 4-letter code
  from the page's **Play Online** panel. Browser side: `net/client.js` (`window.RiskNet` ws wrapper) + an
  online path in main.js — when `net.online`, `state` is the latest server snapshot, input gates on
  `meActing()` (the current seat is mine), and the turn drivers **send intents** instead of mutating locally;
  `applySnapshot`/`applyEvent` render state + dice. **Hardened** following `ws`/OWASP/RFC-6455 —
  localhost-only bind by default (`HOST=lan` to expose), 64 KB frame cap (close 1009), Origin allowlist
  (anti-CSWSH), per-IP + global connection caps, per-socket rate limit (close 1008), ping/pong heartbeat +
  idle timeout, RFC frame validation, optional `ROOM_PASSWORD`; **no shell/file/eval surface at all**. Full
  writeup in `net/SECURITY.md`. Tests: `net/test-net.js` (two simulated players → create/join/redaction/
  turn-gating/sync; full browser↔server path validated e2e with a real headless browser during dev) and
  `net/test-sec.js` (payload cap, rate-limit flood, safe bind). Supports **reconnection** (per-seat token in
  `start`; `rejoin{code,token}` reclaims a seat; rooms survive drops until idle past `roomTtlMs`; the browser
  auto-reconnects + offers a reconnect button), **spectators** (`join{spectate:true}` → fully-redacted watch-only
  view, can't act), and **AI seats** (host `addAI`/`removeAI` heuristic generals; a paced server-side driver —
  `driveAI`/`aiPlayTurn`, `AI_DELAY_MS` — plays each bot seat's full turn via `bots.js`). For internet
  play the host fronts the local server with a **Cloudflare quick tunnel** — `net/play-online.sh` starts the
  server + tunnel and prints a `wss://…trycloudflare.com` URL to share (free, no account; auto-allows the
  `xenoxanadu.com` origin). Also deployable always-on to Fly.io (~$2/mo) via `net/Dockerfile` + `net/fly.toml`.
  The Play Online address defaults to `ws://localhost:8790` (editable, remembered in localStorage). Still TODO: AI-seat *sponsorship*
  (a player's own Ollama driving a seat over the net, reusing `runModelTurn`); one game per room.
- **minesweeper** — single-player classic (three difficulties, first-click safety, flood fill, flag,
  chord, timer). The differentiator is a **constraint-propagation solver** in `main.js` (single-file
  game): trivial rule (all-mines-accounted → clear / need===size → all mines) + subset (1-2) rule, run
  to a fixpoint, plus a probability fallback for when nothing is certain. It powers two **model-free**
  features that work on the hosted site too — **Hint** (highlight one provably-safe/mined square + a
  written reason) and **Auto-solve** (play every certain move until stuck). A connected local model is a
  pure *enhancement*: it **never chooses a square** (the solver does), it only narrates the deduction in
  plain English, streamed to the think panel — same "engine decides, model narrates" contract as chess.
- **rock-paper-scissors** — classic RPS plus a Lizard-Spock variant (single-file `main.js`). Two opponents:
  a model-free **predictor bot** that beats *patterned* humans by predicting their next throw (recency-weighted
  frequency blended with order-1 & order-2 Markov) and playing the counter, with ~18% random noise so it can't
  be hard-inverted; and **your model**, which reads your throw history, predicts your next move, picks its throw
  and trash-talks the read into the think panel. The model only ever sees your *past* throws (never the current
  one), and an unparseable/failed reply falls back to the predictor bot — same legal-move + fallback contract as
  connect-four. Fully playable offline / on the hosted site (the bot needs no model).
- **sand-falling** — runs the gardener loop **two ways**, auto-selected at load:
  - *Browser-native* (default on the hosted site): the same observe→think→act loop ported into the
    page, driving the user's own model via `XenoBYOM`. `SAND_SYSTEM` in `index.html` mirrors
    `server.js`'s `SYSTEM` prompt so behaviour matches. No server needed.
  - *Bridge* (if `server.js` is reachable on `ws://localhost:8787`): the Node bridge takes over,
    adding persistent per-model stats (`ELEMENT_USAGE.json`), wish logging (`WISHES.jsonl`),
    reflection turns, and Claude models. Run locally with `npm install && node server.js` (env:
    `OLLAMA_URL`, `OLLAMA_MODEL`, `AI_DELAY_MS`, `PORT`). See `sand-falling/AI_PLAYER.md`.
  The page tries the bridge first (~1.5s), then falls back to browser-native. Keep `SAND_SYSTEM`
  and `server.js`'s `SYSTEM` in sync if you edit either.

**Hosted reality**: BYO works on xenoxanadu.com *for visitors who run their own model*, but an
HTTPS page reaching `http://localhost` can be blocked by the browser's Private Network Access
(Chrome/Edge) — `byom.js` detects this and `ai-setup.html` explains the fix (allow the origin in
`OLLAMA_ORIGINS`, use Firefox, or run the arcade locally). sand-falling's *bridge-only* extras
(stats, wishes, Claude) still need the local Node process; the core AI play does not.

`node_modules/` (e.g. under `sand-falling/`) is gitignored and not deployed.

## Model eval & prompt tuning (🧪)

A proof-of-concept for **measuring how well models play and tuning the system prompts** that drive
them. Currently wired into **connect-four only**; the pattern is meant to copy to the other AI
games the way `byom.js` did. Four pieces:

- **`public/lib/eval.js`** (global `window.XenoEval`) — shared, dependency-free data-collection
  layer. Logs one record per model decision to **IndexedDB** (`xeno.eval.v1`) — local only, never
  leaves the machine (there is no server). Schema-free; two conventional `kind`s: `'move'` (a graded
  decision) and `'game'` (a finished game). `newRun`/`log`/`all`/`clear`/`count`, `summary()`
  (aggregates by `game|model|variant` → optimal-rate, blunder-rate, fallback-rate, avg regret/latency,
  win-rate), and `exportJSONL()`/`exportCSV()` (browser downloads).
- **`connect-four/solver.js`** (`window.C4Solver`) — the **ground truth**. Depth-limited negamax
  (alpha-beta, center-first ordering) with EXACT terminal detection; positions past the horizon use a
  classic 4-window heuristic. `analyze(grid,color,{depth})` scores every legal move; `grade(...)`
  labels a move `optimal` / `blunder` (`threw-win` | `into-loss`, only on EXACT decisive flips) with a
  `regret`. Decisive verdicts are exact within depth — which covers real (tactical) blunders. Takes the
  game's own `grid[r][c]` (row 0 = top, `'red'|'blue'|null`).
- **`connect-four/prompts.js`** (`window.C4Prompts`) — the **variants under test**: a registry of
  named system prompts (`v1_baseline` = the shipping prompt, `v2_threat_scan` = forced A/B/C/D threat
  enumeration, `v3_terse` = minimal/low-token). Also owns the shared board-text / legal-column /
  reply-parse helpers so the bench and live game speak the same `COLUMN: n` protocol.
- **`connect-four/bench.js`** — the **headless harness + UI**. Plays the connected model vs the
  solver (which plays optimally) for N games, grading every model move and logging it tagged with the
  prompt variant; renders a live per-variant summary table + CSV/JSONL export. Builds its own panel
  (so `index.html` only loads the four scripts) and **only mounts on a locally-run copy** (`isLocal()`).

To compare prompts: pick a model, run the same N games under each variant, read the `summary()` table
(higher optimal-rate / lower blunder-rate wins). The solver is the reference opponent *and* the grader.

## Commands

```bash
# Play / preview the whole arcade locally
cd public && python3 -m http.server 8000   # http://localhost:8000

# Run sand-falling's optional local AI bridge
cd public/game/sand-falling && npm install && node server.js
```

## Deploy

Push to `main` → `.github/workflows/deploy.yml` publishes `public/` to GitHub Pages.
Keep `public/CNAME` (custom domain) and `public/.nojekyll` intact.
