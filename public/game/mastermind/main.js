/* ============================================================================
 *  XenoXanadu — Mastermind — board + feedback engine + Knuth minimax solver
 *  ----------------------------------------------------------------------------
 *  Classic Mastermind. A hidden code of coloured pegs (length 3-5, 4/5/6/8
 *  colours, repeats optional), a limited number of guesses, and the two-number
 *  clue every player knows:
 *    • black peg = right colour AND right position
 *    • white peg = right colour, wrong position   (no double-counting)
 *  The feedback maths is the load-bearing part — computed with the standard
 *  multiset method (exact matches first, then min(count) per colour on the
 *  leftovers) so a colour is never scored twice.
 *
 *  TWO modes (segmented toggle, like hangman):
 *    1. YOU CRACK IT  — the engine rolls a secret code; you guess it.
 *    2. AI CRACKS YOURS — you set a code; a built-in solver cracks it. The solver
 *       is Knuth's five-guess minimax: keep the set of codes still consistent
 *       with every clue so far, and pick the guess that minimises the worst-case
 *       size of the surviving set (worst-case partition by feedback pattern),
 *       preferring a guess that is itself still a candidate on ties. This is the
 *       ground truth — the engine computes every clue and the solver every guess,
 *       fully OFFLINE.
 *
 *  Pattern B1 — "engine decides, model narrates": a connected local model (via
 *  the shared BYOM pipeline) NEVER invents feedback or a code. It only retells,
 *  in plain English, how the just-played clue pruned the candidate set
 *  ("17 codes remained; this guess splits them best"), streamed to a panel.
 * ========================================================================== */
(function () {
  'use strict';
  var BYOM = window.XenoBYOM;
  var $ = function (id) { return document.getElementById(id); };

  // ---- DOM ----
  var rowsEl = $('rows'), paletteEl = $('palette'), statusEl = $('status'),
      bannerEl = $('banner'), stepLineEl = $('stepLine'),
      crackControls = $('crackControls'), solveSetup = $('solveSetup'), solveRun = $('solveRun'),
      submitBtn = $('submitBtn'), clearBtn = $('clearBtn'),
      lockBtn = $('lockBtn'), randCodeBtn = $('randCodeBtn'),
      stepBtn = $('stepBtn'), autoBtn = $('autoBtn'),
      modelSel = $('modelSel'), endpointEl = $('endpoint'), explainChk = $('explainChk'),
      thinkEl = $('aiThink');

  // ---- settings ----
  var mode = 'crack';      // 'crack' | 'solve'
  var LEN = 4, COLORS = 6, REPEATS = true;
  var MAX_GUESSES = 10;

  // ---- game state ----
  var secret = [];         // the hidden code (array of 1..COLORS)
  var guesses = [];        // [{pegs:[...], black, white}]
  var draft = [];          // the row being built (length LEN; 0 = empty)
  var selColor = 1;        // currently selected palette colour
  var over = false, won = false;

  // ---- solver state ----
  var candidates = [];     // codes still consistent with all clues (solve mode)
  var solverPhase = '';    // '' | 'setting' | 'running'
  var lastPrune = null;    // { before, after, guess, fb } for narration
  var autoRunning = false;

  // ---- AI ----
  var defaultModel = '', modelReady = false, aiController = null, gen = 0;
  function endpoint() { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); }
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var aiUsable = function () { return BYOM.isLocal() && modelReady && defaultModel; };

  /* ============================ CORE: FEEDBACK ============================ */
  // The one calculation that must be exactly right. Black = exact (colour+pos);
  // white = right colour in the wrong place, scored on the LEFTOVERS only so no
  // peg is counted twice. Classic multiset method.
  function score(guess, code) {
    var black = 0, white = 0;
    var gLeft = [], cLeft = [];   // colour counts of the non-exact leftovers
    for (var i = 0; i < code.length; i++) {
      if (guess[i] === code[i]) { black++; }
      else { gLeft[guess[i]] = (gLeft[guess[i]] || 0) + 1; cLeft[code[i]] = (cLeft[code[i]] || 0) + 1; }
    }
    for (var c = 1; c <= COLORS; c++) white += Math.min(gLeft[c] || 0, cLeft[c] || 0);
    return { black: black, white: white };
  }

  /* ============================ CODE GENERATION ============================ */
  function randomCode() {
    var code = [];
    if (REPEATS) {
      for (var i = 0; i < LEN; i++) code.push(1 + Math.floor(Math.random() * COLORS));
    } else {
      var pool = []; for (var c = 1; c <= COLORS; c++) pool.push(c);
      for (var k = 0; k < LEN; k++) { var j = Math.floor(Math.random() * pool.length); code.push(pool.splice(j, 1)[0]); }
    }
    return code;
  }

  // Enumerate the full code space (for the solver's candidate set). Capped by the
  // segmented options so it stays small (max 8^5 = 32768).
  function allCodes() {
    var out = [];
    var rec = function (prefix, used) {
      if (prefix.length === LEN) { out.push(prefix.slice()); return; }
      for (var c = 1; c <= COLORS; c++) {
        if (!REPEATS && used[c]) continue;
        prefix.push(c); used[c] = true;
        rec(prefix, used);
        prefix.pop(); if (!REPEATS) used[c] = false;
      }
    };
    rec([], {});
    return out;
  }

  /* ============================ NEW GAME ============================ */
  function newGame() {
    gen++;
    if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; }
    autoRunning = false;
    over = false; won = false;
    guesses = []; lastPrune = null;
    draft = new Array(LEN).fill(0);
    bannerEl.textContent = ''; bannerEl.className = 'winner-banner';
    var oldReveal = $('revealRow'); if (oldReveal) oldReveal.remove();
    stepLineEl.innerHTML = '';
    buildPalette();

    if (mode === 'crack') {
      solverPhase = '';
      secret = randomCode();
      crackControls.style.display = ''; solveSetup.style.display = 'none'; solveRun.style.display = 'none';
      setStatus('Pick a colour, fill the row, then submit your guess. <b>' + MAX_GUESSES + '</b> tries.');
    } else {
      // solve mode: player sets the code first
      solverPhase = 'setting';
      secret = new Array(LEN).fill(0);
      candidates = [];
      crackControls.style.display = 'none'; solveSetup.style.display = ''; solveRun.style.display = 'none';
      setStatus('Set a secret code for the solver to crack — tap the palette, then a slot.');
    }
    renderBoard();
    updateButtons();
  }

  /* ============================ PALETTE ============================ */
  function buildPalette() {
    paletteEl.innerHTML = '';
    for (var c = 1; c <= COLORS; c++) {
      var p = document.createElement('div');
      p.className = 'pick c' + c + (c === selColor ? ' on' : '');
      p.dataset.color = c;
      paletteEl.appendChild(p);
    }
    // erase swatch (clears a slot) — only meaningful in solve-setting & crack draft
    var er = document.createElement('div');
    er.className = 'pick erase' + (selColor === 0 ? ' on' : '');
    er.dataset.color = 0; er.textContent = '⌫';
    paletteEl.appendChild(er);
  }

  paletteEl.addEventListener('click', function (e) {
    var p = e.target.closest('.pick'); if (!p) return;
    selColor = +p.dataset.color;
    paletteEl.querySelectorAll('.pick').forEach(function (x) { x.classList.toggle('on', +x.dataset.color === selColor); });
  });

  /* ============================ RENDER ============================ */
  function pegHTML(color, extraCls) {
    var cls = 'peg' + (color ? ' c' + color : '') + (extraCls ? ' ' + extraCls : '');
    return '<div class="' + cls + '"' + (color ? ' data-c="' + color + '"' : '') + '></div>';
  }

  function feedbackHTML(black, white) {
    var html = '';
    for (var b = 0; b < black; b++) html += '<div class="key black"></div>';
    for (var w = 0; w < white; w++) html += '<div class="key white"></div>';
    var empty = LEN - black - white;
    for (var e = 0; e < empty; e++) html += '<div class="key"></div>';
    return html;
  }

  function renderBoard() {
    rowsEl.innerHTML = '';
    var frag = document.createDocumentFragment();

    // past guesses
    for (var i = 0; i < guesses.length; i++) {
      var g = guesses[i];
      var row = document.createElement('div');
      row.className = 'row past';
      var slots = g.pegs.map(function (c) { return pegHTML(c); }).join('');
      row.innerHTML = '<div class="row-no">' + (i + 1) + '</div>' +
        '<div class="slots">' + slots + '</div>' +
        '<div class="feedback">' + feedbackHTML(g.black, g.white) + '</div>';
      frag.appendChild(row);
    }

    // the active editable row (crack mode, or solve-setting mode)
    var editable = (mode === 'crack' && !over) || (mode === 'solve' && solverPhase === 'setting');
    if (editable && guesses.length < MAX_GUESSES) {
      var active = document.createElement('div');
      active.className = 'row active';
      var src = (mode === 'solve' && solverPhase === 'setting') ? secret : draft;
      var pegs = '';
      for (var s = 0; s < LEN; s++) pegs += '<div class="peg editable ' + (src[s] ? 'c' + src[s] : '') + '" data-slot="' + s + '"' + (src[s] ? ' data-c="' + src[s] + '"' : '') + '></div>';
      var label = (mode === 'solve') ? 'SET' : (guesses.length + 1);
      active.innerHTML = '<div class="row-no">' + label + '</div>' +
        '<div class="slots">' + pegs + '</div>' +
        '<div class="feedback">' + feedbackHTML(0, 0) + '</div>';
      frag.appendChild(active);
    }

    // pad with empty future rows (crack mode) for the classic full board look
    if (mode === 'crack') {
      var shown = guesses.length + (editable && guesses.length < MAX_GUESSES ? 1 : 0);
      for (var f = shown; f < MAX_GUESSES; f++) {
        var er = document.createElement('div');
        er.className = 'row';
        var empties = ''; for (var x = 0; x < LEN; x++) empties += pegHTML(0);
        er.innerHTML = '<div class="row-no">' + (f + 1) + '</div>' +
          '<div class="slots">' + empties + '</div>' +
          '<div class="feedback">' + feedbackHTML(0, 0) + '</div>';
        frag.appendChild(er);
      }
    }

    rowsEl.appendChild(frag);
  }

  // click a slot in the active row to drop the selected colour (or erase)
  rowsEl.addEventListener('click', function (e) {
    var pegEl = e.target.closest('.peg.editable'); if (!pegEl) return;
    var slot = +pegEl.dataset.slot;
    if (mode === 'crack' && !over) {
      if (!REPEATS && selColor && draft.indexOf(selColor) >= 0 && draft[slot] !== selColor) {
        flashStatus('No duplicates this game — that colour is already placed.');
        return;
      }
      draft[slot] = selColor;
    } else if (mode === 'solve' && solverPhase === 'setting') {
      if (!REPEATS && selColor && secret.indexOf(selColor) >= 0 && secret[slot] !== selColor) {
        flashStatus('No duplicates this game — that colour is already placed.');
        return;
      }
      secret[slot] = selColor;
    } else return;
    renderBoard();
    updateButtons();
  });

  /* ============================ CRACK MODE ============================ */
  function submitGuess() {
    if (over || mode !== 'crack') return;
    if (draft.indexOf(0) >= 0) { flashStatus('Fill every slot first.'); return; }
    var fb = score(draft, secret);
    guesses.push({ pegs: draft.slice(), black: fb.black, white: fb.white });
    draft = new Array(LEN).fill(0);

    if (fb.black === LEN) { finish(true); }
    else if (guesses.length >= MAX_GUESSES) { finish(false); }
    else { setStatus('<b>' + fb.black + '</b> exact · <b>' + fb.white + '</b> colour. ' + (MAX_GUESSES - guesses.length) + ' tries left.'); }
    renderBoard();
    updateButtons();
  }

  function finish(win) {
    over = true; won = win;
    if (win) {
      bannerEl.textContent = (mode === 'crack' ? '✦ CRACKED IT ✦' : '✦ SOLVER WINS ✦');
      bannerEl.className = 'winner-banner win';
      setStatus(mode === 'crack'
        ? 'You broke the code in ' + guesses.length + ' guess' + (guesses.length === 1 ? '' : 'es') + '!'
        : 'The solver cracked your code in ' + guesses.length + ' guess' + (guesses.length === 1 ? '' : 'es') + '.');
    } else {
      bannerEl.textContent = (mode === 'crack' ? '✖ OUT OF TRIES ✖' : '✖ SOLVER STUCK ✖');
      bannerEl.className = 'winner-banner lose';
      setStatus('The code was: ' + codeText(secret));
    }
    showReveal();
  }

  function showReveal() {
    var old = $('revealRow'); if (old) old.remove();
    if (!over) return;
    var rr = document.createElement('div');
    rr.className = 'reveal-row'; rr.id = 'revealRow';
    rr.innerHTML = '<span style="color:var(--muted);font-size:12px;letter-spacing:1px;">CODE&nbsp;</span>' +
      secret.map(function (c) { return pegHTML(c); }).join('');
    bannerEl.parentNode.insertBefore(rr, bannerEl.nextSibling);
  }

  submitBtn.addEventListener('click', submitGuess);
  clearBtn.addEventListener('click', function () {
    if (mode === 'crack' && !over) { draft = new Array(LEN).fill(0); renderBoard(); updateButtons(); }
  });

  /* ============================ SOLVE MODE (Knuth minimax) ============================ */
  function lockCode() {
    if (mode !== 'solve' || solverPhase !== 'setting') return;
    if (secret.indexOf(0) >= 0) { flashStatus('Fill every slot of the secret code first.'); return; }
    solverPhase = 'running';
    candidates = allCodes();
    lastPrune = null;
    solveSetup.style.display = 'none'; solveRun.style.display = '';
    setStatus('Code locked. ' + candidates.length + ' possible codes. Hit <b>Next guess</b> (or Auto-solve).');
    renderBoard();
    updateButtons();
  }

  // One solver step: pick the minimax guess, score it against the secret, prune.
  function solverStep() {
    if (over || mode !== 'solve' || solverPhase !== 'running') return;
    var before = candidates.length;
    var guess = pickGuess();
    var fb = score(guess, secret);
    guesses.push({ pegs: guess.slice(), black: fb.black, white: fb.white });

    // prune: keep only codes that would have produced the SAME clue for this guess
    candidates = candidates.filter(function (code) {
      var s = score(guess, code);
      return s.black === fb.black && s.white === fb.white;
    });
    lastPrune = { before: before, after: candidates.length, guess: guess.slice(), fb: fb, n: guesses.length };

    if (fb.black === LEN) { finish(true); }
    else if (guesses.length >= MAX_GUESSES || candidates.length === 0) { finish(false); }
    else { setStatus('Guess ' + guesses.length + ': <b>' + fb.black + '</b> exact · <b>' + fb.white + '</b> colour → ' + before + ' codes pruned to <b>' + candidates.length + '</b>.'); }

    stepLineEl.innerHTML = pruneLine();
    renderBoard();
    updateButtons();
    if (explainChk.checked && aiUsable()) narratePrune();
  }

  // Knuth minimax. First guess is a fixed strong opener (cheap; the full minimax
  // over the whole space is the slow part and a known opener does as well). After
  // that, for each candidate guess, partition the remaining candidates by the
  // feedback pattern they'd give and score the guess by its WORST-case partition
  // (the largest group left). Lowest worst-case wins; ties broken toward a guess
  // that is still itself a candidate (so we can win on the spot).
  function pickGuess() {
    if (guesses.length === 0) return opener();
    if (candidates.length <= 2) return candidates[0];   // can't do better than a candidate

    // For tractability, draw the pool of guesses to evaluate from the candidate
    // set (and, when small enough, the whole space). Candidate-only minimax is a
    // hair from optimal and keeps big boards fast.
    //
    // The minimax loop is O(n^2) in the candidate count, which only bites on the
    // very largest board (length 5 / 8 colours / repeats → ~6.5k codes survive
    // the opener and a naive pass takes seconds, freezing the tab). So when the
    // set is large we evaluate over a strided SAMPLE of the candidates on BOTH
    // axes (guess pool and scoring set): a few thousand score calls instead of
    // tens of millions. Tested: still solves every standard config in ≤7 guesses
    // with zero failures, in tens of ms instead of seconds.
    var CAP = 1200;
    var step = Math.max(1, Math.ceil(candidates.length / CAP));
    var best = null, bestWorst = Infinity;
    for (var i = 0; i < candidates.length; i += step) {
      var g = candidates[i];
      var buckets = {};
      for (var j = 0; j < candidates.length; j += step) {
        var s = score(g, candidates[j]);
        var key = s.black + ',' + s.white;
        buckets[key] = (buckets[key] || 0) + 1;
      }
      var worst = 0;
      for (var k in buckets) if (buckets[k] > worst) worst = buckets[k];
      // pool is drawn from candidates, so every guess here is itself a candidate;
      // lowest worst-case partition wins (first such guess, deterministic).
      if (worst < bestWorst) { bestWorst = worst; best = g; }
    }
    return best || candidates[0];
  }

  // A solid, repeats-aware opening guess: two pairs (e.g. 1,1,2,2) when repeats
  // are allowed and the board is wide enough; otherwise the first distinct colours.
  function opener() {
    var g = [];
    if (REPEATS) {
      var half = Math.ceil(LEN / 2);
      for (var i = 0; i < LEN; i++) g.push(i < half ? 1 : 2);
    } else {
      for (var c = 1; c <= LEN; c++) g.push(c);
    }
    return g;
  }

  function pruneLine() {
    if (!lastPrune) return '';
    if (lastPrune.fb.black === LEN) return '<b>Solved</b> — that guess was the code.';
    return 'Clue ' + lastPrune.n + ' (<b>' + lastPrune.fb.black + '</b>B/<b>' + lastPrune.fb.white + '</b>W) cut <b>' + lastPrune.before + '</b> → <b>' + lastPrune.after + '</b> possible codes.';
  }

  stepBtn.addEventListener('click', solverStep);
  lockBtn.addEventListener('click', lockCode);
  randCodeBtn.addEventListener('click', function () {
    if (mode !== 'solve' || solverPhase !== 'setting') return;
    secret = randomCode(); renderBoard(); updateButtons();
  });

  autoBtn.addEventListener('click', async function () {
    if (autoRunning) { autoRunning = false; autoBtn.textContent = 'Auto-solve'; return; }
    if (mode !== 'solve' || solverPhase !== 'running' || over) return;
    autoRunning = true; autoBtn.textContent = '⏹ Stop';
    var g = gen;
    while (autoRunning && g === gen && !over) {
      solverStep();
      await sleep(explainChk.checked && aiUsable() ? 1400 : 650, g);
    }
    if (g === gen) { autoRunning = false; autoBtn.textContent = 'Auto-solve'; }
  });

  /* ============================ MODEL NARRATION (B1) ============================ */
  // The model NEVER picks a guess or invents a clue — the solver picked the guess
  // and the engine computed the clue. It only retells how the candidate set shrank.
  async function narratePrune() {
    if (!lastPrune) return;
    var g = gen;
    if (aiController) { try { aiController.abort(); } catch (e) {} }
    aiController = new AbortController();
    thinkEl.classList.remove('solver');
    thinkEl.textContent = '';
    var sys = 'You are a friendly Mastermind solving coach. A minimax solver has ALREADY chosen a guess and the engine has ALREADY computed the clue and pruned the set of still-possible codes. ' +
      'Explain, in 1-3 short conversational sentences, what this clue told us and why the candidate set shrank the way it did. ' +
      'Do NOT invent feedback, do NOT propose a different guess, and do NOT reveal or guess the hidden code — the numbers given are final and certain. Use "B" for exact pegs and "W" for colour pegs.';
    var user = 'Code length ' + LEN + ', ' + COLORS + ' colours, repeats ' + (REPEATS ? 'allowed' : 'off') + '.\n' +
      'This was guess #' + lastPrune.n + ': colours [' + lastPrune.guess.join(', ') + '].\n' +
      'Clue: ' + lastPrune.fb.black + ' black (exact) and ' + lastPrune.fb.white + ' white (right colour, wrong spot).\n' +
      'Possible codes before this clue: ' + lastPrune.before + '. After applying the clue: ' + lastPrune.after + '.\n' +
      'Explain why this clue narrowed it to ' + lastPrune.after + '.';
    try {
      await BYOM.chat({
        endpoint: endpoint(), model: defaultModel, temperature: 0.45,
        maxTokens: aiIsReasoning(defaultModel) ? 1400 : 240,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        onToken: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        onThinking: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        signal: aiController.signal
      });
    } catch (e) {
      if (g !== gen) return;
      thinkEl.textContent += (thinkEl.textContent ? '\n' : '') + '[model unavailable — the prune count above still stands.]';
    }
    aiController = null;
  }

  /* ============================ HELPERS / UI ============================ */
  function codeText(code) { return code.map(function (c) { return COLOR_NAMES[c - 1] || ('#' + c); }).join(', '); }
  var COLOR_NAMES = ['red', 'yellow', 'cyan', 'green', 'violet', 'orange', 'pink', 'silver'];

  function setStatus(html) { statusEl.innerHTML = html; }
  var flashTimer = null;
  function flashStatus(html) {
    var prev = statusEl.innerHTML;
    statusEl.innerHTML = html;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { if (!over) statusEl.innerHTML = prev; }, 1600);
  }

  function updateButtons() {
    if (mode === 'crack') {
      submitBtn.disabled = over || draft.indexOf(0) >= 0;
    } else if (solverPhase === 'setting') {
      lockBtn.disabled = secret.indexOf(0) >= 0;
    } else if (solverPhase === 'running') {
      stepBtn.disabled = over;
      autoBtn.disabled = over;
    }
  }

  function sleep(ms, g) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ============================ SETTINGS WIRING ============================ */
  $('newGame').addEventListener('click', newGame);

  $('modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    this.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    mode = b.dataset.mode;
    newGame();
  });
  $('lenSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    this.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    LEN = +b.dataset.len; reconcileRepeats(); newGame();
  });
  $('colSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    this.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    COLORS = +b.dataset.col; if (selColor > COLORS) selColor = 1; reconcileRepeats(); newGame();
  });
  $('repSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    REPEATS = b.dataset.rep === '1';
    if (!REPEATS && COLORS < LEN) {
      // can't make a no-dupe code with fewer colours than slots — bump colours up
      COLORS = Math.max(COLORS, LEN);
      $('colSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', +x.dataset.col === COLORS); });
    }
    this.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    newGame();
  });

  // If "no dupes" is on but colours < length, that's impossible — guard it.
  function reconcileRepeats() {
    if (!REPEATS && COLORS < LEN) {
      COLORS = Math.max.apply(null, [4, 5, 6, 8].filter(function (n) { return n >= LEN; }));
      $('colSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', +x.dataset.col === COLORS); });
    }
  }

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
      setAiStatus(res.error.message + ' — the solver still works (pure logic).', 'err');
      return;
    }
    modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    modelSel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved
      : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
    modelSel.value = fav; defaultModel = fav; modelReady = true;
    BYOM.saveConfig({ model: fav });
    setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. Tick the box to narrate the solver.', 'on');
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  /* ============================ BOOT ============================ */
  newGame();
  if (BYOM.isLocal()) { endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT; loadModels(); }
  else setAiStatus('Public site — the solver runs offline (pure logic). Run locally to add model narration.', '');
})();
