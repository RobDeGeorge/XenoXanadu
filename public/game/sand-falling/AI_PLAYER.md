# Sand Garden — AI player

Let a **local Ollama model** play the sandbox live while you watch its thoughts.

```
              ┌─────────────┐   WebSocket   ┌──────────────┐   HTTP    ┌────────┐
   you watch  │  index.html │ ◀───────────▶ │  server.js   │ ◀───────▶ │ Ollama │
              │ (the game)  │  observe/act  │ (bridge+loop)│  /api/chat│ (local)│
              └─────────────┘               └──────────────┘           └────────┘
```

The model never touches the grid directly. Each turn the browser sends it a
coarse **44×25 ASCII snapshot** of the board; the model **thinks out loud** and
ends with an `ACTION:` line; the browser **streams that reasoning live** into the
panel token-by-token, then carries out the action — reusing the same
paint/spawn/clear the mouse uses, and **visibly switching the palette selection**
so you watch it pick each tool.

## Run it

1. Make sure **Ollama** is running with a model pulled (`ollama list`).
2. Install the one dependency (first time only) and start the bridge:
   ```
   npm install
   node server.js
   ```
3. Open **http://localhost:8787**, click the **🤖** button in the toolbar to
   open the AI panel, then **▶ Start AI**. Hit **■ Stop AI** any time.

## Config (env vars)

| var            | default               | meaning                                  |
| -------------- | --------------------- | ---------------------------------------- |
| `OLLAMA_MODEL` | `gemma4:12b-it-qat`   | which Ollama model plays                 |
| `OLLAMA_URL`   | `http://localhost:11434` | Ollama endpoint                       |
| `AI_DELAY_MS`  | `1800`                | pause between moves (on top of inference)|
| `PORT`         | `8787`                | bridge port                              |

Example — a smaller, much faster model for snappier play:
```
OLLAMA_MODEL=llama3.2:3b node server.js     # after: ollama pull llama3.2:3b
```

## Notes

- **Speed:** a 12B model thinks ~15–20s per move on CPU/modest GPU, so it plays
  slowly. A 3B model (`llama3.2:3b`, `qwen2.5:3b`) moves every couple seconds.
- The browser auto-reconnects to the bridge every 3s, so you can start
  `node server.js` after the page is already open.
- The model sees the board as ASCII (no vision needed). Glyph legend is in
  `index.html` (`AI_CHAR`) and the system prompt in `server.js`.
- Want Claude/Grok instead of local? The same WebSocket protocol works — swap
  `askModel()` in `server.js` for an Anthropic / OpenAI-compatible call.
