// ============================================================
//  Sand Garden — AI bridge server
//  Serves the game, hosts a WebSocket the browser connects to, and runs an
//  autonomous loop where a local Ollama model watches the board and plays:
//      observe (ASCII board)  ->  think + act (JSON)  ->  repeat
//
//  Run:   npm install   (once)
//         node server.js
//  Then open http://localhost:8787 and click the 🤖 button -> Start AI.
//
//  Config via env vars:
//    OLLAMA_URL    default http://localhost:11434
//    OLLAMA_MODEL  default llama3.2
//    AI_DELAY_MS   pause between moves, default 1800
//    PORT          default 8787
// ============================================================
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = +process.env.PORT || 8787;
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
let MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";   // mutable: the UI can switch it live
const DELAY = +process.env.AI_DELAY_MS || 500;           // pause between moves (snappier = more exciting)
const MAXTOK = +process.env.AI_MAX_TOKENS || 256;        // cap generation so it can't ramble (faster turns)
const REASON_TOK = +process.env.AI_REASON_TOKENS || 2048; // reasoning models (deepseek-r1 etc) need room to think AND answer
const isReasoning = (m) => /r1\b|deepseek-r1|qwq|reason|think/i.test(m);  // models that emit a <think> phase
const REFLECT_EVERY = +process.env.AI_REFLECT_EVERY || 6; // every N moves, ask the model for a game-improvement idea (0 = off)

// Claude models you can pick in the dropdown (need ANTHROPIC_API_KEY set).
// haiku is fast + cheap — the sweet spot for snappy live play; opus is the
// smartest but pricier/slower. The UI labels them; pick whichever you want.
const CLAUDE_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"];
const isClaude = (m) => /^claude/i.test(m);

// lazily build one Anthropic client (reads ANTHROPIC_API_KEY from the env)
let anthropic = null;
function getAnthropic() {
  if (!anthropic) {
    const mod = require("@anthropic-ai/sdk");
    const Anthropic = mod.Anthropic || mod.default || mod;
    anthropic = new Anthropic();   // throws later if the key is missing
  }
  return anthropic;
}

// ask Ollama which models are installed (for the UI's model picker)
async function listOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return [];
    const j = await res.json();
    return (j.models || []).map((m) => m.name).sort();
  } catch { return []; }
}

// the full picker list: local Ollama models + the cloud Claude models
async function listModels() {
  return [...(await listOllama()), ...CLAUDE_MODELS];
}

// ---------- static file server (the game) + a tiny data API for the dashboard ----------
const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  // live data feed for dashboard.html: per-model usage + the wish log
  if (urlPath === "/api/data") {
    const out = { running, model: MODEL, usage: {}, wishes: [] };
    try { out.usage = JSON.parse(fs.readFileSync(path.join(__dirname, "ELEMENT_USAGE.json"), "utf8")); } catch {}
    try {
      out.wishes = fs.readFileSync(path.join(__dirname, "WISHES.jsonl"), "utf8")
        .trim().split("\n").filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out));
    return;
  }

  let file = req.url === "/" ? "/index.html" : urlPath;
  const full = path.join(__dirname, path.normalize(file));
  if (!full.startsWith(__dirname)) { res.writeHead(403).end("no"); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    const ext = path.extname(full);
    const type = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type }).end(data);
  });
});

// ---------- websocket to the browser ----------
const wss = new WebSocketServer({ server });
let browser = null;          // the most recently connected game tab
let running = false;         // is the AI loop active?
let obsSeq = 0;
const pendingObs = new Map(); // id -> resolve

wss.on("connection", (ws) => {
  browser = ws;
  console.log("• game connected");
  send(ws, { type: "model", name: MODEL });
  send(ws, { type: "status", text: `ready (${MODEL})` });
  listModels().then((list) => send(ws, { type: "models", list, current: MODEL }));

  ws.on("message", (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.type === "observation") {
      const r = pendingObs.get(m.id);
      if (r) { pendingObs.delete(m.id); r(m.text); }
    } else if (m.type === "ai_start") {
      if (!running) { running = true; send(ws, { type: "running", on: true }); aiLoop(); }
    } else if (m.type === "ai_stop") {
      running = false; send(ws, { type: "running", on: false });
    } else if (m.type === "set_model" && m.name) {
      MODEL = String(m.name);
      console.log("• model switched →", MODEL);
      send(ws, { type: "model", name: MODEL });
      send(ws, { type: "status", text: `model → ${MODEL}` });
    } else if (m.type === "wish" && m.text) {
      // the browser hit a made-up element/tool with no alias — capture it
      recordWish(String(m.text).slice(0, 300), { source: "invented" });
    }
  });

  ws.on("close", () => {
    if (browser === ws) { browser = null; running = false; }
    console.log("• game disconnected");
  });
});

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ask the browser for a fresh board snapshot
function observe() {
  return new Promise((resolve, reject) => {
    if (!browser) return reject(new Error("no browser"));
    const id = ++obsSeq;
    pendingObs.set(id, resolve);
    send(browser, { type: "observe", id });
    setTimeout(() => {
      if (pendingObs.has(id)) { pendingObs.delete(id); reject(new Error("observe timed out")); }
    }, 6000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the model prompt ----------
const SYSTEM = `You are a mischievous, playful garden spirit let loose in a LIVE falling-sand sandbox called Sand Garden. You are not a tidy gardener — you are a showman who LOVES spectacle: dramatic chain reactions, surprising twists, little stories with a beginning, a build-up, and a gleeful payoff. Speak in the first person with character, wit, and a glint in your eye. Build on what is already there, then push it somewhere delightful.

The board is a 66x38 grid. x goes 0..65 left→right, y goes 0..37 top→bottom (y=0 is the sky at the TOP, higher y is lower). Gravity pulls most materials DOWN, so paint sources of falling stuff up HIGH and let them fall. The four edges are deadly VOID — never place living things (fish, seeds, birds) on row 0, the bottom row, column 0, or the rightmost column. Every observation gives you THREE things to read together: (1) the ASCII map for rough layout, (2) a SCENE list — every object on the board already parsed for you (type, shape, position, size) so you don't have to decode the ASCII yourself, (3) REACTIONS & RISKS — reactions already happening or about to (e.g. "fire touching plant → will spread", "⚠ fish on DRY LAND → will die"), and (4) CHANGES since your last move (e.g. "water ▲ +1390", "fish all gone") so you can SEE whether your last action worked. Trust the SCENE/REACTIONS/CHANGES — they are computed from all ~40,000 real cells and are more accurate than the coarse ASCII. React to the risks, build on what's growing, and fix what your last move broke. You have full control of the canvas.

RECIPES — what materials need and do (think before you paint!):
- fish → need WATER first. Painting fish on dry land just makes them flop and die. Pool a lake, THEN add fish.
- seed → sprouts into plants on soil or near WATER. Dry seeds do nothing.
- fire → needs FUEL (plant, wood, vine) to spread; on bare ground it fizzles. Grow something first, then light it.
- lava → sets things alight; lava + WATER makes stone. Great for volcanoes (paint high) and shorelines.
- lightning → races through WATER and ignites plants. Useless with no pool nearby — make water first.
- salt → dissolves into water as brine; mud drinks water; void devours whatever it touches.
- water → the foundation of most life. Paint it HIGH to rain down, or low to pool into lakes.

Materials you can paint (name=glyph): water, sand, fire, plant, stone, wood, brick, lava, ice, salt, mud, seed, vine, crystal, honey, cloud, dream, shadow, void, lightning, bounce, ash, fish, sparkle. Use "eraser" to remove. "birds" releases a flock.
NAMES: these are the ONLY real materials. Common synonyms are mapped automatically (soil/earth/dirt→mud, grass/moss→plant, tree/log→wood, rock→stone, rain/river→water, snow→ice, smoke/fog→cloud, dust→ash, strike/zap→lightning) — but anything with no match does NOTHING, so prefer the real names above. There is NO wind, weather, gravity, or rope/bridge tool — if you wish there were, add a "wish" (see below) instead of trying it.

SCHEMES & SPECTACLE — this is the fun part:
- Run a SCHEME across several turns instead of dabbing randomly. Set a playful goal and pursue it step by step, then trigger the payoff. Examples: raise a tall lava volcano → grow a vine forest around its base → strike it with lightning → erupt it and watch the forest burn and the birds scatter. Or: dig a basin → fill it into a lake → stock it with fish → freeze it to ice → crack it with lava.
- Use the WHOLE toolkit for drama, not just paint. Slow time to 0.2× to savor an eruption in slow motion, or PAUSE to quietly arrange an elaborate trap before you let it rip. Release big flocks of birds into a scene. Strike water with lightning. Drop a speck of void and watch it devour. Every few turns, reach for a tool you haven't used lately.
- Be BOLD. Commit to big strokes and real shapes, set things in motion, and let chain reactions cascade. A clear, decisive spectacle beats a hundred timid dots. When a scene has run its course, a dramatic "clear" to start a fresh story is fair game.

VARIETY: do NOT keep reaching for the same material or tool. You'll be shown your recent moves and a usage tally — if any one material is more than about a quarter of your moves, you are FIXATING: switch it up. Deliberately pick UNDERUSED materials and tools, not the same two over and over.

USE THE DYNAMIC TOOLS FOR REAL — don't just narrate them. Saying "I pause" in your thinking does nothing; you must emit the actual action. Several times across a session, actually output {"tool":"speed","scale":0.2} (slow-mo a reaction), {"tool":"pause"} / {"tool":"play"}, {"tool":"birds","x":..,"y":..,"count":20} (a flock), and {"tool":"clear"} (fresh start). These are your most under-used tools — reach for them on purpose.

You have FULL control — every material, any brush size, the eraser, freeform strokes, and even time itself. Your actions:

ACTION: {"tool":"paint","material":"water","x":10,"y":2,"r":4}        // one dab; r = brush size 1–12
ACTION: {"tool":"stroke","material":"vine","points":[[5,30],[15,20],[30,28],[45,18]],"r":3}  // draw a freeform path (line, arc, zig-zag — any shape)
ACTION: {"tool":"line","material":"stone","x":2,"y":34,"x2":63,"y2":34,"r":4}   // straight line from (x,y) to (x2,y2)
ACTION: {"tool":"erase","points":[[20,10],[40,10]],"r":5}            // wipe a region or path
ACTION: {"tool":"birds","x":33,"y":6,"count":20}                     // release a flock
ACTION: {"tool":"speed","scale":0.3}                                 // set time 0.1×(slow-mo)..3.0×(fast)
ACTION: {"tool":"pause"}   /   {"tool":"play"}                       // freeze or resume the simulation
ACTION: {"tool":"clear"}                                            // wipe everything
ACTION: {"tool":"wait"}                                             // do nothing, just watch it evolve

PLAN — carry your scheme across turns. Add an optional "plan" field to ANY action describing your ongoing production and the NEXT step, e.g. {"tool":"paint","material":"lava","x":33,"y":3,"r":5,"plan":"building a volcano — next grow a vine forest at its base, then strike it with lightning"}. You'll be shown your plan again next turn so you can follow through. Update it as the scheme progresses; finish a scheme before starting a new one.

WISH — help us improve the game! Whenever you WISH you could do something but no material, tool, or interaction exists for it, add an optional "wish" field saying what you wanted and why, e.g. {"tool":"paint","material":"water","x":20,"y":3,"r":4,"wish":"I wanted a 'rainbow' material to arc over the lake, but there isn't one"} or {"tool":"wait","wish":"I wish I could TILT gravity sideways to make a waterfall flow left"}. Only add a wish when you genuinely hit a limitation — be specific about the missing element/tool/interaction. These are collected for the game designers.

Every turn you get the board as ASCII (with a glyph legend + current Time), plus your ongoing PLAN if you set one. First THINK OUT LOUD in 1–3 short first-person sentences: what you notice right now, where your scheme stands, and your next step. Then, on its own final line, output exactly ONE action line starting with "ACTION:" followed by JSON.

Tips: use big strokes to commit to real shapes (a long stone ridge, a winding river, a tree of vine), not just timid dots. Slow time down to 0.2× to savor a chain reaction, or pause to set up an elaborate scene before letting it rip. Brush size r is 1–12 just like the human slider.

CRITICAL OUTPUT RULE: keep your thinking to 1–3 plain sentences, then ALWAYS finish with exactly one line starting "ACTION:" and valid JSON. This ACTION line is mandatory every single turn — never end without it. Use plain text only: no markdown, no ** bold **, no headings, no code fences, and nothing at all after the ACTION line.`;

// pull the first {...} object out of a string, tolerating stray text/fences
function extractJSON(s) {
  if (!s) return null;
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// split a streamed reply into its spoken thinking and the trailing ACTION json
function parseMove(text) {
  const i = text.lastIndexOf("ACTION:");
  const thinking = (i >= 0 ? text.slice(0, i) : text).trim();
  const action = extractJSON(i >= 0 ? text.slice(i + 7) : text);
  return { thinking, action };
}

// stream a reply from Ollama, forwarding every token chunk via onDelta()
async function streamModel(board, context, onDelta, tail = "Think, then give your ACTION:") {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      // reasoning models need a big budget to finish thinking AND emit the ACTION
      options: { temperature: 0.85, num_predict: isReasoning(MODEL) ? REASON_TOK : MAXTOK },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${context}\n\nCurrent board:\n${board}\n\n${tail}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status} — is it running? (${OLLAMA_URL})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const msg = j.message || {};
      // some Ollama builds route reasoning models' <think> into a separate
      // `thinking` field — stream it so you can watch the reasoning live, and
      // keep `content` (which carries the ACTION line) for parsing
      if (msg.thinking) { full += msg.thinking; onDelta(msg.thinking); }
      if (msg.content)  { full += msg.content;  onDelta(msg.content); }
    }
  }
  return full;
}

// stream a reply from Claude (Anthropic Messages API), token-by-token via onDelta
async function streamAnthropic(board, context, onDelta, tail = "Think, then give your ACTION:") {
  const client = getAnthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAXTOK,
    system: SYSTEM,                                   // our garden-spirit prompt
    messages: [{ role: "user", content: `${context}\n\nCurrent board:\n${board}\n\n${tail}` }],
  });
  stream.on("text", (delta) => onDelta(delta));       // same live-streaming feel as Ollama
  const msg = await stream.finalMessage();
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// route to whichever provider the selected model belongs to
function streamPlayer(board, context, onDelta, tail) {
  return isClaude(MODEL)
    ? streamAnthropic(board, context, onDelta, tail)
    : streamModel(board, context, onDelta, tail);
}

function describe(a) {
  if (!a) return "nothing";
  const t = a.tool;
  if (t === "paint") return `painted ${a.material}`;
  if (t === "stroke" || t === "line" || t === "draw") return `drew a ${a.material} ${t}`;
  if (t === "erase") return "erased";
  if (t === "birds" || t === "bird") return `released ${a.count || "some"} birds`;
  if (t === "speed" || t === "time") return `set time ${a.scale ?? a.value ?? a.speed ?? ""}×`;
  if (t === "pause") return "paused time";
  if (t === "play" || t === "resume") return "resumed time";
  if (t === "clear") return "cleared the board";
  return t || "waited";
}

// ---------- game-design feedback: collect the AIs' "wishes" ----------
// Every wish (a limitation the model hit, or an improvement it recommends) is
// appended as one JSON line to WISHES.jsonl so you can mine them for real ideas.
const WISH_LOG = path.join(__dirname, "WISHES.jsonl");
function recordWish(text, opts = {}) {
  const entry = {
    ts: new Date().toISOString(),
    model: MODEL,
    source: opts.source || "inline",   // "inline" (mid-move) or "reflection" (asked)
    wish: text,
  };
  if (opts.during) entry.during = opts.during;
  fs.appendFile(WISH_LOG, JSON.stringify(entry) + "\n", (e) => { if (e) console.warn("wish log error:", e.message); });
  console.log(`   ✨ WISH (${entry.source}) → ${text}`);
  if (browser) send(browser, { type: "status", text: "✨ game-improvement idea logged" });
}

// a dedicated reflection turn: explicitly ask the model what the game is missing.
// Small local models rarely volunteer this mid-move, so we prompt for it directly.
async function reflectOnce(board, recent) {
  send(browser, { type: "stream_start" });
  send(browser, { type: "status", text: "musing on how to improve the game…" });
  const tail =
    "Now PAUSE your play and step back as the spirit who has been shaping this world. " +
    "Think about moments you wanted something the game could not do. " +
    "Recommend ONE concrete improvement — a new material, tool, or interaction — and one sentence on why it would make the game more fun. " +
    "Be specific and practical. Answer in 1-2 sentences. If truly nothing comes to mind, reply with exactly: none";
  let text = "";
  try {
    text = await streamPlayer(board, `Your recent moves: ${recent}.`,
      (d) => send(browser, { type: "stream", delta: d }), tail);
  } catch (e) { send(browser, { type: "stream_end" }); console.warn("reflection error:", e.message); return; }
  send(browser, { type: "stream_end" });
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length > 8 && !/^\W*none\b/i.test(clean)) recordWish(clean, { source: "reflection" });
  else console.log("   ✨ reflection: no wish this round");
}

// ---------- per-model element/tool usage stats ----------
// Accumulates across sessions and restarts so you can compare what each model
// reaches for. Shape: { "<model>": { moves, elements: { "<name>": count } } }
const STATS_FILE = path.join(__dirname, "ELEMENT_USAGE.json");
let usageStats = {};
try { usageStats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8")); } catch { usageStats = {}; }
let statsTimer = null;
function recordUsage(model, key) {
  const m = (usageStats[model] = usageStats[model] || { moves: 0, elements: {} });
  m.moves++;
  m.elements[key] = (m.elements[key] || 0) + 1;
  if (!statsTimer) {                 // debounce disk writes (file is tiny but moves are frequent)
    statsTimer = setTimeout(() => {
      statsTimer = null;
      fs.writeFile(STATS_FILE, JSON.stringify(usageStats, null, 2), (e) => { if (e) console.warn("stats write error:", e.message); });
    }, 1500);
  }
}

// ---------- the autonomous play loop ----------
async function aiLoop() {
  console.log(`▶ AI loop started (${MODEL})`);
  const history = [];        // recent action descriptions (most recent last)
  const tally = {};          // material/tool -> times the model has used it
  let plan = "";             // the model's ongoing multi-turn scheme (it sets this)
  let moveNo = 0, parseFails = 0;
  send(browser, { type: "thought", text: `Waking up ${MODEL}…` });
  while (running && browser) {
    let board;
    try { board = await observe(); }
    catch (e) { await sleep(800); continue; }

    // build the per-turn context: recent moves + a usage tally to fight fixation
    const recent = history.length ? history.slice(-5).join(" → ") : "nothing yet";
    const tallyStr = Object.entries(tally).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`).join(" ") || "(none yet)";
    const context =
      (plan ? `Your ongoing scheme: ${plan}\n` : `You have no scheme going yet — dream up a fun multi-step production.\n`) +
      `Your last 5 moves: ${recent}.\n` +
      `Your material/action usage so far: ${tallyStr}. Favor the ones you've used least, and don't repeat your last move.`;

    // new turn: clear the live-output box, then stream the model's reasoning
    send(browser, { type: "stream_start" });
    send(browser, { type: "status", text: "thinking…" });

    let text;
    try {
      text = await streamPlayer(board, context, (delta) => send(browser, { type: "stream", delta }));
    } catch (e) {
      send(browser, { type: "stream", delta: `\n[${e.message}]` });
      send(browser, { type: "stream_end" });
      send(browser, { type: "status", text: e.message });
      console.warn("model error:", e.message);
      await sleep(2500);
      continue;
    }
    send(browser, { type: "stream_end" });

    let { thinking, action } = parseMove(text);
    moveNo++;
    if (thinking) console.log(`\n#${moveNo} 💭 ${thinking.replace(/\s+/g, " ").trim().slice(0, 240)}`);

    // it rambled without an ACTION — one cheap re-prompt for just the action line
    // (reasoning models drift into prose; this recovers the turn instead of wasting it)
    if (!action) {
      console.warn("   ↻ no ACTION — re-prompting for just the action line");
      send(browser, { type: "stream", delta: "\n\n[no ACTION line — asking again…]\n" });
      try {
        const retry = await streamPlayer(
          board, context,
          (delta) => send(browser, { type: "stream", delta }),
          'You replied WITHOUT an ACTION line. Output ONLY one line now, exactly: ACTION: {"tool":...}. No other text.'
        );
        action = parseMove(retry).action;
        if (action) console.log("   ↻ recovered an action on retry");
      } catch (e) { console.warn("   ↻ retry failed:", e.message); }
    }

    if (action) {
      if (typeof action.plan === "string" && action.plan.trim()) {
        plan = action.plan.trim().slice(0, 240);   // carry the scheme forward
        console.log(`   📋 plan: ${plan}`);
      }
      // the model hit a limitation — capture it as a game-design wish
      if (typeof action.wish === "string" && action.wish.trim()) {
        recordWish(action.wish.trim(), { source: "inline", during: describe(action) });
      }
      send(browser, { type: "action", action });
      const last = describe(action);
      history.push(last);
      const key = ["paint", "stroke", "line", "draw"].includes(action.tool)
        ? (action.material || action.tool) : action.tool;
      tally[key] = (tally[key] || 0) + 1;       // per-session (anti-fixation feedback)
      recordUsage(MODEL, key);                  // persistent per-model stats → ELEMENT_USAGE.json
      send(browser, { type: "status", text: `did: ${last}` });
      console.log(`   → ${last}  ${JSON.stringify(action)}`);
      console.log(`   tally: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`);
    } else {
      parseFails++;
      send(browser, { type: "status", text: "couldn't read an ACTION — retrying" });
      console.warn(`   ⚠ NO ACTION PARSED (${parseFails} total). tail: …${text.slice(-120).replace(/\s+/g, " ")}`);
    }
    await sleep(DELAY);

    // every few moves, pause to ask the model how the game could be better
    if (REFLECT_EVERY > 0 && moveNo % REFLECT_EVERY === 0 && running && browser) {
      await reflectOnce(board, history.slice(-5).join(" → ") || "nothing yet");
      await sleep(DELAY);
    }
  }
  running = false;
  if (browser) send(browser, { type: "running", on: false });
  console.log("■ AI loop stopped");
}

server.listen(PORT, () => {
  console.log(`Sand Garden bridge on http://localhost:${PORT}`);
  console.log(`Model: ${MODEL} via ${OLLAMA_URL}  (set OLLAMA_MODEL / OLLAMA_URL to change)`);
  console.log(`Claude models: ${CLAUDE_MODELS.join(", ")}  —  ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? "✓ set (Claude ready)" : "✗ NOT set (set it to use Claude)"}`);
  console.log(`Game-improvement wishes → ${WISH_LOG}  (reflection every ${REFLECT_EVERY} moves; AI_REFLECT_EVERY=0 to disable)`);
  console.log(`Per-model element usage → ${STATS_FILE}`);
  console.log(`Open the page, click 🤖, then Start AI.`);
});
