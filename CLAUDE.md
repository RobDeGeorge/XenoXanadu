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
  game/
    verdelve/           Cozy overworld + dungeon delver
    pinball/            "Neon Tilt" — neon pinball
    chess/              Full chess (check, mate, castling) — 🤖 optional local-model opponent
    connect-four/       Connect Four — 🤖 optional local Ollama opponent
    dots-and-boxes/     Retro neon Dots & Boxes — 🤖 optional local-model opponent
    sand-falling/       "Sand Garden" falling-sand sim + optional Node AI bridge
.github/workflows/
  deploy.yml            Uploads public/ to GitHub Pages (no build)
```

## Conventions

- **Each game is self-contained in its own folder** under `public/game/<name>/` with an
  `index.html` entry point. No shared bundler; games don't import from each other.
- Folder names are **kebab-case, no leading underscore** (matches `verdelve`/`pinball`).
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
