# XenoXanadu

A growing arcade of **classic games, rebuilt by hand** — chess, connect four, dots & boxes,
pinball, a falling-sand garden, and more. Each one is a self-contained little web game you
can play right in the browser.

**Live:** [xenoxanadu.com](https://xenoxanadu.com)

## Games

| Game | Folder | Notes |
|------|--------|-------|
| Verdelve | `public/game/verdelve/` | Cozy overworld + dungeon delver |
| Neon Tilt | `public/game/pinball/` | Tiny neon pinball |
| Chess | `public/game/chess/` | Full rules: check, mate, castling |
| Connect Four | `public/game/connect-four/` | 🤖 can play vs a local Ollama model |
| Dots & Boxes | `public/game/dots-and-boxes/` | Retro neon pencil-and-paper classic |
| Sand Garden | `public/game/sand-falling/` | Falling-sand sim; optional local-LLM gardener |

## Stack

Pure static site — **no framework, no build step.** Everything that ships lives in `public/`
and is published as-is to GitHub Pages.

```
public/
  index.html        Arcade homepage (the game hub)
  CNAME             Custom domain (xenoxanadu.com)
  .nojekyll
  game/
    <game>/         One self-contained folder per game (index.html + assets)
```

Open `public/index.html` in a browser to play locally, or serve the folder:

```bash
cd public && python3 -m http.server 8000   # then visit http://localhost:8000
```

## Adding a new game

1. Drop a self-contained folder under `public/game/<your-game>/` with an `index.html`.
2. Add a card linking to `game/<your-game>/index.html` in `public/index.html`.
3. Push to `main` — the GitHub Pages workflow publishes `public/` automatically.

## Local-LLM games (🤖)

Some games can play against a model running locally via [Ollama](https://ollama.com):

- **Connect Four** talks to the Ollama HTTP API directly from the browser.
- **Sand Garden** ships an optional Node bridge (`sand-falling/server.js`, run with
  `npm install && node server.js`) that drives an autonomous AI gardener over a WebSocket.

These AI features need a model on the player's own machine, so on the hosted site they
gracefully no-op while the games themselves stay fully playable. Wiring the AI up for the
online version is a future bridge to cross.

## Deploy

Push to `main`; `.github/workflows/deploy.yml` uploads `public/` to GitHub Pages. No build.
