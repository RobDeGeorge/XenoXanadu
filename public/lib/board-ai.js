/* XenoXanadu — shared Bring-Your-Own-Model controller for turn-based board games.
 *
 *     <script src="../../lib/byom.js"></script>      <!-- required: window.XenoBYOM -->
 *     <script src="../../lib/board-ai.js"></script>  <!-- this file: window.XenoBoardAI -->
 *
 * Every AI game (tic-tac-toe, othello, connect-four, dots-and-boxes, …) repeated the
 * same ~200 lines: build the AI panel, list installed models, drive the observe→ask→
 * move loop with abort/generation guards, parse the reply, fall back on a bad reply.
 * That lives here once. A game supplies only its *rules-specific* hooks.
 *
 * Contract — the model only ever chooses from a numbered list of LEGAL moves the game
 * computes, so it can never play illegally; an unreadable reply falls back to the
 * highest-ranked legal move.
 *
 * Usage:
 *   const ai = XenoBoardAI.create({
 *     mount:   document.getElementById("aiPanel"),  // a <div class="xeno-ai ai-only">
 *     oppSeg:  document.getElementById("oppSeg"),   // .seg with .seg-btn[data-opp="humans|ai"]
 *     hintText: "…html shown under the panel…",
 *     defaultSeat: 1,
 *     temperature: 0.3,
 *     maxTokens: 500,                               // non-reasoning cap; reasoning models get 2048
 *     seats:       () => [{value:0,label:"Player X (✕, first)"}, {value:1,label:"Player O (◯)"}],
 *     seatName:    (seat) => names()[seat],
 *     current:     () => current,                   // whose turn (compared === aiSeat)
 *     gameOver:    () => gameOver,
 *     rankedMoves: () => […],                       // legal moves, best first
 *     buildMessages: () => ({messages, ranked}),    // ranked aligns with the numbered prompt
 *     parseMove:   (reply, ranked) => move | null,
 *     moveStale:   (move) => bool,                  // optional: move no longer legal?
 *     applyMove:   (move) => {…},                   // commit the move to the game
 *     moveLabel:   (move) => "center",              // for the fallback note
 *     describeMove:(move) => "played center — for the win!",
 *     repaint:     () => paint(),                   // optional: clear human hints etc.
 *   });
 *
 *   // wire into the game:
 *   ai.isAITurn()        // gate human input / hint rendering
 *   ai.notify()          // call after every turn change (was maybeAIMove)
 *   ai.newGame()         // call from startGame (was xxxOnNewGame)
 *   ai.rebuildSeats()    // call when player names change
 *   if (XenoBYOM.isLocal()) ai.start();   // load models on a local page
 */
(function () {
  "use strict";

  var PANEL_HTML =
    '<div class="ai-row ai-seat-row"><span class="ai-label">AI plays</span><select class="ai-seat"></select></div>' +
    '<div class="ai-row"><span class="ai-label">Model</span>' +
      '<select class="ai-model"><option>loading…</option></select>' +
      '<button class="ai-refresh" title="Re-scan for installed models">↻</button></div>' +
    '<div class="ai-row"><span class="ai-label">Endpoint</span>' +
      '<input type="text" class="ai-endpoint" value="http://localhost:11434" /></div>' +
    '<div class="ai-statusline"><span class="ai-dot"></span><span class="ai-status">Humans only</span></div>' +
    '<div class="ai-think"></div>' +
    '<div class="ai-hint"></div>';

  var isReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss/i.test(m || ""); };
  var FAV_RE = /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i;

  function create(cfg) {
    if (!window.XenoBYOM) throw new Error("XenoBoardAI requires lib/byom.js (window.XenoBYOM)");

    // ---- build the panel markup, then grab the controls inside it ----
    var mount = cfg.mount;
    mount.classList.add("xeno-ai", "hide-seat");
    mount.innerHTML = PANEL_HTML;
    var seatSel   = mount.querySelector(".ai-seat");
    var modelSel  = mount.querySelector(".ai-model");
    var endpointI = mount.querySelector(".ai-endpoint");
    var refreshB  = mount.querySelector(".ai-refresh");
    var statusEl  = mount.querySelector(".ai-status");
    var dotEl     = mount.querySelector(".ai-dot");
    var thinkEl   = mount.querySelector(".ai-think");
    var hintEl    = mount.querySelector(".ai-hint");
    var oppSeg    = cfg.oppSeg;

    thinkEl.textContent = cfg.thinkPlaceholder || "The AI's reasoning streams here as it picks a move…";
    hintEl.innerHTML = cfg.hintText || "";

    // ---- state ----
    var aiMode = "humans";                 // 'humans' | 'ai'
    var aiSeat = cfg.defaultSeat || 0;
    var aiBusy = false, aiGen = 0, aiController = null;

    function endpointBase() { return (endpointI.value || XenoBYOM.DEFAULT_ENDPOINT).replace(/\/$/, ""); }
    function isAITurn() { return aiMode === "ai" && !cfg.gameOver() && cfg.current() === aiSeat; }
    function setStatus(text, state) { statusEl.textContent = text; dotEl.className = "ai-dot" + (state ? " " + state : ""); }
    function interrupt() {
      aiGen++;
      if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; }
      aiBusy = false;
    }
    function repaint() { if (cfg.repaint && !cfg.gameOver()) cfg.repaint(); }

    // ---- the turn loop ----
    function notify() {
      if (!isAITurn() || aiBusy) return;
      if (!XenoBYOM.isLocal()) return;
      if (!modelSel.value || modelSel.disabled) {
        setStatus("No model — pull one (e.g. ollama pull llama3.2:3b) and hit ↻", "err");
        return;
      }
      if (cfg.repaint) cfg.repaint();   // drop human hover hints while the AI is on the clock
      setTimeout(doAIMove, 300);
    }

    async function doAIMove() {
      if (!isAITurn() || aiBusy) return;
      var myGen = ++aiGen;
      aiBusy = true;
      var me = cfg.seatName(aiSeat);
      setStatus(me + " (" + modelSel.value + ") thinking…", "on");
      thinkEl.textContent = "";

      var built = cfg.buildMessages();
      var ranked = built.ranked;
      aiController = new AbortController();
      var reply = "";
      var stream = function (d) { if (myGen === aiGen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } };
      try {
        reply = await XenoBYOM.chat({
          endpoint: endpointBase(),
          model: modelSel.value,
          messages: built.messages,
          temperature: cfg.temperature != null ? cfg.temperature : 0.3,
          maxTokens: isReasoning(modelSel.value) ? 2048 : (cfg.maxTokens || 500),
          onToken: stream,
          onThinking: stream,
          signal: aiController.signal,
        });
      } catch (e) {
        if (myGen !== aiGen) return;
        aiBusy = false; aiController = null;
        var hint = (e.kind === "network" || e.kind === "http") ? " — check the setup page (link below)." : "";
        setStatus("Model error: " + e.message + hint, "err");
        return;
      }
      aiController = null;
      if (myGen !== aiGen || cfg.gameOver() || !isAITurn()) { aiBusy = false; return; }

      var move = cfg.parseMove(reply, ranked);
      if (!move || (cfg.moveStale && cfg.moveStale(move))) {
        move = ranked.length ? ranked[0] : null;
        thinkEl.textContent += "\n\n[couldn't read a legal MOVE: — played " +
          (move ? cfg.moveLabel(move) : "—") + " as a fallback]";
        thinkEl.scrollTop = thinkEl.scrollHeight;
      }
      aiBusy = false;
      if (!move) return;
      setStatus(me + " " + cfg.describeMove(move), "on");
      setTimeout(function () {
        if (myGen !== aiGen || cfg.gameOver() || !isAITurn()) return;
        cfg.applyMove(move);
      }, 250);
    }

    // ---- model list (shared BYOM config) ----
    async function loadModels() {
      XenoBYOM.saveConfig({ endpoint: endpointBase() });
      modelSel.disabled = true;
      modelSel.innerHTML = "<option>loading…</option>";
      var saved = XenoBYOM.loadConfig().model;
      var res = await XenoBYOM.test({ endpoint: endpointBase() });
      if (!res.ok) {
        modelSel.innerHTML = '<option value="">— model not reachable —</option>';
        setStatus(res.error.message + " — open the setup page to fix it.", "err");
        return;
      }
      modelSel.innerHTML = res.models.map(function (n) { return '<option value="' + n + '">' + n + "</option>"; }).join("");
      modelSel.disabled = false;
      var fav = res.models.indexOf(saved) >= 0 ? saved
        : (res.models.find(function (n) { return FAV_RE.test(n); }) || res.models[0]);
      modelSel.value = fav;
      XenoBYOM.saveConfig({ model: fav });
      if (aiMode === "ai") { setStatus("Ready — " + res.models.length + " model(s) via " + res.provider + ".", "on"); notify(); }
      else setStatus('Ready — ' + res.models.length + ' model(s). Switch Opponent to "vs AI".', "");
    }

    function rebuildSeats() {
      var opts = cfg.seats();
      seatSel.innerHTML = "";
      opts.forEach(function (o) {
        var el = document.createElement("option");
        el.value = o.value; el.textContent = o.label;
        seatSel.appendChild(el);
      });
      seatSel.value = aiSeat;
    }

    function newGame() {
      interrupt();
      rebuildSeats();
      if (aiMode === "ai") { setStatus("vs AI — AI plays " + cfg.seatName(aiSeat), "on"); notify(); }
      else setStatus(XenoBYOM.isLocal() ? "Humans — switch Opponent to “vs AI”" : "Humans only", "");
    }

    // ---- wiring ----
    if (oppSeg) oppSeg.addEventListener("click", function (e) {
      var b = e.target.closest(".seg-btn"); if (!b) return;
      aiMode = b.dataset.opp;
      oppSeg.querySelectorAll(".seg-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
      mount.classList.toggle("hide-seat", aiMode !== "ai");
      interrupt();
      repaint();
      if (aiMode === "ai") { setStatus("vs AI — AI plays " + cfg.seatName(aiSeat), "on"); notify(); }
      else setStatus("Humans only", "");
    });
    seatSel.addEventListener("change", function () {
      aiSeat = +seatSel.value; interrupt();
      repaint();
      if (aiMode === "ai") { setStatus("AI plays " + cfg.seatName(aiSeat), "on"); notify(); }
    });
    modelSel.addEventListener("change", function () { XenoBYOM.saveConfig({ model: modelSel.value }); });
    refreshB.addEventListener("click", loadModels);
    endpointI.addEventListener("change", loadModels);

    function start() {
      endpointI.value = XenoBYOM.loadConfig().endpoint;
      loadModels();
    }

    return {
      isAITurn: isAITurn,
      notify: notify,
      newGame: newGame,
      rebuildSeats: rebuildSeats,
      interrupt: interrupt,
      loadModels: loadModels,
      start: start,
      get seat() { return aiSeat; },
      get mode() { return aiMode; },
    };
  }

  window.XenoBoardAI = { create: create };
})();
