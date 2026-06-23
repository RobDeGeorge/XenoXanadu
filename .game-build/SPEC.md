# XenoXanadu — New Game Build Spec (for agents)

You are building ONE new game for the XenoXanadu arcade — a **pure static, hand-built,
no-build-step** site. The contents of `public/` are published as-is to GitHub Pages.
Your job: produce a self-contained game under `public/game/<slug>/` that is
**indistinguishable in style and structure** from the games already shipping.

## ⚠️ READ THE REFERENCE GAMES FIRST
Before writing a line, READ (with the Read tool) the reference file(s) named in your task,
plus this whole spec. Match their idiom, comment density, and structure. The shared infra is:
- `public/lib/arcade.css`   — shared neon "CRT arcade" chrome (control bar, segmented toggles, name
  fields, scoreboard, status line, AI panel). Driven by CSS custom properties.
- `public/lib/byom.js`      — `window.XenoBYOM`: the Bring-Your-Own-Model pipeline (`chat`, `test`,
  `loadConfig`, `isLocal`, …). The visitor runs their own local LLM; nothing hits a server.
- `public/lib/board-ai.js`  — `window.XenoBoardAI.create({...})`: shared turn-based AI controller for
  2-player board games (builds the AI panel, lists models, runs the observe→ask→move loop, parses
  `MOVE: <n>`, falls back to the best legal move). Use this for board games (Pattern A).
- `public/lib/home-button.js` — floating "← Arcade" button. Always include it.
- `public/ai-setup.html`    — the "connect a model" hub. Link to it from your AI panel.

## HARD RULES (every game)
1. **Self-contained folder** `public/game/<slug>/` with `index.html` as the entry point. Single-file
   (everything inline) is the norm; split into `main.js`/`style.css`/etc. ONLY for large games and
   only if a reference you were given does so. Slug is kebab-case, no leading underscore.
2. **Do NOT edit** `public/index.html`, `public/CLAUDE.md`, or any other game's folder. The
   orchestrator adds the homepage card and docs. Touch only your own folder.
3. **`<head>` order, exactly like the references:**
   - the usual `<meta charset>`, viewport, a real `<title>` and `<meta name="description">`.
   - the **pre-paint "hosted" guard** verbatim:
     ```html
     <script>try{var h=location.hostname;if(!(location.protocol==='file:'||/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])$/i.test(h)||/\.local$/i.test(h)))document.documentElement.className+=' hosted';}catch(e){}</script>
     ```
   - `<link rel="stylesheet" href="../../lib/arcade.css" />`, then your own `<style>` (or `style.css`)
     holding ONLY your palette (`:root`) + board/board-piece rules. Reuse arcade.css classes
     (`.wrap .controls .field .seg .seg-btn #newGame .names .name-field .scoreboard .score-card
     .status .winner-banner .xeno-ai`) for all shared chrome — do not re-style them.
4. **Scripts at the END of `<body>`, in this order:**
   ```html
   <script src="../../lib/byom.js"></script>
   <!-- Pattern A board games only: --> <script src="../../lib/board-ai.js"></script>
   <script> /* your inline game */ </script>   <!-- or <script src="main.js"></script> -->
   <script src="../../lib/home-button.js"></script>
   ```
5. **Fully playable OFFLINE / on the hosted public site WITHOUT any model.** The hosted site is
   arcade-only: a public HTTPS page can't reach a visitor's localhost model. So every game MUST ship
   a built-in opponent / solver / bot in plain JS. **The local LLM is always an *enhancement*, never
   required.** Anything model-related lives inside `class="ai-only"` containers (hidden on the hosted
   site by `html.hosted .ai-only{display:none}`) and is gated at runtime by `XenoBYOM.isLocal()`.
6. **The model can never break the rules.** The engine computes what's legal; the model only *picks
   from* a legal list (board games) or only *narrates* a decision the engine already made (solver
   games). Any unparseable/failed model reply falls back to the built-in logic. Never let raw model
   output mutate game state.
7. **Aesthetic:** neon-on-dark, monospace, uppercase letter-spaced headings, the `h1` triple-shadow
   treatment, CRT scanlines (already in arcade.css). Pick a small distinct palette in `:root`
   following the `--bg/--bg-2/--panel/--panel-2/--grid/--line/--text/--muted/--accent/--mono` knobs
   that arcade.css expects, plus `--on-accent/--seg-bg/--seg-active-bg/--ai-on/--ai-err/--wrap-max`.
8. **Quality bar:** the game must actually be fully playable and correct — real rules, win/lose/draw
   detection, new-game reset, responsive board, no console errors. Verify your JavaScript parses.

## PATTERN A — turn-based board game (use `board-ai.js`)
For 2-player perfect-information games. Reference: `public/game/othello/index.html` (study it fully).
- Engine enumerates **every legal move**; the human clicks one; the AI/model picks one from the SAME
  ranked list. Wire it with `XenoBoardAI.create({ mount, oppSeg, defaultSeat, temperature, maxTokens,
  seats, seatName, current, gameOver, rankedMoves, buildMessages, parseMove, applyMove, moveLabel,
  describeMove, repaint, hintText, thinkPlaceholder })`. See the `board-ai.js` header for the contract.
- Markup needs: an Opponent segmented toggle (`<div class="seg" id="...OppSeg">` Humans / vs AI,
  inside a `.field.ai-only`), an empty `<div class="ai-only" id="...Ai"></div>` mount, `.names`,
  `.scoreboard`, `.status`, the board, `.winner-banner`.
- `buildMessages()` returns `{messages, ranked}` where `ranked` aligns with the numbered list you put
  in the prompt; the model replies `MOVE: <number>`; `parseMove` reads it; bad reply → `ranked[0]`.
- **Also ship a strong built-in heuristic AI** (minimax / influence / threat-scan as fits the game) so
  the "vs AI" mode is fully playable with NO model — the model is the optional upgrade. If the game
  wants a difficulty slider, the heuristic provides it.
- `startGame()` calls your `...OnNewGame()` shim → `aiCtl.newGame()`. At the end:
  `startGame(); if (XenoBYOM.isLocal()) aiCtl.start();`

## PATTERN B — custom AI wired straight to `XenoBYOM.chat`
For single-player / real-time / card games where `board-ai.js` doesn't fit. You build a small AI panel
yourself using the existing `.xeno-ai` classes (copy the panel markup + model-loading code from a
reference). Two sub-flavours:

**B1 — "engine decides, model narrates"** (Sudoku, Mahjong, Mastermind-as-solver).
Reference: `public/game/minesweeper/index.html` + `public/game/minesweeper/main.js` (study fully).
- A built-in solver/logic engine does the real work (generate puzzle, find the next deduction, detect
  stuck, rate difficulty, suggest a pair, etc.) and **works completely offline**.
- A connected model ONLY narrates that deduction in plain English, streamed to a `.ai-think` panel via
  `XenoBYOM.chat({ messages, onToken, onThinking, signal })`. It never chooses the move/square/tile.
- Panel markup: `<div class="xeno-ai ai-only" id="aiPanel">` with `.ai-model` select, `↻` refresh,
  `.ai-endpoint` input, `.ai-statusline` (`.ai-dot`+status), a `.ai-think` stream area, and a
  `.ai-hint` footer linking `../../ai-setup.html`. Copy minesweeper's `loadModels()` / status / gating
  (`aiUsable() = BYOM.isLocal() && modelReady && defaultModel`). On the hosted site, show a line like
  "Public site — runs offline; run locally to add model narration."

**B2 — "built-in bot offline + optional model rival/persona"** (Pong, Blackjack, Dominion).
Reference: `public/game/rock-paper-scissors/index.html` + `main.js`; for card/multi-seat games also
`public/game/texas-holdem/` (engine.js/personalities.js/main.js split + persona prompts).
- A real heuristic bot/dealer/opponent plays fully offline. A connected model optionally takes over
  (with persona/trash-talk/coaching streamed to `.ai-think`), and ANY bad/failed reply falls straight
  back to the built-in bot. The model only ever picks from legal actions / never sees hidden info it
  shouldn't (e.g. RPS model sees only your PAST throws).

## Model prompt conventions (shared by all patterns)
- Reasoning-model detection: `var aiIsReasoning = function (m){ return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m||''); };`
  give reasoning models a higher `maxTokens` (e.g. 2048) and others ~500–700.
- temperature ~0.3–0.5 for move-picking, a bit higher for persona/banter.
- System prompt: state the role, the rules-in-brief, the strict reply format, and "pick exactly one by
  NUMBER from the list" (board games) ending with `MOVE: <number>` on the final line. Keep it tight.
- Stream tokens to the think panel with a generation guard (`if (g === gen) ...`) so an aborted turn's
  tokens don't bleed into the next, exactly like the references.

## Self-check before you finish
- [ ] Folder `public/game/<slug>/` with `index.html`; nothing else edited.
- [ ] head guard + arcade.css link + (board-ai for Pattern A) + home-button.js, in the right order.
- [ ] Plays fully OFFLINE with the built-in AI/solver; every model bit is `ai-only` + `isLocal()`-gated.
- [ ] Real rules, win/draw/lose + New Game reset; resizes sanely on mobile.
- [ ] The model can only pick-from-legal / narrate; bad reply falls back. No raw model output mutates state.
- [ ] JavaScript parses with no syntax errors (extract the inline script and `node --check` it).
- [ ] Matches the neon/monospace look of the reference games.
</content>
</invoke>
