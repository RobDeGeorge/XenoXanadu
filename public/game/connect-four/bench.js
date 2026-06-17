/* ============================================================================
 *  XenoXanadu — Connect Four benchmark  (proof-of-concept eval harness)
 *  ----------------------------------------------------------------------------
 *  Plays a model (the one connected via BYOM) against the reference solver for N
 *  games, head-less and unattended, grading EVERY model move against the solver
 *  and logging it via XenoEval. The solver plays optimally, so this measures how
 *  close the model's play is to perfect — per system-prompt variant.
 *
 *  This is the "vertical slice": eval.js (log) + solver.js (ground truth) +
 *  prompts.js (variants under test) + this loop + a summary table. The pattern
 *  copies to the other AI games the way byom.js did.
 *
 *  Only mounts on a locally-run copy (needs a reachable local model). The panel
 *  builds its own DOM so index.html only has to load the four scripts.
 * ========================================================================== */
(function () {
  'use strict';
  if (!window.XenoBYOM || !XenoBYOM.isLocal()) return;   // hosted site = arcade only

  var ROWS = 6, COLS = 7;

  // ---- a tiny in-memory game, independent of the on-page DOM game ----------
  function emptyGrid() { return Array.from({ length: ROWS }, function () { return Array(COLS).fill(null); }); }
  function legal(grid) { var o = []; for (var c = 0; c < COLS; c++) if (!grid[0][c]) o.push(c); return o; }
  function applyMove(grid, col, player) {            // returns the row used, or -1
    for (var r = ROWS - 1; r >= 0; r--) if (!grid[r][col]) { grid[r][col] = player; return r; }
    return -1;
  }
  function isFull(grid) { return legal(grid).length === 0; }
  function winAt(grid, row, col, player) {
    var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (var d = 0; d < 4; d++) {
      var dr = dirs[d][0], dc = dirs[d][1], n = 1, k, rr, cc;
      for (k = 1; k < 4; k++) { rr = row + dr * k; cc = col + dc * k; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || grid[rr][cc] !== player) break; n++; }
      for (k = 1; k < 4; k++) { rr = row - dr * k; cc = col - dc * k; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || grid[rr][cc] !== player) break; n++; }
      if (n >= 4) return true;
    }
    return false;
  }

  // ---- UI ------------------------------------------------------------------
  var host = document.querySelector('.ai-panel') || document.body;
  var panel = document.createElement('div');
  panel.className = 'ai-panel ai-only';
  panel.innerHTML =
    '<div class="ai-row"><span class="label" style="font-size:14px;opacity:.95">🧪 Benchmark — model vs perfect solver</span></div>' +
    '<div class="ai-row">' +
      '<span class="label">Model</span><select id="bModel"><option>loading…</option></select>' +
      '<button id="bRefresh" title="Re-scan for installed models">↻</button>' +
    '</div>' +
    '<div class="ai-row">' +
      '<span class="label">Prompt</span><select id="bVariant"></select>' +
    '</div>' +
    '<div class="ai-row">' +
      '<span class="label">Games</span><input id="bGames" type="text" value="6" style="width:54px">' +
      '<span class="label">Model plays</span>' +
      '<div class="seg" id="bSide">' +
        '<button data-side="alt" class="active">Alternate</button>' +
        '<button data-side="red">Red (first)</button>' +
        '<button data-side="blue">Blue</button>' +
      '</div>' +
    '</div>' +
    '<div class="ai-row">' +
      '<span class="label">Solver depth</span><input id="bDepth" type="text" value="10" style="width:54px">' +
      '<button id="bRun">▶ Run benchmark</button>' +
      '<button id="bStop" disabled>■ Stop</button>' +
    '</div>' +
    '<div class="ai-status"><span class="dot" id="bDot"></span><span id="bStatus">Idle — pick a model & prompt, then Run.</span></div>' +
    '<div id="bDesc" class="hint"></div>' +
    '<div class="ai-think" id="bLog" style="max-height:150px">Per-move grading will stream here…</div>' +
    '<div id="bTableWrap" style="overflow-x:auto"></div>' +
    '<div class="ai-row">' +
      '<button id="bCSV">⬇ Export CSV</button>' +
      '<button id="bJSONL">⬇ Export JSONL</button>' +
      '<button id="bClear">🗑 Clear stored data</button>' +
      '<span class="ai-status" style="margin-left:auto"><span id="bCount">0</span> records stored</span>' +
    '</div>';
  host.parentNode.insertBefore(panel, host.nextSibling);

  var $ = function (id) { return panel.querySelector('#' + id); };
  var bModel = $('bModel'), bVariant = $('bVariant'), bGames = $('bGames'), bDepth = $('bDepth'),
      bSide = $('bSide'), bRun = $('bRun'), bStop = $('bStop'), bDot = $('bDot'), bStatus = $('bStatus'),
      bDesc = $('bDesc'), bLog = $('bLog'), bTableWrap = $('bTableWrap'), bCount = $('bCount');

  var modelSide = 'alt';
  var running = false, stopReq = false;

  function setStatus(t, s) { bStatus.textContent = t; bDot.className = 'dot' + (s ? ' ' + s : ''); }
  function logLine(t) { bLog.textContent += t + '\n'; bLog.scrollTop = bLog.scrollHeight; }
  function pct(x) { return x == null ? '—' : (x * 100).toFixed(0) + '%'; }

  // populate variant dropdown
  C4Prompts.list().forEach(function (v) {
    var o = document.createElement('option'); o.value = v.id; o.textContent = v.label; bVariant.appendChild(o);
  });
  function showDesc() { var v = C4Prompts.list().find(function (x) { return x.id === bVariant.value; }); bDesc.textContent = v ? v.description : ''; }
  bVariant.addEventListener('change', showDesc); showDesc();

  bSide.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    modelSide = b.dataset.side;
    [].forEach.call(bSide.children, function (x) { x.classList.toggle('active', x === b); });
  });

  // ---- model list (shares the site-wide BYOM connection) -------------------
  function loadModels() {
    bModel.disabled = true; bModel.innerHTML = '<option>loading…</option>';
    var saved = XenoBYOM.loadConfig().model;
    XenoBYOM.test({}).then(function (res) {
      if (!res.ok) { bModel.innerHTML = '<option value="">— not reachable —</option>'; setStatus(res.error.message + ' (set up a model first)', 'err'); return; }
      bModel.innerHTML = res.models.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
      bModel.disabled = false;
      bModel.value = res.models.indexOf(saved) >= 0 ? saved : res.models[0];
      setStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '.', '');
    });
  }
  $('bRefresh').addEventListener('click', loadModels);

  // ---- ask the connected model for one move --------------------------------
  function askModel(grid, player, variant, signal) {
    var messages = C4Prompts.build(variant, grid, player);
    var t0 = Date.now(), reply = '';
    return XenoBYOM.chat({
      model: bModel.value, messages: messages, temperature: 0.7, maxTokens: 512,
      onToken: function (d) { reply += d; }, signal: signal
    }).then(function (full) {
      return { reply: full || reply, latencyMs: Date.now() - t0 };
    });
  }

  // ---- one game: model vs solver, grading every model move -----------------
  function playGame(run, gameNo, mSide, variant, depth, signal) {
    var grid = emptyGrid();
    var current = 'red';                      // red always moves first
    var solverSide = mSide === 'red' ? 'blue' : 'red';
    var ply = 0;
    var pending = [];                          // queued XenoEval.log promises

    function finish(result) {
      pending.push(XenoEval.log({
        kind: 'game', runId: run.runId, game: 'connect-four', model: bModel.value,
        variant: variant, side: mSide, gameNo: gameNo, plies: ply, result: result
      }));
      return Promise.all(pending).then(function () { return result; });
    }

    function step() {
      if (stopReq) return Promise.resolve('stopped');
      if (isFull(grid)) return finish('draw');

      if (current === solverSide) {
        var a = C4Solver.analyze(grid, solverSide, { depth: depth });
        var row = applyMove(grid, a.best, solverSide);
        if (winAt(grid, row, a.best, solverSide)) return finish('loss');   // solver beat the model
        current = mSide; ply++;
        return step();
      }

      // model's turn — grade against the solver, then play what it chose
      ply++;
      var analysis = C4Solver.analyze(grid, mSide, { depth: depth });
      return askModel(grid, mSide, variant, signal).then(function (r) {
        var lg = C4Prompts.legalColumns(grid);
        var col = C4Prompts.parse(r.reply, lg);
        var fallback = col == null;
        if (fallback) {                        // unreadable reply → solver-best as the safe fallback
          col = analysis.best;
        }
        var g = C4Solver.grade(grid, mSide, col, { analysis: analysis });
        pending.push(XenoEval.log({
          kind: 'move', runId: run.runId, game: 'connect-four', model: bModel.value,
          variant: variant, side: mSide, gameNo: gameNo, ply: ply,
          board: C4Prompts.boardText(grid), legal: lg.map(function (c) { return c + 1; }),
          chosen: col + 1, best: g.best + 1, chosenVal: g.chosenVal, bestVal: g.bestVal,
          optimal: g.optimal, regret: g.regret, blunder: g.blunder, blunderType: g.blunderType,
          decisive: g.decisive, depth: g.depth, fallback: fallback,
          latencyMs: r.latencyMs, replyChars: (r.reply || '').length
        }));
        logLine('  g' + gameNo + ' m' + ply + ': played ' + (col + 1) +
          (fallback ? ' [FALLBACK]' : '') +
          (g.optimal ? ' ✓optimal' : (g.blunder ? ' ✗' + g.blunderType : ' ·sub(' + g.regret + ')')) +
          '  ' + r.latencyMs + 'ms');
        var row = applyMove(grid, col, mSide);
        if (winAt(grid, row, col, mSide)) return finish('win');
        current = solverSide;
        return step();
      });
    }
    return step();
  }

  // ---- run the whole batch -------------------------------------------------
  var controller = null;
  function run() {
    if (running) return;
    if (!bModel.value) { setStatus('Pick a model first.', 'err'); return; }
    var nGames = Math.max(1, Math.min(200, parseInt(bGames.value, 10) || 1));
    var depth = Math.max(1, Math.min(16, parseInt(bDepth.value, 10) || 10));
    var variant = bVariant.value;
    running = true; stopReq = false;
    bRun.disabled = true; bStop.disabled = false;
    controller = new AbortController();
    var runMeta = XenoEval.newRun({ game: 'connect-four', model: bModel.value, variant: variant });
    bLog.textContent = '';
    logLine('Run ' + runMeta.runId + ' — ' + nGames + ' game(s), prompt ' + variant + ', solver depth ' + depth + '.');
    setStatus('Running…', 'on');

    var i = 0;
    function next() {
      if (stopReq || i >= nGames) {
        running = false; bRun.disabled = false; bStop.disabled = true;
        setStatus(stopReq ? 'Stopped after ' + i + ' game(s).' : 'Done — ' + nGames + ' game(s).', stopReq ? '' : 'on');
        refreshTable(); refreshCount();
        return;
      }
      var gameNo = i + 1;
      var mSide = modelSide === 'alt' ? (i % 2 === 0 ? 'red' : 'blue') : modelSide;
      logLine('Game ' + gameNo + '/' + nGames + ' — model is ' + mSide + ':');
      setStatus('Game ' + gameNo + '/' + nGames + ' (model ' + mSide + ')…', 'on');
      playGame(runMeta, gameNo, mSide, variant, depth, controller.signal).then(function (result) {
        logLine('  → ' + result.toUpperCase());
        i++; refreshTable(); refreshCount();
        next();
      }).catch(function (e) {
        logLine('  ! error: ' + (e && e.message || e));
        running = false; bRun.disabled = false; bStop.disabled = true;
        setStatus('Model error: ' + (e && e.message || e), 'err');
      });
    }
    next();
  }

  bRun.addEventListener('click', run);
  bStop.addEventListener('click', function () {
    stopReq = true; if (controller) try { controller.abort(); } catch (e) {}
    setStatus('Stopping…', '');
  });

  // ---- summary table -------------------------------------------------------
  function refreshTable() {
    XenoEval.summary().then(function (cells) {
      cells = cells.filter(function (c) { return c.game === 'connect-four'; })
        .sort(function (a, b) { return (b.optimalRate || 0) - (a.optimalRate || 0); });
      if (!cells.length) { bTableWrap.innerHTML = ''; return; }
      var cols = [['variant', 'Prompt'], ['model', 'Model'], ['moves', 'Moves'],
        ['optimalRate', 'Optimal'], ['blunderRate', 'Blunder'], ['fallbackRate', 'Fallback'],
        ['avgRegret', 'AvgRegret'], ['avgLatencyMs', 'Latency'], ['games', 'Games'], ['winRate', 'Win']];
      var rateKeys = { optimalRate: 1, blunderRate: 1, fallbackRate: 1, winRate: 1 };
      var html = '<table style="border-collapse:collapse;width:100%;font-size:12px;margin-top:4px">';
      html += '<tr style="opacity:.7;text-align:left">' + cols.map(function (c) { return '<th style="padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.15)">' + c[1] + '</th>'; }).join('') + '</tr>';
      cells.forEach(function (r) {
        html += '<tr>' + cols.map(function (c) {
          var k = c[0], v = r[k];
          if (rateKeys[k]) v = pct(v);
          else if (k === 'avgRegret') v = (v == null ? '—' : v.toFixed(1));
          else if (k === 'avgLatencyMs') v = (v == null ? '—' : v + 'ms');
          else if (v == null) v = '—';
          return '<td style="padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.06)">' + v + '</td>';
        }).join('') + '</tr>';
      });
      html += '</table>';
      bTableWrap.innerHTML = html;
    });
  }
  function refreshCount() { XenoEval.count().then(function (n) { bCount.textContent = n; }); }

  $('bCSV').addEventListener('click', function () { XenoEval.exportCSV(); });
  $('bJSONL').addEventListener('click', function () { XenoEval.exportJSONL(); });
  $('bClear').addEventListener('click', function () {
    if (!confirm('Delete all stored eval records on this machine?')) return;
    XenoEval.clear().then(function () { refreshTable(); refreshCount(); logLine('Cleared stored records.'); });
  });

  // boot
  loadModels(); refreshTable(); refreshCount();
})();
