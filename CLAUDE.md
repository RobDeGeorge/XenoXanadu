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
