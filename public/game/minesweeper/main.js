/* ============================================================================
 *  XenoXanadu — Minesweeper — board + logic solver + BYOM narration
 *  ----------------------------------------------------------------------------
 *  Classic single-player Minesweeper (three difficulties, first-click safety,
 *  flood fill, flagging, chording, timer, win/lose).
 *
 *  The standout piece is the SOLVER: a constraint-propagation engine that finds
 *  provably-safe squares and provable mines using the two deductions every human
 *  sweeper uses — the "all neighbours accounted for / all remaining are mines"
 *  rule and the subset (1-2) rule. It powers two always-on, model-free features:
 *    • Hint       — highlight one certain square and say why.
 *    • Auto-solve — keep playing every certain move until it gets stuck.
 *
 *  A connected local model (via the shared BYOM pipeline) is a pure ENHANCEMENT:
 *  it never chooses a square. The solver picks the square; the model only turns
 *  the deduction into a plain-English explanation, streamed to a panel — the same
 *  "engine decides, model narrates" contract the other AI games use.
 * ========================================================================== */
(function () {
  'use strict';
  var BYOM = window.XenoBYOM;
  var $ = function (id) { return document.getElementById(id); };

  // Inline monochrome SVG icons (game-content, set via .innerHTML).
  var SVG_OPEN = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.15em">';
  var ICON_BOMB = SVG_OPEN + '<circle cx="11" cy="14" r="6"/><path d="M16.5 8.5 19 6"/><path d="M18 4h3v3"/></svg>';
  var ICON_FLAG = SVG_OPEN + '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/></svg>';
  var ICON_FACE_NEUTRAL = SVG_OPEN + '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/><path d="M9 15h6"/></svg>';
  var ICON_FACE_WIN = SVG_OPEN + '<circle cx="12" cy="12" r="9"/><path d="M6.5 10H11M13 10h4.5"/><path d="M8.5 15c1.2 1.2 5.8 1.2 7 0"/></svg>';
  var ICON_FACE_LOSE = SVG_OPEN + '<circle cx="12" cy="12" r="9"/><path d="M8 9.5l2 2M10 9.5l-2 2"/><path d="M14 9.5l2 2M16 9.5l-2 2"/><path d="M9 16h6"/></svg>';

  var LEVELS = {
    beginner:     { cols: 9,  rows: 9,  mines: 10 },
    intermediate: { cols: 16, rows: 16, mines: 40 },
    expert:       { cols: 30, rows: 16, mines: 99 }
  };

  // ---- DOM ----
  var boardEl = $('board'), faceEl = $('face'), mineCountEl = $('mineCount'),
      timerEl = $('timer'), assistMsg = $('assistMsg'),
      hintBtn = $('hintBtn'), autoBtn = $('autoBtn'), flagToggle = $('flagToggle'),
      modelSel = $('modelSel'), endpointEl = $('endpoint'), explainChk = $('explainChk'),
      thinkEl = $('aiThink');

  // ---- game state ----
  var level = 'beginner';
  var COLS = 9, ROWS = 9, MINES = 10;
  var cells = [];            // flat array, length COLS*ROWS
  var els = [];              // matching DOM nodes
  var placed = false;        // mines laid yet? (deferred to first click for safety)
  var over = false, won = false;
  var revealedCount = 0, flagCount = 0;
  var flagMode = false;
  var startTime = 0, timerId = null, elapsed = 0;

  // ---- AI / solver state ----
  var defaultModel = '', modelReady = false;
  var autoRunning = false;
  var gen = 0;               // bumps on new game / menu to cancel async loops
  var aiController = null;

  function endpoint() { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); }
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var aiUsable = function () { return BYOM.isLocal() && modelReady && defaultModel; };

  var idx = function (r, c) { return r * COLS + c; };
  var rc = function (i) { return { r: Math.floor(i / COLS), c: i % COLS }; };
  var name = function (i) { var p = rc(i); return 'R' + (p.r + 1) + 'C' + (p.c + 1); };
  function neighbors(i) {
    var p = rc(i), out = [];
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      var r = p.r + dr, c = p.c + dc;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) out.push(idx(r, c));
    }
    return out;
  }

  /* ============================ NEW GAME ============================ */
  function newGame() {
    gen++;
    autoRunning = false; updateAutoBtn();
    if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; }
    var L = LEVELS[level]; COLS = L.cols; ROWS = L.rows; MINES = L.mines;
    cells = []; els = [];
    placed = false; over = false; won = false; revealedCount = 0; flagCount = 0;
    stopTimer(); elapsed = 0; renderTimer();
    for (var i = 0; i < COLS * ROWS; i++) cells.push({ mine: false, adj: 0, state: 'hidden' });

    boardEl.className = 'board ' + level;
    boardEl.style.setProperty('--cols', COLS);
    boardEl.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var j = 0; j < COLS * ROWS; j++) {
      var d = document.createElement('div');
      d.className = 'cell hidden'; d.dataset.i = j;
      els.push(d); frag.appendChild(d);
    }
    boardEl.appendChild(frag);
    faceEl.innerHTML = ICON_FACE_NEUTRAL;
    renderMineCount();
    setMsg('Left-click to reveal · right-click to flag · click a number to chord.', '');
  }

  // Lay mines AFTER the first click, never on the clicked square or its
  // neighbours — so the opening click always cracks open a clear area.
  function placeMines(safe) {
    var forbidden = {}; forbidden[safe] = true;
    neighbors(safe).forEach(function (n) { forbidden[n] = true; });
    var spots = [];
    for (var i = 0; i < cells.length; i++) if (!forbidden[i]) spots.push(i);
    // if the board is too dense to spare the whole neighbourhood, only spare the cell
    if (spots.length < MINES) { spots = []; for (var k = 0; k < cells.length; k++) if (k !== safe) spots.push(k); }
    for (var m = 0; m < MINES; m++) {
      var pick = Math.floor(Math.random() * spots.length);
      cells[spots[pick]].mine = true;
      spots.splice(pick, 1);
    }
    for (var c = 0; c < cells.length; c++) {
      if (cells[c].mine) continue;
      var n = 0; neighbors(c).forEach(function (x) { if (cells[x].mine) n++; });
      cells[c].adj = n;
    }
    placed = true;
  }

  /* ============================ REVEAL / FLAG ============================ */
  function startTimer() { if (timerId) return; startTime = Date.now() - elapsed * 1000; timerId = setInterval(tick, 250); }
  function tick() { elapsed = Math.min(999, Math.floor((Date.now() - startTime) / 1000)); renderTimer(); }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function reveal(i) {
    if (over) return;
    var cell = cells[i];
    if (cell.state !== 'hidden') return;
    if (!placed) { placeMines(i); startTimer(); }
    clearHints();

    if (cell.mine) { cell.state = 'revealed'; lose(i); return; }

    // flood-fill open from any zero square (iterative stack)
    var stack = [i];
    while (stack.length) {
      var cur = stack.pop();
      var cc = cells[cur];
      if (cc.state !== 'hidden') continue;
      cc.state = 'revealed'; revealedCount++;
      paintCell(cur);
      if (cc.adj === 0) neighbors(cur).forEach(function (n) { if (cells[n].state === 'hidden') stack.push(n); });
    }
    checkWin();
  }

  function toggleFlag(i) {
    if (over) return;
    var cell = cells[i];
    if (cell.state === 'revealed') return;
    if (cell.state === 'flagged') { cell.state = 'hidden'; flagCount--; }
    else { cell.state = 'flagged'; flagCount++; }
    clearHints();
    paintCell(i); renderMineCount();
  }

  // Chord: clicking a satisfied number opens its non-flagged neighbours.
  function chord(i) {
    if (over) return;
    var cell = cells[i];
    if (cell.state !== 'revealed' || cell.adj === 0) return;
    var flags = 0, hidden = [];
    neighbors(i).forEach(function (n) {
      if (cells[n].state === 'flagged') flags++;
      else if (cells[n].state === 'hidden') hidden.push(n);
    });
    if (flags !== cell.adj || !hidden.length) return;
    clearHints();
    hidden.forEach(function (n) { reveal(n); });
  }

  function lose(boomIdx) {
    over = true; won = false; stopTimer();
    faceEl.innerHTML = ICON_FACE_LOSE;
    boardEl.classList.add('lost');
    cells.forEach(function (cell, i) {
      if (cell.mine && cell.state !== 'flagged') { cell.state = 'revealed'; paintCell(i, i === boomIdx); }
      else if (!cell.mine && cell.state === 'flagged') paintCell(i);   // mark the wrong flags
    });
    setMsg('<b>Boom.</b> ' + name(boomIdx) + ' was a mine. Hit <b>New game</b> (or the face) to try again.', 'lose');
  }

  function checkWin() {
    if (over) return;
    if (revealedCount === COLS * ROWS - MINES) {
      over = true; won = true; stopTimer();
      faceEl.innerHTML = ICON_FACE_WIN;
      boardEl.classList.add('won');
      // auto-flag the remaining mines for a tidy finish
      cells.forEach(function (cell, i) { if (cell.mine && cell.state !== 'flagged') { cell.state = 'flagged'; flagCount++; paintCell(i); } });
      renderMineCount();
      setMsg('<b>Swept it!</b> Cleared in ' + elapsed + 's on ' + level + '. Nicely done.', 'win');
    }
  }

  /* ============================ RENDER ============================ */
  function paintCell(i, boom) {
    var cell = cells[i], el = els[i];
    el.className = 'cell';
    el.removeAttribute('data-n');
    if (cell.state === 'hidden') { el.className = 'cell hidden'; el.textContent = ''; }
    else if (cell.state === 'flagged') {
      el.className = 'cell hidden flag' + (over && !cell.mine ? ' bad' : '');
      el.innerHTML = ICON_FLAG;
    } else { // revealed
      if (cell.mine) { el.className = 'cell open mine' + (boom ? ' boom' : ''); el.innerHTML = ICON_BOMB; }
      else if (cell.adj > 0) { el.className = 'cell open'; el.dataset.n = cell.adj; el.textContent = cell.adj; }
      else { el.className = 'cell open'; el.textContent = ''; }
    }
  }

  function renderMineCount() { mineCountEl.textContent = pad(Math.max(-99, MINES - flagCount)); }
  function renderTimer() { timerEl.textContent = pad(elapsed); }
  function pad(n) { var s = (n < 0 ? '-' : '') + ('00' + Math.abs(n)).slice(-3); return s; }
  function setMsg(html, cls) { assistMsg.className = 'assist-msg' + (cls ? ' ' + cls : ''); assistMsg.innerHTML = html; }

  /* ============================ INPUT ============================ */
  boardEl.addEventListener('click', function (e) {
    var t = e.target.closest('.cell'); if (!t) return;
    var i = +t.dataset.i;
    if (flagMode) { toggleFlag(i); return; }
    if (cells[i].state === 'revealed') chord(i);
    else reveal(i);
  });
  boardEl.addEventListener('contextmenu', function (e) {
    var t = e.target.closest('.cell'); if (!t) return;
    e.preventDefault();
    toggleFlag(+t.dataset.i);
  });
  // long-press to flag (touch)
  var pressTimer = null;
  boardEl.addEventListener('touchstart', function (e) {
    var t = e.target.closest('.cell'); if (!t) return;
    var i = +t.dataset.i;
    pressTimer = setTimeout(function () { pressTimer = null; toggleFlag(i); }, 380);
  }, { passive: true });
  boardEl.addEventListener('touchend', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
  boardEl.addEventListener('touchmove', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });

  faceEl.addEventListener('click', newGame);
  $('newGame').addEventListener('click', newGame);
  $('diffSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    $('diffSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    level = b.dataset.diff; newGame();
  });
  flagToggle.addEventListener('click', function () {
    flagMode = !flagMode;
    flagToggle.classList.toggle('on', flagMode);
    flagToggle.textContent = 'Flag: ' + (flagMode ? 'on' : 'off');
  });

  /* ============================ SOLVER ============================ */
  // Constraint propagation over the visible frontier. Returns provably-safe and
  // provably-mined hidden squares, each tagged with the deduction that proved it.
  function solve() {
    var mine = {}, safe = {}, reason = {};
    for (var f = 0; f < cells.length; f++) if (cells[f].state === 'flagged') mine[f] = true;  // trust the player's flags

    function constraints() {
      var cons = [];
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        if (cell.state !== 'revealed' || cell.adj === 0) continue;
        var unk = [], mc = 0;
        neighbors(i).forEach(function (n) {
          if (mine[n]) mc++;
          else if (cells[n].state === 'hidden' && !safe[n]) unk.push(n);
        });
        if (unk.length) cons.push({ src: i, cells: unk, need: cell.adj - mc });
      }
      return cons;
    }

    var progress = true;
    while (progress) {
      progress = false;
      var cons = constraints();
      // trivial rule: a constraint with 0 mines left → all clear; with need===size → all mines
      for (var a = 0; a < cons.length; a++) {
        var c = cons[a];
        if (c.need <= 0) c.cells.forEach(function (x) { if (!safe[x]) { safe[x] = true; reason[x] = { type: 'safe', src: c.src }; progress = true; } });
        else if (c.need === c.cells.length) c.cells.forEach(function (x) { if (!mine[x]) { mine[x] = true; reason[x] = { type: 'mine', src: c.src }; progress = true; } });
      }
      if (progress) continue;   // fold in new knowledge before the costlier subset pass
      // subset (1-2) rule: if A's cells ⊆ B's cells, B\A holds (B.need - A.need) mines
      for (var p = 0; p < cons.length; p++) {
        for (var q = 0; q < cons.length; q++) {
          if (p === q) continue;
          var A = cons[p], B = cons[q];
          if (A.cells.length >= B.cells.length) continue;
          if (!A.cells.every(function (x) { return B.cells.indexOf(x) >= 0; })) continue;
          var diff = B.cells.filter(function (x) { return A.cells.indexOf(x) < 0; });
          var dneed = B.need - A.need;
          if (dneed === 0) diff.forEach(function (x) { if (!safe[x]) { safe[x] = true; reason[x] = { type: 'safe', src: B.src, via: A.src }; progress = true; } });
          else if (dneed === diff.length) diff.forEach(function (x) { if (!mine[x]) { mine[x] = true; reason[x] = { type: 'mine', src: B.src, via: A.src }; progress = true; } });
        }
      }
    }

    var hidden = function (i) { return cells[i].state === 'hidden'; };
    var safeOut = Object.keys(safe).map(Number).filter(hidden);
    var mineOut = Object.keys(mine).map(Number).filter(hidden);   // hidden ⇒ not already flagged
    return { safe: safeOut, mines: mineOut, reason: reason, guess: bestGuess(safe, mine) };
  }

  // When nothing is certain, estimate each frontier cell's mine probability and
  // return the lowest — a sensible square to gamble on.
  function bestGuess(safe, mine) {
    if (!placed) return null;
    var sum = {}, cnt = {}, frontier = {};
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      if (cell.state !== 'revealed' || cell.adj === 0) continue;
      var unk = [], mc = 0;
      neighbors(i).forEach(function (n) { if (mine[n] || cells[n].state === 'flagged') mc++; else if (cells[n].state === 'hidden' && !safe[n]) unk.push(n); });
      if (!unk.length) continue;
      var prob = (cell.adj - mc) / unk.length;
      unk.forEach(function (n) { sum[n] = (sum[n] || 0) + prob; cnt[n] = (cnt[n] || 0) + 1; frontier[n] = true; });
    }
    var best = null, bestP = 2;
    Object.keys(frontier).forEach(function (k) { var p = sum[k] / cnt[k]; if (p < bestP) { bestP = p; best = +k; } });
    return best == null ? null : { cell: best, prob: bestP };
  }

  function reasonText(i, res) {
    var r = res.reason[i]; if (!r) return '';
    var srcN = cells[r.src].adj;
    if (r.type === 'safe') {
      if (r.via != null) return name(i) + ' is <b>safe</b>: lining up the ' + cells[r.via].adj + ' at ' + name(r.via) + ' against the ' + srcN + ' at ' + name(r.src) + ', every mine the ' + srcN + ' needs already sits inside the ' + cells[r.via].adj + "'s cells — so this leftover square can't be one.";
      return name(i) + ' is <b>safe</b>: the ' + srcN + ' at ' + name(r.src) + ' already touches all ' + srcN + ' of its mines (flagged), so its remaining hidden neighbours are clear.';
    }
    if (r.via != null) return name(i) + ' is a <b>mine</b>: the ' + srcN + ' at ' + name(r.src) + ' needs more mines than the ' + cells[r.via].adj + ' at ' + name(r.via) + ' can supply, and the only place left for them is this square.';
    return name(i) + ' is a <b>mine</b>: the ' + srcN + ' at ' + name(r.src) + ' has exactly ' + srcN + ' hidden neighbours left, so all of them — including this one — must be mines.';
  }

  /* ============================ HINT ============================ */
  function clearHints() {
    boardEl.querySelectorAll('.hint-safe,.hint-mine,.hint-guess,.hint-src').forEach(function (el) {
      el.classList.remove('hint-safe', 'hint-mine', 'hint-guess', 'hint-src');
    });
  }

  async function hint() {
    if (over) { setMsg('Game over — start a <b>New game</b> first.', ''); return; }
    if (!placed) { setMsg('Make your first move anywhere — the opening click is always safe.', ''); return; }
    clearHints();
    var res = solve();

    if (res.safe.length) { return announce(res.safe[0], res, 'safe'); }
    if (res.mines.length) { return announce(res.mines[0], res, 'mine'); }

    // nothing certain — offer the lowest-probability gamble
    if (res.guess) {
      els[res.guess.cell].classList.add('hint-guess');
      els[res.guess.cell].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      var pct = Math.round(res.guess.prob * 100);
      setMsg('No certain move — but <b>' + name(res.guess.cell) + '</b> is the safest gamble (~' + pct + '% mine).', '');
      if (explainChk.checked && aiUsable()) narrate(null, res, 'guess', res.guess);
    } else {
      setMsg('No logical deduction available yet — open up a bit more of the board.', '');
    }
  }

  function announce(i, res, kind) {
    els[i].classList.add(kind === 'safe' ? 'hint-safe' : 'hint-mine');
    var r = res.reason[i];
    if (r) { els[r.src].classList.add('hint-src'); if (r.via != null) els[r.via].classList.add('hint-src'); }
    els[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setMsg(reasonText(i, res), kind);
    if (explainChk.checked && aiUsable()) narrate(i, res, kind, null);
  }

  /* ============================ MODEL NARRATION ============================ */
  // The model NEVER picks the square — the solver already did. It only retells the
  // deduction conversationally, streamed into the think panel.
  async function narrate(i, res, kind, guess) {
    var g = gen;
    if (aiController) { try { aiController.abort(); } catch (e) {} }
    aiController = new AbortController();
    thinkEl.textContent = '';
    var sys = 'You are a friendly Minesweeper coach. You are given a deduction that has ALREADY been proven correct by a solver. ' +
      'Explain the reasoning to a learner in 1-3 short sentences, conversationally. Do NOT contradict the deduction, do not suggest a different square, and do not add caveats — it is certain. Refer to squares by their RxCy labels.';
    var user;
    if (kind === 'guess') {
      sys = 'You are a friendly Minesweeper coach. The solver has found NO certain move and suggests the lowest-probability square to gamble on. In 1-2 short sentences, reassure the learner that no deduction is possible right now and that this square is the safest guess.';
      user = 'No certain move exists. Safest gamble: ' + name(guess.cell) + ' at about ' + Math.round(guess.prob * 100) + '% chance of being a mine. ' + localPicture(guess.cell);
    } else {
      user = 'Proven fact: ' + reasonText(i, res).replace(/<\/?b>/g, '') + '\n' + localPicture(i) + '\nExplain why this is certain.';
    }
    try {
      await BYOM.chat({
        endpoint: endpoint(), model: defaultModel, temperature: 0.4,
        maxTokens: aiIsReasoning(defaultModel) ? 1400 : 220,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        onToken: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        onThinking: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        signal: aiController.signal
      });
    } catch (e) {
      if (g !== gen) return;
      thinkEl.textContent += (thinkEl.textContent ? '\n' : '') + '[model unavailable — the written reason above still stands.]';
    }
    aiController = null;
  }

  // A compact text snapshot of the squares around `i`, so the model can talk
  // about concrete numbers without us shipping the whole board.
  function localPicture(i) {
    var parts = [];
    neighbors(i).concat([i]).forEach(function (n) {
      var cell = cells[n], label = name(n), s;
      if (cell.state === 'revealed') s = cell.mine ? 'mine' : (cell.adj === 0 ? 'blank' : String(cell.adj));
      else if (cell.state === 'flagged') s = 'flagged';
      else s = 'hidden';
      parts.push(label + '=' + s);
    });
    return 'Nearby squares: ' + parts.join(', ') + '.';
  }

  /* ============================ AUTO-SOLVE ============================ */
  function updateAutoBtn() { autoBtn.classList.toggle('on', autoRunning); autoBtn.textContent = autoRunning ? 'Stop' : 'Auto-solve'; }

  async function autoSolve() {
    if (autoRunning) { autoRunning = false; updateAutoBtn(); return; }
    if (over) { setMsg('Game over — start a <b>New game</b> first.', ''); return; }
    if (!placed) { reveal(centerCell()); }    // open the middle to get things going
    autoRunning = true; updateAutoBtn();
    var g = gen;
    while (autoRunning && g === gen && !over) {
      var res = solve();
      if (!res.safe.length && !res.mines.length) {
        clearHints();
        if (res.guess) { var pct = Math.round(res.guess.prob * 100); setMsg('Stuck — no certain move. Safest gamble would be <b>' + name(res.guess.cell) + '</b> (~' + pct + '% mine). Your call.', ''); }
        else setMsg('Stuck — no certain move available.', '');
        break;
      }
      // flag the certain mines first (so chords/counts read right), then sweep the safes
      res.mines.forEach(function (m) { if (cells[m].state === 'hidden') { cells[m].state = 'flagged'; flagCount++; paintCell(m); } });
      renderMineCount();
      if (res.mines.length) { setMsg('Flagged ' + res.mines.length + ' certain mine(s).', 'mine'); await sleep(160, g); }
      if (!autoRunning || g !== gen) break;
      for (var k = 0; k < res.safe.length; k++) {
        if (!autoRunning || g !== gen || over) break;
        if (cells[res.safe[k]].state === 'hidden') { setMsg('Revealing ' + name(res.safe[k]) + ' — proven safe.', 'safe'); reveal(res.safe[k]); await sleep(120, g); }
      }
    }
    if (g === gen) { autoRunning = false; updateAutoBtn(); }
  }
  function centerCell() { return idx(Math.floor(ROWS / 2), Math.floor(COLS / 2)); }

  hintBtn.addEventListener('click', hint);
  autoBtn.addEventListener('click', autoSolve);

  /* ============================ AI CONNECTION ============================ */
  function setAiStatus(text, state) { $('aiStatus').textContent = text; $('aiDot').className = 'ai-dot' + (state ? ' ' + state : ''); }

  async function loadModels() {
    if (!BYOM.isLocal()) return;
    BYOM.saveConfig({ endpoint: endpoint() });
    modelSel.disabled = true; modelSel.innerHTML = '<option>loading…</option>'; modelReady = false;
    var saved = BYOM.loadConfig().model;
    var res = await BYOM.test({ endpoint: endpoint() });
    if (!res.ok) {
      modelSel.innerHTML = '<option value="">— not reachable —</option>';
      setAiStatus(res.error.message + ' — hints & auto-solve still work (pure logic).', 'err');
      return;
    }
    modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    modelSel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved
      : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
    modelSel.value = fav; defaultModel = fav; modelReady = true;
    BYOM.saveConfig({ model: fav });
    setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. Tick the box to narrate hints.', 'on');
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  function sleep(ms, g) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ============================ BOOT ============================ */
  newGame();
  if (BYOM.isLocal()) { endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT; loadModels(); }
  else setAiStatus('Public site — hints & auto-solve run offline (pure logic). Run locally to add model narration.', '');
})();
