/* ============================================================================
 *  XenoXanadu — Hangman — UI + modes + AI
 *  ----------------------------------------------------------------------------
 *  Three modes:
 *   • 2p       — pass & play. One player types ANY word into a masked field
 *                (the other looks away), then hands the device over to guess.
 *   • ai-word  — a local model secretly picks a themed word; you guess it.
 *   • ai-guess — you type a word; the model guesses it letter by letter.
 *
 *  AI runs through the shared BYOM pipeline when a local model is connected;
 *  otherwise it falls back to a built-in word bank (picking) and a
 *  letter-frequency strategy (guessing), so every mode works offline too.
 * ========================================================================== */
(function () {
  'use strict';
  var BYOM = window.XenoBYOM, Words = window.HangmanWords;
  var $ = function (id) { return document.getElementById(id); };

  var MAX_WRONG = 6;
  var FREQ = 'ETAOINSHRDLCUMWFGYPBVKJXQZ'.split('');
  var ALPHA_ROWS = ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ'];

  // ---- setup state ----
  var mode = null;            // '2p' | 'ai-word' | 'ai-guess'
  var theme = 'mixed', diff = 'medium';
  var endpointEl = $('endpoint'), modelSel = $('modelSel');
  var defaultModel = '', modelReady = false;

  // ---- session / round state ----
  var word = '', hint = '';
  var guessed = {}, wrongCount = 0, status = 'playing';
  var setterName = '', guesserName = '';
  var scores = {};            // displayName -> wins
  var scoreNames = [];        // the two participants this session
  var gen = 0, controller = null, aiBusy = false, mercied = false;

  var endpoint = function () { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); };
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var U = function (s) { return s.toUpperCase(); };
  var isLetter = function (ch) { return ch >= 'A' && ch <= 'Z'; };

  function show(id) {
    ['setupScreen', 'entryScreen', 'gameScreen'].forEach(function (s) { $(s).classList.toggle('show', s === id); });
  }

  /* ============================ SETUP ============================ */
  // theme buttons from the word bank
  (function buildThemes() {
    var seg = $('themeSeg');
    seg.innerHTML = Words.THEMES.map(function (t, i) {
      return '<button type="button" data-theme="' + t.key + '"' + (i === 0 ? ' class="active"' : '') + '>' + (t.emoji ? t.emoji + ' ' : '') + t.label + '</button>';
    }).join('');
    seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; segPick(seg, b); theme = b.dataset.theme; });
  })();
  $('diffSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; segPick($('diffSeg'), b); diff = b.dataset.diff; });
  function segPick(seg, btn) { seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === btn); }); }

  document.querySelectorAll('.mode-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      mode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(function (b) { b.style.borderColor = b === btn ? 'var(--green)' : ''; });
      $('aiWordOpts').style.display = (mode === 'ai-word') ? 'flex' : 'none';
      $('nameOpts').style.display = (mode === '2p') ? 'flex' : 'none';
      var go = $('goBtn'); go.disabled = false;
      go.textContent = mode === '2p' ? 'Set the secret word ▸'
        : mode === 'ai-word' ? 'Start — the AI picks ▸' : 'Set a word for the AI ▸';
    });
  });

  $('goBtn').addEventListener('click', function () {
    gen++;
    scores = {}; mercied = false;
    if (mode === '2p') {
      var p1 = ($('p1name').value || 'Player 1').trim(), p2 = ($('p2name').value || 'Player 2').trim();
      setterName = p1; guesserName = p2; scoreNames = [p1, p2];
      openEntry();
    } else if (mode === 'ai-guess') {
      setterName = 'You'; guesserName = 'AI'; scoreNames = ['You', 'AI'];
      openEntry();
    } else { // ai-word
      setterName = 'AI'; guesserName = 'You'; scoreNames = ['You', 'AI'];
      startAiWordRound();
    }
  });

  /* ============================ SECURE ENTRY ============================ */
  var secretInput = $('secretInput'), eyeBtn = $('eyeBtn');
  function openEntry() {
    secretInput.value = ''; $('hintInput').value = ''; $('entryErr').textContent = '';
    secretInput.type = 'password';                 // truly masked
    eyeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.15em"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    $('lookawayWho').textContent = (mode === 'ai-guess') ? 'everyone (keep it from the AI!)' : guesserName;
    $('entryLabel').textContent = (mode === 'ai-guess') ? 'A word for the AI to crack' : 'Secret word or phrase';
    show('entryScreen');
    setTimeout(function () { secretInput.focus(); }, 50);
  }
  eyeBtn.addEventListener('click', function () {
    var showing = secretInput.type === 'text';
    secretInput.type = showing ? 'password' : 'text';
    eyeBtn.innerHTML = showing
      ? '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.15em"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.15em"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 13.4 13.4"/><path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-2.4 3.2"/><path d="M6.1 6.1A17 17 0 0 0 2 12s4 7 10 7a9.5 9.5 0 0 0 4-.9"/></svg>';
    secretInput.focus();
  });
  $('entryBackBtn').addEventListener('click', function () { gen++; show('setupScreen'); });
  $('lockBtn').addEventListener('click', lockInWord);
  secretInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') lockInWord(); });

  function lockInWord() {
    var raw = secretInput.value.trim();
    var letters = (raw.match(/[A-Za-z]/g) || []).length;
    if (!letters) { $('entryErr').textContent = 'Needs at least one letter.'; return; }
    if (raw.length > 40) { $('entryErr').textContent = 'A bit long — keep it under 40 characters.'; return; }
    if (!/^[A-Za-z][A-Za-z '\-]*$/.test(raw)) { $('entryErr').textContent = 'Only letters, spaces, hyphens and apostrophes.'; return; }
    word = raw; hint = $('hintInput').value.trim();
    secretInput.value = ''; // scrub it from the field immediately
    startRound();
  }

  /* ============================ AI WORD PICK ============================ */
  async function startAiWordRound() {
    mercied = false;
    var g = gen;
    if (aiUsable()) {
      try {
        var picked = await pickWordWithModel();
        if (g !== gen) return;
        if (picked) { word = picked.word; hint = picked.hint || ''; startRound(); return; }
      } catch (e) { /* fall through to bank */ }
      if (g !== gen) return;
    }
    var b = Words.pick(theme, diff);
    word = b.word; hint = b.hint; startRound();
  }

  async function pickWordWithModel() {
    var sys = 'You are the mischievous host of a game of Hangman. You secretly choose ONE word for the ' +
      'player to guess.';
    var diffDesc = diff === 'easy' ? 'a common, everyday word of about 4-6 letters'
      : diff === 'hard' ? 'a tricky or less common word, 9+ letters or with awkward letters'
      : 'a moderately common word of about 7-9 letters';
    var user = 'Theme: ' + Words.themeLabel(theme) + '. Pick ' + diffDesc + '. Use a single real English word, ' +
      'letters only (no spaces or proper nouns). Reply with EXACTLY two lines:\nWORD: <the word>\n' +
      'HINT: <a short clue that does NOT contain or spell the word>';
    var reply = await BYOM.chat({
      endpoint: endpoint(), model: defaultModel, temperature: 1.05, maxTokens: aiIsReasoning(defaultModel) ? 1200 : 120,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
    });
    var wm = reply.match(/WORD:\s*([A-Za-z]{3,15})/i);
    var hm = reply.match(/HINT:\s*(.+)/i);
    if (!wm) return null;
    var w = wm[1];
    // don't let the hint literally contain the answer
    var h = hm ? hm[1].trim().replace(new RegExp(w, 'ig'), '____') : 'No hint this time.';
    return { word: w, hint: h };
  }

  /* ============================ ROUND ============================ */
  function startRound() {
    guessed = {}; wrongCount = 0; status = 'playing'; mercied = false;
    $('overlay').classList.remove('show', 'win', 'lose');
    $('aiSays').textContent = ''; $('aiThink').textContent = '';
    $('modeLabel').textContent = mode === '2p' ? '2 Players' : mode === 'ai-word' ? 'vs AI (it picks)' : 'vs AI (it guesses)';
    $('guesserLabel').textContent = guesserName;
    var aiThinks = (mode === 'ai-guess');
    $('aiThinkWrap').style.display = aiThinks ? '' : 'none';
    renderHint(); renderWord(); renderKeyboard(); renderGallows();
    renderScoreboard();
    show('gameScreen');

    if (mode === 'ai-guess') { lockKeyboard(true); startAiGuessLoop(); }
    else { lockKeyboard(false); }
  }

  function renderHint() {
    var el = $('hintLine');
    if (hint) el.innerHTML = '<b>Hint:</b> ' + escapeHtml(hint);
    else el.textContent = '';
  }

  function renderWord() {
    var host = $('word'); host.innerHTML = '';
    for (var i = 0; i < word.length; i++) {
      var ch = word[i], up = U(ch);
      if (ch === ' ') { var g = document.createElement('span'); g.className = 'gap'; host.appendChild(g); continue; }
      var s = document.createElement('span'); s.className = 'slot';
      if (!isLetter(up)) { s.classList.add('punct'); s.textContent = ch; }
      else if (guessed[up]) { s.classList.add('filled'); s.textContent = up; }
      else if (status === 'lost') { s.classList.add('miss'); s.textContent = up; }
      else { s.textContent = ' '; }
      host.appendChild(s);
    }
  }

  function renderKeyboard() {
    var host = $('keyboard'); host.innerHTML = '';
    ALPHA_ROWS.forEach(function (row) {
      var r = document.createElement('div'); r.className = 'kb-row';
      row.split('').forEach(function (ch) {
        var b = document.createElement('button'); b.className = 'key'; b.textContent = ch; b.dataset.k = ch;
        if (guessed[ch]) { b.disabled = true; b.classList.add(U(word).indexOf(ch) >= 0 ? 'correct' : 'wrong'); }
        b.addEventListener('click', function () { humanGuess(ch); });
        r.appendChild(b);
      });
      host.appendChild(r);
    });
  }
  function lockKeyboard(locked) { $('keyboard').classList.toggle('locked', locked); }

  function renderGallows() {
    var svg = $('gallows');
    svg.querySelectorAll('.part').forEach(function (p) {
      p.classList.toggle('show', +p.dataset.part <= wrongCount);
    });
    svg.classList.toggle('dead', status === 'lost');
    $('livesLabel').textContent = MAX_WRONG - wrongCount;
  }

  function renderWrong() {
    var w = Object.keys(guessed).filter(function (ch) { return U(word).indexOf(ch) < 0; }).sort();
    $('wrongLetters').innerHTML = w.length ? 'Misses: <b>' + w.join(' ') + '</b>' : '';
  }

  /* ============================ GUESSING ============================ */
  function humanGuess(ch) {
    if (status !== 'playing' || guessed[ch] || $('keyboard').classList.contains('locked')) return;
    applyGuess(ch, /*byHuman*/ true);
  }

  function applyGuess(ch, byHuman) {
    ch = U(ch);
    if (status !== 'playing' || guessed[ch] || !isLetter(ch)) return false;
    guessed[ch] = true;
    var hit = U(word).indexOf(ch) >= 0;
    if (!hit) wrongCount++;
    renderWord(); renderKeyboard(); renderGallows(); renderWrong();

    if (mode === 'ai-word') {
      $('aiSays').textContent = hit ? pickLine(SAY.hostHit) : pickLine(SAY.hostMiss);
      // mercy: one free letter when down to the last guess
      if (!hit && wrongCount === MAX_WRONG - 1 && !mercied) maybeMercy();
    }
    checkEnd();
    return hit;
  }

  function maybeMercy() {
    var hidden = [];
    for (var i = 0; i < word.length; i++) { var u = U(word[i]); if (isLetter(u) && !guessed[u] && hidden.indexOf(u) < 0) hidden.push(u); }
    if (!hidden.length) return;
    mercied = true;
    var give = hidden[Math.floor(Math.random() * hidden.length)];
    setTimeout(function () {
      if (status !== 'playing') return;
      $(‘aiSays’).textContent = ‘You\’re sweating — here, have a ‘’ + give + ‘’.’;
      guessed[give] = true;
      renderWord(); renderKeyboard(); renderWrong();
      checkEnd();
    }, 650);
  }

  function isSolved() {
    for (var i = 0; i < word.length; i++) { var u = U(word[i]); if (isLetter(u) && !guessed[u]) return false; }
    return true;
  }

  function checkEnd() {
    if (status !== 'playing') return;
    if (isSolved()) { status = 'won'; endRound(true); }
    else if (wrongCount >= MAX_WRONG) { status = 'lost'; renderWord(); renderGallows(); endRound(false); }
  }

  // guesserWon = the word was cracked
  function endRound(guesserWon) {
    lockKeyboard(true);
    var winnerName = guesserWon ? guesserName : setterName;
    scores[winnerName] = (scores[winnerName] || 0) + 1;
    renderScoreboard();
    aiBusy = false; if (controller) { try { controller.abort(); } catch (e) {} controller = null; }

    var ov = $('overlay'), title, body;
    if (mode === 'ai-guess') {
      // guesser is the AI
      if (guesserWon) { title = 'Cracked it!'; body = 'The AI guessed your word with ' + (MAX_WRONG - wrongCount) + ' guess(es) to spare.'; }
      else { title = 'You stumped it!'; body = 'The AI ran out of guesses. Nicely hidden.'; }
      ov.classList.add(guesserWon ? 'lose' : 'win');
    } else {
      if (guesserWon) { title = guesserName + ' got it!'; body = mode === 'ai-word' ? pickLine(SAY.hostLose) : 'Guessed with ' + (MAX_WRONG - wrongCount) + ' to spare.'; ov.classList.add('win'); }
      else { title = 'The little guy swings'; body = mode === 'ai-word' ? pickLine(SAY.hostWin) : setterName + ' wins this round.'; ov.classList.add('lose'); }
    }
    $('ovTitle').textContent = title;
    $('ovBody').textContent = body;
    $('ovReveal').textContent = 'The word: ' + word.toUpperCase();
    buildOverlayControls();
    setTimeout(function () { ov.classList.add('show'); }, 500);
  }

  function buildOverlayControls() {
    var c = $('ovControls'); c.innerHTML = '';
    var again = mkBtn('btn-primary', mode === '2p' ? 'Same roles ▸' : 'Play again ▸', function () {
      $('overlay').classList.remove('show', 'win', 'lose'); nextRound(false);
    });
    c.appendChild(again);
    if (mode === '2p') {
      c.appendChild(mkBtn('btn-ghost', 'Swap roles', function () {
        $('overlay').classList.remove('show', 'win', 'lose'); nextRound(true);
      }));
    }
    c.appendChild(mkBtn('btn-ghost', 'Menu', function () { gen++; $('overlay').classList.remove('show', 'win', 'lose'); show('setupScreen'); }));
  }

  function nextRound(swap) {
    gen++;
    if (mode === '2p' && swap) { var tmp = setterName; setterName = guesserName; guesserName = tmp; }
    if (mode === 'ai-word') startAiWordRound();
    else openEntry();          // 2p & ai-guess: someone types a fresh word
  }

  /* ============================ AI GUESSER ============================ */
  async function startAiGuessLoop() {
    aiBusy = true;
    var g = gen;
    while (status === 'playing' && g === gen) {
      $('aiThinkTitle').textContent = aiUsable() ? 'AI is thinking…' : 'AI (offline) is thinking…';
      var ch = await nextAiGuess(g);
      if (g !== gen || status !== 'playing') return;
      $('aiSays').textContent = 'Trying ‘' + ch + '’…';
      await sleep(450, g); if (g !== gen) return;
      var hit = applyGuess(ch, false);
      if (status !== 'playing') return;
      $('aiSays').textContent = hit ? 'Aha — ‘' + ch + '’ is in there.' : '‘' + ch + '’? No…';
      await sleep(700, g); if (g !== gen) return;
    }
  }

  async function nextAiGuess(g) {
    if (aiUsable()) {
      try {
        var ch = await guessWithModel(g);
        if (ch && isLetter(ch) && !guessed[ch]) return ch;
      } catch (e) { $('aiThink').textContent += '\n[model error — using letter frequency]'; }
    }
    return freqGuess();
  }

  function freqGuess() {
    for (var i = 0; i < FREQ.length; i++) if (!guessed[FREQ[i]]) return FREQ[i];
    return 'E';
  }

  async function guessWithModel(g) {
    var pattern = word.split('').map(function (ch) {
      var u = U(ch); if (ch === ' ') return ' / '; if (!isLetter(u)) return ch; return guessed[u] ? u : '_';
    }).join(' ');
    var inWord = Object.keys(guessed).filter(function (c) { return U(word).indexOf(c) >= 0; }).sort();
    var notIn = Object.keys(guessed).filter(function (c) { return U(word).indexOf(c) < 0; }).sort();
    var sys = 'You are playing Hangman as the guesser, and you are clever about it. You pick the single ' +
      'most likely letter you have NOT already guessed, using letter frequency and word shape.';
    var user = 'Pattern (underscores are unknown letters): ' + pattern + '\n' +
      'Confirmed letters in the word: ' + (inWord.join(' ') || '(none yet)') + '\n' +
      'Letters NOT in the word: ' + (notIn.join(' ') || '(none yet)') + '\n' +
      'Already guessed: ' + (Object.keys(guessed).sort().join(' ') || '(none)') + '\n' +
      'Give one brief sentence of reasoning, then a final line exactly:\nGUESS: <a single new letter>';
    controller = new AbortController();
    $('aiThink').textContent = '';
    var reply = await BYOM.chat({
      endpoint: endpoint(), model: defaultModel, temperature: 0.5, maxTokens: aiIsReasoning(defaultModel) ? 1200 : 160,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      onToken: function (d) { if (g === gen) { $('aiThink').textContent += d; $('aiThink').scrollTop = $('aiThink').scrollHeight; } },
      onThinking: function (d) { if (g === gen) { $('aiThink').textContent += d; $('aiThink').scrollTop = $('aiThink').scrollHeight; } },
      signal: controller.signal
    });
    controller = null;
    var m = reply.toUpperCase().match(/GUESS:\s*([A-Z])/);
    if (m) return m[1];
    var any = reply.toUpperCase().match(/[A-Z]/g) || [];   // last-ditch: a letter we haven't used
    for (var i = any.length - 1; i >= 0; i--) if (!guessed[any[i]]) return any[i];
    return null;
  }

  /* ============================ scoreboard ============================ */
  function renderScoreboard() {
    var host = $('scoreboard');
    if (!scoreNames.length) { host.style.display = 'none'; return; }
    host.style.display = 'flex';
    host.innerHTML = scoreNames.map(function (n) {
      return '<div class="score-chip"><div class="nm">' + escapeHtml(n) + '</div><div class="sc">' + (scores[n] || 0) + '</div></div>';
    }).join('');
  }

  /* ============================ AI connection ============================ */
  function setAiStatus(text, state) { $('aiStatus').textContent = text; $('aiDot').className = 'ai-dot' + (state ? ' ' + state : ''); }
  function aiUsable() { return BYOM.isLocal() && modelReady && defaultModel; }

  async function loadModels() {
    if (!BYOM.isLocal()) return;
    BYOM.saveConfig({ endpoint: endpoint() });
    modelSel.disabled = true; modelSel.innerHTML = '<option>loading…</option>'; modelReady = false;
    var saved = BYOM.loadConfig().model;
    var res = await BYOM.test({ endpoint: endpoint() });
    if (!res.ok) {
      modelSel.innerHTML = '<option value="">— not reachable —</option>';
      setAiStatus(res.error.message + ' — vs-AI still works offline (word bank + frequency guesser).', 'err');
      return;
    }
    modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    modelSel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved
      : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
    modelSel.value = fav; defaultModel = fav; modelReady = true;
    BYOM.saveConfig({ model: fav });
    setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. The AI will use your model.', 'on');
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  /* ============================ misc ============================ */
  $('menuBtn').addEventListener('click', function () { gen++; aiBusy = false; if (controller) { try { controller.abort(); } catch (e) {} } show('setupScreen'); });

  // physical keyboard for the human guesser
  document.addEventListener('keydown', function (e) {
    if (!$('gameScreen').classList.contains('show')) return;
    if (mode === 'ai-guess') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var ch = e.key.length === 1 ? U(e.key) : '';
    if (isLetter(ch)) humanGuess(ch);
  });

  function mkBtn(cls, label, fn) { var b = document.createElement('button'); b.className = cls; b.textContent = label; b.addEventListener('click', fn); return b; }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pickLine(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function sleep(ms, g) { return new Promise(function (res) { setTimeout(function () { res(); }, ms); }); }

  var SAY = {
    hostHit: ['Hmph. Lucky.', '…fine, that one\'s in there.', 'Oh, you\'re good.', 'Tch. Yes.', 'A hit. Don\'t get cocky.'],
    hostMiss: ['Nope!', 'Not even close.', 'Wrong — tick, tick…', 'Heh. No.', 'The rope tightens…'],
    hostWin: ['Mwahaha! Better luck next time.', 'The gallows claim another.', 'Too tough for you, hm?'],
    hostLose: ['Bah, you got it. This time.', 'Fine, fine — well guessed.', 'You win this round. I\'ll get you next time.']
  };

  // boot: connect to a local model if we're served locally
  if (BYOM.isLocal()) { endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT; loadModels(); }
  else setAiStatus('Public site — vs-AI runs offline (built-in words + frequency guesser). Run locally to use your own model.', '');
})();
