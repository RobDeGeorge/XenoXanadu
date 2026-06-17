/* ============================================================================
 *  XenoXanadu — Rock Paper Scissors — arena + predictor bot + BYOM opponent
 *  ----------------------------------------------------------------------------
 *  Classic RPS plus an optional Lizard-Spock variant. Two opponents:
 *    • Predictor bot — model-free, works everywhere. Humans are NOT random;
 *      this bot predicts your next throw from your history (recency-weighted
 *      frequency + order-1 & order-2 Markov, blended) and plays the counter,
 *      with a little randomness so it can't be hard-countered.
 *    • Your model    — a connected local model predicts your next throw and
 *      picks its throw, narrating the read to a panel. It only ever sees your
 *      PAST throws, never the current one. An unparseable reply (or an error)
 *      falls back to the predictor bot — same contract as the other AI games.
 * ========================================================================== */
(function () {
  'use strict';
  var BYOM = window.XenoBYOM;
  var $ = function (id) { return document.getElementById(id); };

  // move tables (Lizard-Spock is a superset; the classic subset uses the first 3)
  var EMOJI = { rock: '✊', paper: '✋', scissors: '✌️', lizard: '🦎', spock: '🖖' };
  var BEATS = {
    rock:     ['scissors', 'lizard'],
    paper:    ['rock', 'spock'],
    scissors: ['paper', 'lizard'],
    lizard:   ['spock', 'paper'],
    spock:    ['scissors', 'rock']
  };
  var SETS = { classic: ['rock', 'paper', 'scissors'], lsp: ['rock', 'paper', 'scissors', 'lizard', 'spock'] };

  // ---- state ----
  var variant = 'classic', opponent = 'bot';
  var MOVES = SETS.classic;
  var scores = { you: 0, cpu: 0, draw: 0 };
  var history = [];          // player's past throws (this match)
  var streak = 0;            // player win streak (negative = losing streak)
  var rounds = 0;
  var busy = false, gen = 0, aiController = null;

  // ---- AI connection ----
  var defaultModel = '', modelReady = false;
  var endpointEl = $('endpoint'), modelSel = $('modelSel'), thinkEl = $('aiThink');
  function endpoint() { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); }
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var aiUsable = function () { return BYOM.isLocal() && modelReady && defaultModel; };

  /* ============================ SETUP ============================ */
  function buildThrows() {
    var host = $('throws'); host.innerHTML = '';
    MOVES.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'throw'; b.dataset.move = m;
      b.innerHTML = '<span class="em">' + EMOJI[m] + '</span><span class="nm">' + m + '</span>';
      b.addEventListener('click', function () { play(m); });
      host.appendChild(b);
    });
  }

  $('variantSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    $('variantSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    variant = b.dataset.variant; MOVES = SETS[variant];
    buildThrows(); resetMatch();
  });
  $('oppSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    $('oppSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    opponent = b.dataset.opp;
    $('cpuLabel').textContent = opponent === 'model' ? (defaultModel || 'Model') : 'CPU';
    resetMatch();
  });
  $('newGame').addEventListener('click', resetMatch);

  function resetMatch() {
    gen++; busy = false;
    if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; }
    scores = { you: 0, cpu: 0, draw: 0 }; history = []; streak = 0; rounds = 0;
    renderScores();
    $('youHand').className = 'hand mine'; $('youHand').textContent = '✊';
    $('cpuHand').className = 'hand theirs'; $('cpuHand').textContent = '✊';
    setResult('Make your throw ▾', '');
    $('streak').textContent = '';
    $('throws').classList.remove('busy');
  }

  /* ============================ ROUND ============================ */
  async function play(myMove) {
    if (busy) return;
    busy = true; var g = ++gen;
    $('throws').classList.add('busy');

    // shake both hands while we (and maybe the model) decide
    var you = $('youHand'), cpu = $('cpuHand');
    you.className = 'hand mine shake'; you.textContent = '✊';
    cpu.className = 'hand theirs shake'; cpu.textContent = '✊';
    setResult('Rock… Paper… Scissors…', '');
    $('streak').textContent = '';

    // CPU decides from history ONLY (never sees myMove) — fair prediction
    var cpuMove;
    if (opponent === 'model' && aiUsable()) {
      var got = await Promise.all([modelMove(g), sleep(620)]);
      cpuMove = got[0] || predictorMove();      // fall back to the bot on a bad reply
    } else {
      cpuMove = predictorMove();
      await sleep(620);
    }
    if (g !== gen) return;     // a reset/replay happened mid-think

    // record AFTER deciding, so the next round can learn from this throw
    history.push(myMove);

    var outcome = judge(myMove, cpuMove);   // 'win' | 'lose' | 'tie' (from player's view)
    reveal(myMove, cpuMove, outcome);
    busy = false; $('throws').classList.remove('busy');
  }

  function reveal(myMove, cpuMove, outcome) {
    var you = $('youHand'), cpu = $('cpuHand');
    you.className = 'hand mine'; you.textContent = EMOJI[myMove];
    cpu.className = 'hand theirs'; cpu.textContent = EMOJI[cpuMove];
    rounds++;

    if (outcome === 'tie') {
      scores.draw++; streak = 0;
      you.classList.add('tie'); cpu.classList.add('tie');
      setResult('Draw — ' + cap(myMove) + ' ties ' + cap(cpuMove), 'tie');
    } else if (outcome === 'win') {
      scores.you++; streak = streak >= 0 ? streak + 1 : 1;
      you.classList.add('win'); cpu.classList.add('lose');
      setResult('You win! ' + cap(myMove) + ' ' + verb(myMove, cpuMove) + ' ' + cap(cpuMove), 'win');
    } else {
      scores.cpu++; streak = streak <= 0 ? streak - 1 : -1;
      you.classList.add('lose'); cpu.classList.add('win');
      setResult('CPU wins. ' + cap(cpuMove) + ' ' + verb(cpuMove, myMove) + ' ' + cap(myMove), 'lose');
    }
    renderScores(); renderStreak();
  }

  function judge(a, b) { if (a === b) return 'tie'; return BEATS[a].indexOf(b) >= 0 ? 'win' : 'lose'; }
  function verb(winner, loser) {
    return ({ rock: 'crushes', paper: 'covers', scissors: 'cuts', lizard: 'eats', spock: 'zaps' }[winner]) || 'beats';
    // (loser unused beyond flavour — the canonical RPSLS verbs vary; one per winner reads fine)
  }

  /* ============================ PREDICTOR BOT ============================ */
  // Predict the player's NEXT move, then play something that beats it.
  function predictorMove() {
    var predicted = predictPlayer();
    var counters = MOVES.filter(function (m) { return BEATS[m].indexOf(predicted) >= 0; });
    // 18% of the time, throw at random so a sharp human can't simply invert us
    if (!counters.length || Math.random() < 0.18) return MOVES[Math.floor(Math.random() * MOVES.length)];
    return counters[Math.floor(Math.random() * counters.length)];
  }

  function predictPlayer() {
    if (history.length < 2) return MOVES[Math.floor(Math.random() * MOVES.length)];
    var score = {}; MOVES.forEach(function (m) { score[m] = 0; });

    // recency-weighted frequency
    history.forEach(function (m, i) { score[m] += 0.5 + i / history.length; });

    // order-1 Markov: what usually follows the last move
    var last = history[history.length - 1];
    for (var i = 1; i < history.length; i++) if (history[i - 1] === last) score[history[i]] += 2.2;

    // order-2 Markov: what usually follows the last two moves
    if (history.length >= 3) {
      var l2 = history[history.length - 2] + ',' + last;
      for (var j = 2; j < history.length; j++) {
        if (history[j - 2] + ',' + history[j - 1] === l2) score[history[j]] += 3.4;
      }
    }

    var best = MOVES[0];
    MOVES.forEach(function (m) { if (score[m] > score[best]) best = m; });
    return best;
  }

  /* ============================ MODEL OPPONENT ============================ */
  // Returns a legal move string, or null on a bad/failed reply (caller falls back).
  async function modelMove(g) {
    if (aiController) { try { aiController.abort(); } catch (e) {} }
    aiController = new AbortController();
    thinkEl.textContent = '';
    var rulesTxt = variant === 'lsp'
      ? 'Moves: rock, paper, scissors, lizard, spock. Rock crushes scissors & lizard; paper covers rock & disproves spock; scissors cut paper & decapitate lizard; lizard eats paper & poisons spock; spock smashes scissors & vaporizes rock.'
      : 'Moves: rock, paper, scissors. Rock beats scissors, scissors beats paper, paper beats rock.';
    var sys = 'You are a cocky Rock-Paper-Scissors hustler. Read the human\'s past throws for a pattern, ' +
      'PREDICT their next throw, and play the move that BEATS your prediction. ' + rulesTxt +
      ' Keep it to one or two smug sentences of read, then end with a line exactly: THROW: <move>';
    var hist = history.length
      ? history.map(function (m, i) { return (i + 1) + '. ' + m; }).join('  ')
      : '(none yet — first throw of the match)';
    var tally = {}; MOVES.forEach(function (m) { tally[m] = 0; });
    history.forEach(function (m) { tally[m]++; });
    var user = 'The human\'s throws so far (oldest→newest): ' + hist + '\n' +
      'Counts: ' + MOVES.map(function (m) { return m + '=' + tally[m]; }).join(', ') + '\n' +
      'Predict their NEXT throw and counter it. Your legal moves: ' + MOVES.join(', ') + '.';
    var reply = '';
    try {
      reply = await BYOM.chat({
        endpoint: endpoint(), model: defaultModel, temperature: 0.8,
        maxTokens: aiIsReasoning(defaultModel) ? 1200 : 160,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        onToken: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        onThinking: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        signal: aiController.signal
      });
    } catch (e) {
      if (g === gen) thinkEl.textContent += (thinkEl.textContent ? '\n' : '') + '[model error — the predictor bot takes this round]';
      aiController = null; return null;
    }
    aiController = null;
    var m = (reply.toLowerCase().match(/throw:\s*(rock|paper|scissors|lizard|spock)/) || [])[1];
    if (m && MOVES.indexOf(m) >= 0) return m;
    // last-ditch: any legal move name mentioned
    for (var k = MOVES.length - 1; k >= 0; k--) if (reply.toLowerCase().indexOf(MOVES[k]) >= 0) return MOVES[k];
    return null;
  }

  /* ============================ RENDER ============================ */
  function renderScores() { $('scoreYou').textContent = scores.you; $('scoreDraw').textContent = scores.draw; $('scoreCpu').textContent = scores.cpu; }
  function renderStreak() {
    var s = '';
    if (streak >= 3) s = '🔥 ' + streak + '-win streak!';
    else if (streak <= -3) s = '❄️ ' + (-streak) + '-loss streak…';
    else if (rounds) s = 'Round ' + rounds + ' · win rate ' + Math.round(scores.you / rounds * 100) + '%';
    $('streak').textContent = s;
  }
  function setResult(text, cls) { $('result').className = 'result' + (cls ? ' ' + cls : ''); $('result').textContent = text; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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
      setAiStatus(res.error.message + ' — the predictor bot still plays offline.', 'err');
      return;
    }
    modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    modelSel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved
      : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
    modelSel.value = fav; defaultModel = fav; modelReady = true;
    BYOM.saveConfig({ model: fav });
    if (opponent === 'model') $('cpuLabel').textContent = fav;
    setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. Pick “Your model” to face it.', 'on');
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); if (opponent === 'model') $('cpuLabel').textContent = this.value; });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  /* ============================ BOOT ============================ */
  buildThrows();
  renderScores();
  if (BYOM.isLocal()) { endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT; loadModels(); }
  else setAiStatus('Public site — you face the offline predictor bot. Run locally to add a model rival.', '');
})();
