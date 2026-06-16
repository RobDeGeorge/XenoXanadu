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
  CNAME                 xenoxanadu.com
  .nojekyll             Serve dotfiles/underscored paths verbatim
  game/
    verdelve/           Cozy overworld + dungeon delver
    pinball/            "Neon Tilt" — neon pinball
    chess/              Full chess (check, mate, castling)
    connect-four/       Connect Four — 🤖 optional local Ollama opponent
    dots-and-boxes/     Retro neon Dots & Boxes
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

Some games can play against a local model via [Ollama](https://ollama.com) (default
`http://localhost:11434`):

- **connect-four** — browser fetches the Ollama API directly.
- **sand-falling** — `server.js` is a Node bridge (HTTP + WebSocket) that runs an autonomous
  Ollama "gardener". Run locally with `npm install && node server.js` (default port 8787;
  env: `OLLAMA_URL`, `OLLAMA_MODEL`, `AI_DELAY_MS`, `PORT`). See `sand-falling/AI_PLAYER.md`.

On the **hosted static site** there is no server and no localhost model, so these AI features
no-op; the games stay fully playable without them. Bringing the AI online (hosted inference or
a deployed bridge) is an open future task — don't assume it works on xenoxanadu.com yet.

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
