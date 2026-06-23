/* ============================================================================
 *  XenoXanadu — Texas Hold'em — table UI + AI orchestration
 *  ----------------------------------------------------------------------------
 *  Drives the pure engine (engine.js), renders the felt, runs the human's
 *  action bar, and lets a local model play the AI seats via the shared BYOM
 *  pipeline. Each AI seat is a random persona (personalities.js); a single
 *  model fills them all, or you can assign different models per seat.
 *
 *  No model connected (e.g. the hosted site, or before you connect one)? The
 *  AI seats fall back to a persona-weighted heuristic, so the game is fully
 *  playable offline — the local LLM is an enhancement, not a requirement.
 * ========================================================================== */
(function () {
  'use strict';
  var P = window.Poker, Pers = window.PokerPersonas, BYOM = window.XenoBYOM;

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var felt = $('felt'), boardEl = $('board'), potLabel = $('potLabel'),
      logEl = $('log'), aiThink = $('aiThink'), thinkTitle = $('thinkTitle'),
      actionbar = $('actionbar'), overlay = $('overlay');

  // ---- setup state ----
  var mode = 'play';          // 'play' | 'spectate'
  var seatCount = 6;
  var startStack = 5000;
  var speed = 650;
  var endpointEl = $('endpoint'), modelSel = $('modelSel');
  var defaultModel = '', modelReady = false, availableModels = [];
  var seatModelChoice = {};   // ai-ordinal -> model name ('' = use default)

  // ---- live state ----
  var t = null;               // tournament
  var seatEls = [], betEls = [], dealerBtn = null;
  var seatPos = [];
  var humanSeat = -1;
  var gen = 0;                // bumps to cancel any in-flight async/timeouts
  var controller = null;
  var lastAct = {};           // seat -> short action text
  var winners = null;         // Set of winning seats during a result
  var revealAll = false;      // spectate mode shows every hand
  var uiStreet = '';

  var endpoint = function () { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); };
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var fmt = function (n) { return n.toLocaleString('en-US'); };
  // a small poker-chip "monogram" disc that replaces emojis for each character
  var monogram = function (tag, hue, cls) {
    return '<span class="mono-chip ' + (cls || 'em') + '" style="--mhue:' + (hue == null ? 150 : hue) +
      '">' + (tag || '?') + '</span>';
  };

  /* ============================ SETUP UI ============================ */
  function wireSeg(id, attr, cb) {
    var c = $(id);
    c.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      c.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
      cb(b.getAttribute(attr));
    });
  }
  wireSeg('modeSeg', 'data-mode', function (v) { mode = v; rebuildSeatModels(); });
  wireSeg('seatSeg', 'data-seats', function (v) { seatCount = +v; rebuildSeatModels(); });
  wireSeg('speedSeg', 'data-speed', function (v) { speed = +v; });
  $('stackSel').addEventListener('change', function () { startStack = +this.value; });

  $('perSeatToggle').addEventListener('click', function () {
    var box = $('seatModels'); box.classList.toggle('show');
    this.textContent = box.classList.contains('show') ? 'Per-seat models ▴' : 'Per-seat models ▾';
  });

  // Render the full cast of personas on the setup screen so players can see
  // who they might face. Pulls straight from personalities.js — no duplication.
  function renderRoster() {
    var host = $('roster'); if (!host || !Pers) return;
    var list = Pers.PERSONAS || [];
    var countEl = $('rosterCount'); if (countEl) countEl.textContent = '· ' + list.length + ' characters';
    var bar = function (label, key, v) {
      return '<div class="pc-bar"><span class="pc-lab">' + label + '</span>' +
        '<span class="pc-track"><span class="pc-fill ' + key + '" style="width:' +
        Math.round(v * 100) + '%"></span></span></div>';
    };
    host.innerHTML = list.map(function (p) {
      return '<div class="persona-card" title="' + p.style.replace(/"/g, '&quot;') + '">' +
        '<div class="pc-head">' + monogram(p.tag, p.hue, 'pc-em') +
        '<span class="pc-name">' + p.name + '</span></div>' +
        '<div class="pc-blurb">' + p.blurb + '</div>' +
        '<div class="pc-bars">' +
          bar('Tight', 'tight', p.tight) +
          bar('Aggro', 'aggression', p.aggression) +
          bar('Bluff', 'bluff', p.bluff) +
        '</div></div>';
    }).join('');
  }

  function aiSeatCount() { return seatCount - (mode === 'play' ? 1 : 0); }

  function rebuildSeatModels() {
    var box = $('seatModels'); box.innerHTML = '';
    var n = aiSeatCount();
    for (var k = 0; k < n; k++) {
      var row = document.createElement('div');
      row.className = 'seat-model-row';
      var opts = '<option value="">— default model —</option>' +
        availableModels.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
      row.innerHTML = '<span class="who">Opponent #' + (k + 1) + '</span>' +
        '<select data-ord="' + k + '">' + opts + '</select>';
      box.appendChild(row);
      var sel = row.querySelector('select');
      if (seatModelChoice[k]) sel.value = seatModelChoice[k];
      sel.addEventListener('change', function () { seatModelChoice[+this.dataset.ord] = this.value; });
    }
  }

  function setAiStatus(text, state) {
    $('aiStatus').textContent = text;
    $('aiDot').className = 'ai-dot' + (state ? ' ' + state : '');
  }

  async function loadModels() {
    if (!BYOM.isLocal()) { return; }
    BYOM.saveConfig({ endpoint: endpoint() });
    modelSel.disabled = true; modelSel.innerHTML = '<option>loading…</option>';
    modelReady = false;
    var saved = BYOM.loadConfig().model;
    var res = await BYOM.test({ endpoint: endpoint() });
    if (!res.ok) {
      modelSel.innerHTML = '<option value="">— model not reachable —</option>';
      availableModels = []; rebuildSeatModels();
      setAiStatus(res.error.message + ' — the bots will play offline (heuristic) until a model connects.', 'err');
      return;
    }
    availableModels = res.models;
    modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    modelSel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved
      : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
    modelSel.value = fav; defaultModel = fav; modelReady = true;
    BYOM.saveConfig({ model: fav });
    rebuildSeatModels();
    setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. AI seats will be LLM-driven.', 'on');
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  function aiReady() { return BYOM.isLocal() && modelReady && defaultModel; }
  function modelForSeat(seat) {
    if (!aiReady()) return null;
    return seat.modelOverride || defaultModel;
  }

  /* ============================ TABLE BUILD ============================ */
  $('startBtn').addEventListener('click', startTable);
  $('newTable').addEventListener('click', leaveTable);

  function startTable() {
    gen++;
    var defs = [], aiDefs = Pers.assign(aiSeatCount());
    if (mode === 'play') {
      humanSeat = 0;
      defs.push({ name: 'You', isHuman: true, tag: 'ME', hue: 135 });
      for (var k = 0; k < aiDefs.length; k++) {
        defs.push({
          name: aiDefs[k].displayName, isAI: true, persona: aiDefs[k].persona,
          tag: aiDefs[k].tag, hue: aiDefs[k].hue, modelOverride: seatModelChoice[k] || null
        });
      }
    } else {
      humanSeat = 0;
      for (var j = 0; j < aiDefs.length; j++) {
        defs.push({
          name: aiDefs[j].displayName, isAI: true, persona: aiDefs[j].persona,
          tag: aiDefs[j].tag, hue: aiDefs[j].hue, modelOverride: seatModelChoice[j] || null
        });
      }
    }
    revealAll = (mode === 'spectate');
    t = P.createTournament(defs, { startingStack: startStack, handsPerLevel: 8 });

    $('setup').style.display = 'none';
    $('stage').classList.add('show');
    thinkTitle.textContent = aiReady() ? 'AI table-talk (live model)' : 'AI table-talk (offline bots)';
    aiThink.textContent = aiReady()
      ? 'The reasoning of whichever AI is on the action streams here…'
      : 'No model connected — the AI seats are playing a persona-weighted heuristic. Connect a model for LLM-driven play.';
    logEl.innerHTML = '';
    buildSeatElements();
    log('<span class="street">Tournament begins — ' + defs.length + ' players, ' + fmt(startStack) + ' chips each.</span>');
    newHand();
  }

  function leaveTable() {
    gen++;
    if (controller) { try { controller.abort(); } catch (e) {} controller = null; }
    t = null;
    overlay.classList.remove('show');
    actionbar.classList.remove('show');
    $('stage').classList.remove('show');
    $('setup').style.display = '';
  }

  function buildSeatElements() {
    // clear old seat/bet/dealer nodes
    felt.querySelectorAll('.seat, .bet-chip, .dealer-btn').forEach(function (n) { n.remove(); });
    seatEls = []; betEls = [];
    var n = t.seats.length;
    seatPos = layout(n, humanSeat);
    for (var i = 0; i < n; i++) {
      var s = t.seats[i];
      var seat = document.createElement('div');
      seat.className = 'seat' + (s.isHuman ? ' human' : '');
      seat.style.left = seatPos[i].x + '%'; seat.style.top = seatPos[i].y + '%';
      seat.innerHTML =
        '<div class="holecards"></div>' +
        '<div class="nameplate">' +
          '<span class="badge" style="display:none"></span>' +
          '<div class="who">' + monogram(s.tag, s.hue, 'em') + '<span class="nm"></span></div>' +
          '<div class="persona"></div>' +
          '<div class="chips"></div>' +
        '</div>';
      seat.querySelector('.nm').textContent = s.name;
      seat.querySelector('.persona').textContent = s.persona ? s.persona.name : (s.isHuman ? 'that\'s you' : '');
      felt.appendChild(seat);
      seatEls.push(seat);

      var bet = document.createElement('div');
      bet.className = 'bet-chip'; bet.style.left = seatPos[i].bx + '%'; bet.style.top = seatPos[i].by + '%';
      bet.style.display = 'none';
      felt.appendChild(bet); betEls.push(bet);
    }
    dealerBtn = document.createElement('div');
    dealerBtn.className = 'dealer-btn'; dealerBtn.textContent = 'D'; dealerBtn.style.display = 'none';
    felt.appendChild(dealerBtn);
  }

  function layout(n, human) {
    var pos = [];
    for (var i = 0; i < n; i++) {
      var slot = (i - human + n) % n;                 // human at the bottom
      var ang = (90 + slot * 360 / n) * Math.PI / 180;
      pos.push({
        x: 50 + 47 * Math.cos(ang), y: 50 + 45 * Math.sin(ang),
        bx: 50 + 28 * Math.cos(ang), by: 50 + 27 * Math.sin(ang),
        dx: 50 + 35 * Math.cos(ang + 0.22), dy: 50 + 34 * Math.sin(ang + 0.22)
      });
    }
    return pos;
  }

  /* ============================ RENDER ============================ */
  function cardEl(card, faceDown, dealt) {
    var d = document.createElement('div');
    d.className = 'card' + (faceDown ? ' back' : '') + (dealt ? ' dealt' : '');
    if (!faceDown && card) {
      if (card.s === 'h' || card.s === 'd') d.classList.add('red');
      d.innerHTML = '<span class="rk">' + P.rankChar(card.r) + '</span><span class="st">' + P.suitSym(card.s) + '</span>';
    }
    return d;
  }

  function renderBoard(h) {
    var have = boardEl.children.length;
    if (h.board.length < have) { boardEl.innerHTML = ''; have = 0; }   // new hand reset
    for (var k = have; k < h.board.length; k++) {
      var el = cardEl(h.board[k], false, false);
      el.classList.add('dealing');
      el.style.animationDelay = ((k - have) * 0.13) + 's';            // stagger the flop's 3
      boardEl.appendChild(el);
    }
  }

  function shouldReveal(i) {
    var h = t.hand, s = t.seats[i];
    if (!h.hole[i]) return false;
    if (revealAll) return true;
    if (s.isHuman) return true;
    if (h.complete && h.result && h.result.showdown && h.inHand[i]) return true; // showdown
    return false;
  }

  function render(dealAnim) {
    if (!t) return;
    var h = t.hand;
    // HUD
    var lvl = P.level(t);
    $('hudBlinds').textContent = fmt(lvl.sb) + ' / ' + fmt(lvl.bb);
    $('hudLevel').textContent = (t.level + 1);
    $('hudHand').textContent = t.handNum;
    $('hudAlive').textContent = P.aliveCount(t);

    // board — append only the newly-dealt cards so each street pitches out
    // onto the felt one card at a time (and existing cards don't re-animate)
    renderBoard(h);
    potLabel.innerHTML = 'Pot: <b>' + fmt(h.pot) + '</b>';

    // seats
    for (var i = 0; i < t.seats.length; i++) {
      var s = t.seats[i], seat = seatEls[i];
      var hc = seat.querySelector('.holecards'); hc.innerHTML = '';
      if (h.hole[i]) {
        var reveal = shouldReveal(i);
        hc.appendChild(cardEl(h.hole[i][0], !reveal, dealAnim));
        hc.appendChild(cardEl(h.hole[i][1], !reveal, dealAnim));
      }
      var chipsEl = seat.querySelector('.chips');
      chipsEl.textContent = fmt(s.chips);
      chipsEl.classList.toggle('lowstack', s.chips > 0 && s.chips < lvl.bb * 5);

      seat.classList.toggle('active', !h.complete && h.toAct === i);
      seat.classList.toggle('folded', h.hole[i] && !h.inHand[i]);
      seat.classList.toggle('busted', s.chips <= 0 && !h.inHand[i]);

      // badge
      var badge = seat.querySelector('.badge');
      var txt = '', cls = 'badge';
      if (winners && winners.has(i)) { txt = 'WIN'; cls += ' win'; }
      else if (h.hole[i] && !h.inHand[i]) { txt = 'Fold'; cls += ' fold'; }
      else if (h.allIn[i]) { txt = 'All-in'; cls += ' allin'; }
      else if (lastAct[i]) { txt = lastAct[i]; cls += ' action'; }
      else if (!h.complete && h.toAct === i && t.seats[i].isAI) { txt = 'thinking'; cls += ' action'; }
      if (txt) {
        badge.style.display = '';
        badge.className = cls;
        badge.innerHTML = (txt === 'thinking') ? '<span class="thinking">thinks</span>' : txt;
      } else badge.style.display = 'none';

      // bet chip
      var bet = betEls[i];
      if (h.streetBet[i] > 0 && !h.complete) { bet.style.display = ''; bet.textContent = fmt(h.streetBet[i]); }
      else bet.style.display = 'none';
    }

    // dealer button
    if (t.button != null && seatPos[t.button]) {
      dealerBtn.style.display = ''; dealerBtn.style.left = seatPos[t.button].dx + '%'; dealerBtn.style.top = seatPos[t.button].dy + '%';
    }
  }

  /* ============================ GAME LOOP ============================ */
  function scheduleLoop(d) { var g = gen; setTimeout(function () { if (g === gen) loop(); }, d); }

  function newHand() {
    if (P.aliveCount(t) < 2) { gameOver(); return; }
    lastAct = {}; winners = null; uiStreet = '';
    P.startHand(t);
    var lvl = P.level(t);
    log('<span class="street">— Hand ' + t.handNum + ' · blinds ' + fmt(lvl.sb) + '/' + fmt(lvl.bb) + ' —</span>');
    var sbName = t.seats[t.hand.sb].name, bbName = t.seats[t.hand.bb].name;
    log(sbName + ' posts SB ' + fmt(Math.min(lvl.sb, t.hand.committed[t.hand.sb])) + ', ' + bbName + ' posts BB ' + fmt(t.hand.committed[t.hand.bb]) + '.');
    render(true);
    scheduleLoop(Math.max(700, speed * 1.4));   // let players see their cards
  }

  function loop() {
    if (!t) return;
    if (t.over) { gameOver(); return; }
    var h = t.hand;
    var dealt = syncStreetLog();
    if (h.complete) { doResolve(); return; }
    if (h.toAct < 0) {                 // all-in run-out — reveal the next street
      P.runoutStep(t); render();
      scheduleLoop(Math.max(750, speed * 1.5));   // time for the card(s) to pitch out
      return;
    }
    render();
    if (dealt) { scheduleLoop(Math.max(560, speed)); return; }   // let the new street land before anyone acts
    var seat = t.seats[h.toAct];
    if (seat.isHuman && mode === 'play') { showHumanControls(); return; }
    doAIMove();
  }

  function syncStreetLog() {
    var h = t.hand;
    if (h.street !== uiStreet && (h.street === 'flop' || h.street === 'turn' || h.street === 'river')) {
      uiStreet = h.street;
      lastAct = {};            // clear stale action chips on a new street
      log('<span class="street">' + h.street.toUpperCase() + ': ' + h.board.map(P.cardStr).join(' ') + '</span>');
      return true;
    }
    return false;
  }

  function doResolve() {
    var res = P.resolve(t);
    winners = new Set();
    res.pots.forEach(function (p) { p.winners.forEach(function (w) { winners.add(w); }); });
    render(false);
    // log outcome
    if (res.showdown) {
      Object.keys(res.hands).forEach(function (s) {
        if (t.hand.inHand[s]) log('<span class="hl">' + t.seats[s].name + '</span> shows ' +
          t.hand.hole[s].map(P.cardStr).join(' ') + ' — ' + res.hands[s].name + '.');
      });
    }
    res.pots.forEach(function (pot) {
      if (pot.refund) {
        log('<span class="win">' + pot.label + ' (' + fmt(pot.amount) + ') returned uncontested.</span>');
        return;
      }
      var names = pot.winners.map(function (w) { return t.seats[w].name; }).join(' & ');
      var each = Math.floor(pot.amount / pot.winners.length);
      log('<span class="win">' + names + ' ' + (pot.winners.length > 1 ? 'split ' : 'wins ') +
        pot.label.toLowerCase() + ' (' + fmt(pot.amount) + ')' +
        (pot.winners.length > 1 ? ' — ' + fmt(each) + ' each' : '') + '.</span>');
    });
    // note eliminations
    t.seats.forEach(function (s) { if (s.chips <= 0 && s._bustLogged !== true) { s._bustLogged = true; log('<span class="hl">' + s.name + '</span> busts out.'); } });

    var g = gen;
    setTimeout(function () { if (g !== gen) return; winners = null; newHand(); }, Math.max(1600, speed * 4));
  }

  function gameOver() {
    if (!t.winner && t.winner !== 0) return;
    actionbar.classList.remove('show');
    var champ = t.seats[t.winner];
    var places = t.finishOrder.slice().reverse();    // 1st place first
    var body = places.map(function (id, k) {
      return '<div>' + (k + 1) + '. ' + monogram(t.seats[id].tag, t.seats[id].hue) + ' ' + t.seats[id].name +
        (t.seats[id].persona ? ' <span class="muted">(' + t.seats[id].persona.name + ')</span>' : '') + '</div>';
    }).join('');
    $('ovTitle').innerHTML = monogram(champ.tag, champ.hue) + ' ' + champ.name + ' wins!';
    $('ovBody').innerHTML = body;
    var ctr = $('ovControls'); ctr.innerHTML = '';
    var again = document.createElement('button'); again.className = 'btn-primary'; again.textContent = 'New table';
    again.addEventListener('click', leaveTable);
    ctr.appendChild(again);
    overlay.classList.add('show');
    render(true);
  }

  /* ============================ AI ============================ */
  function buildBetOptions(la) {
    var opts = [{ label: 'Fold', act: { type: 'fold' } }];
    if (la.canCheck) opts.push({ label: 'Check', act: { type: 'check' } });
    else opts.push({ label: 'Call ' + fmt(la.callAmt), act: { type: 'call' } });
    if (la.canRaise) {
      var totals = [];
      var add = function (v) { v = Math.round(v); if (v > la.currentBet && v >= la.minRaiseTo && v < la.maxRaiseTo && totals.indexOf(v) < 0) totals.push(v); };
      add(la.minRaiseTo);
      add(la.currentBet + 0.5 * la.pot);
      add(la.currentBet + la.pot);
      totals.sort(function (a, b) { return a - b; });
      var verb = la.currentBet > 0 ? 'Raise to ' : 'Bet ';
      totals.forEach(function (v) { opts.push({ label: verb + fmt(v), act: { type: 'raise', amount: v } }); });
      opts.push({ label: 'All-in (' + fmt(la.maxRaiseTo) + ')', act: { type: 'allin' } });
    }
    return opts;
  }

  function buildMessages(seatIdx, la, opts) {
    var h = t.hand, seat = t.seats[seatIdx], persona = seat.persona;
    var hole = h.hole[seatIdx].map(P.cardStr).join(' ');
    var board = h.board.length ? h.board.map(P.cardStr).join(' ') : '(none — pre-flop)';
    var lvl = P.level(t);
    var rel = relPos(seatIdx);

    var others = [];
    for (var k = 0; k < t.seats.length; k++) {
      if (k === seatIdx || !h.hole[k]) continue;
      var st = !h.inHand[k] ? 'folded' : (h.allIn[k] ? 'all-in' : 'in');
      others.push(t.seats[k].name + ' (' + fmt(t.seats[k].chips) + ' chips' +
        (h.streetBet[k] > 0 ? ', has ' + fmt(h.streetBet[k]) + ' in this round' : '') + ') — ' + st);
    }

    var optLines = opts.map(function (o, i) { return (i + 1) + '. ' + o.label; }).join('\n');

    var system =
      'You are ' + seat.name + ', playing No-Limit Texas Hold\'em in a tournament. ' + persona.style + '\n' +
      'You will be told the situation and given a NUMBERED list of the only legal actions. ' +
      'Choose exactly ONE by its number — stay in character. ' +
      'Reply with at most one short sentence of reasoning or table talk, then a FINAL line exactly:\n' +
      'ACTION: <number>\nNothing after it.';

    var user =
      'Your hole cards: ' + hole + '\n' +
      'Community cards: ' + board + ' (' + h.street + ')\n' +
      'Your stack: ' + fmt(seat.chips) + ' chips. You are ' + rel + '. Blinds ' + fmt(lvl.sb) + '/' + fmt(lvl.bb) + '.\n' +
      'Pot: ' + fmt(la.pot) + '. ' +
      (la.canCheck ? 'You can check (no bet to call).' : 'It costs ' + fmt(la.callAmt) + ' to call.') + '\n' +
      'Other players:\n  ' + (others.join('\n  ') || '(none)') + '\n\n' +
      'Your legal actions:\n' + optLines + '\n\n' +
      'Pick the action that best fits your style and the situation, then give your ACTION: line.';

    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  function relPos(i) {
    var h = t.hand;
    if (i === h.button) return 'on the button (last to act)';
    if (i === h.sb) return 'in the small blind';
    if (i === h.bb) return 'in the big blind';
    return 'in middle/late position';
  }

  function parseAction(reply, opts) {
    var up = reply.toUpperCase();
    var idx = up.lastIndexOf('ACTION:');
    var seg = idx >= 0 ? reply.slice(idx + 7) : reply;
    var m = seg.match(/-?\d+/);
    if (m) { var k = +m[0] - 1; if (k >= 0 && k < opts.length) return opts[k].act; }
    // loose keyword fallback
    if (/\bALL[\s-]?IN\b/.test(up)) return optByType(opts, 'allin') || { type: 'allin' };
    if (/\bFOLD\b/.test(up)) return { type: 'fold' };
    if (/\bCHECK\b/.test(up)) return optByType(opts, 'check');
    if (/\bCALL\b/.test(up)) return optByType(opts, 'call');
    return null;
  }
  function optByType(opts, type) { for (var i = 0; i < opts.length; i++) if (opts[i].act.type === type) return opts[i].act; return null; }

  // persona-weighted heuristic — used when no model is connected or a reply
  // can't be parsed. Keeps the table playable and roughly in-character.
  function heuristicAction(la, persona) {
    var rnd = Math.random();
    if (la.canCheck) {
      // free to check; sometimes take initiative
      if (la.canRaise && rnd < persona.aggression * 0.45 + persona.bluff * 0.15)
        return { type: 'raise', amount: Math.round(la.currentBet + (0.5 + Math.random() * 0.6) * la.pot) || la.minRaiseTo };
      return { type: 'check' };
    }
    // facing a bet — crude pot-odds gate softened by looseness
    var price = la.callAmt / (la.pot + la.callAmt);          // 0..1, higher = worse price
    var looseness = 1 - persona.tight;
    var playChance = 0.18 + looseness * 0.7 - price * 0.5;
    if (Math.random() > playChance) return { type: 'fold' };
    // occasionally raise / shove for value or as a bluff
    if (la.canRaise && Math.random() < persona.aggression * 0.3) {
      if (Math.random() < persona.aggression * 0.25) return { type: 'allin' };
      return { type: 'raise', amount: Math.round(la.currentBet + (0.5 + Math.random()) * la.pot) || la.minRaiseTo };
    }
    return { type: 'call' };
  }

  function setThinking(seat) {
    thinkTitle.textContent = (aiReady() ? '' : '⦿ offline · ') + seat.name + (seat.persona ? ' · ' + seat.persona.name : '');
    aiThink.textContent = '';
  }
  function think(txt) { aiThink.textContent += txt; aiThink.scrollTop = aiThink.scrollHeight; }

  async function doAIMove() {
    var h = t.hand, i = h.toAct, seat = t.seats[i], g = gen;
    var la = P.legalActions(t); if (!la) { scheduleLoop(speed); return; }
    var opts = buildBetOptions(la);
    setThinking(seat);
    render();

    var model = modelForSeat(seat);
    var act = null;

    if (model) {
      controller = new AbortController();
      var reply = '';
      try {
        reply = await BYOM.chat({
          endpoint: endpoint(), model: model, messages: buildMessages(i, la, opts),
          temperature: 0.8, maxTokens: aiIsReasoning(model) ? 2048 : 400,
          onToken: function (d) { if (g === gen) think(d); },
          onThinking: function (d) { if (g === gen) think(d); },
          signal: controller.signal
        });
      } catch (e) {
        if (g !== gen) return;
        think('\n\n[model error: ' + e.message + ' — playing a sensible default]');
      }
      controller = null;
      if (g !== gen) return;
      act = parseAction(reply, opts);
      if (!act) { act = heuristicAction(la, seat.persona); think('\n\n[couldn\'t read an ACTION: line — defaulted to ' + act.type + ']'); }
      applyAndContinue(i, act, la, g);
    } else {
      // offline bot: brief beat for readability, then act
      var note = seat.persona ? seat.persona.blurb : '';
      think(note);
      setTimeout(function () {
        if (g !== gen) return;
        applyAndContinue(i, heuristicAction(la, seat.persona), la, g);
      }, Math.max(400, speed * 0.8) + Math.random() * 250);
    }
  }

  function applyAndContinue(i, act, la, g) {
    if (g !== gen || !t || t.hand.toAct !== i) return;
    var ev = P.applyAction(t, act);
    recordAction(i, ev, la);
    render();
    scheduleLoop(Math.max(380, speed * 0.7));
  }

  function recordAction(i, ev, la) {
    var name = t.seats[i].name, txt;
    if (ev.type === 'fold') { txt = 'Fold'; log(name + ' folds.'); }
    else if (ev.type === 'check') { txt = 'Check'; log(name + ' checks.'); }
    else if (ev.type === 'call') { txt = 'Call ' + fmt(ev.amount); log(name + ' calls ' + fmt(ev.amount) + (ev.allIn ? ' (all-in)' : '') + '.'); }
    else { // raise / allin
      var to = ev.streetTotal;
      var verb = (la.currentBet > 0) ? 'raises to ' : 'bets ';
      txt = (ev.allIn ? 'All-in ' : (la.currentBet > 0 ? 'Raise ' : 'Bet ')) + fmt(to);
      log(name + ' ' + (ev.allIn ? 'moves all-in for ' + fmt(to) : verb + fmt(to)) + '.');
    }
    lastAct[i] = txt;
  }

  /* ============================ HUMAN CONTROLS ============================ */
  var slider = $('raiseSlider'), raiseAmtEl = $('raiseAmt');
  function showHumanControls() {
    var la = P.legalActions(t); if (!la) return;
    actionbar.classList.add('show');
    var fold = $('btnFold'), check = $('btnCheck'), raise = $('btnRaise');

    check.textContent = la.canCheck ? 'Check' : 'Call ' + fmt(la.callAmt);
    check.disabled = false;

    if (la.canRaise) {
      raise.disabled = false;
      slider.min = la.minRaiseTo; slider.max = la.maxRaiseTo;
      slider.step = Math.max(1, Math.round((la.maxRaiseTo - la.minRaiseTo) / 200)) || 1;
      slider.value = Math.min(la.maxRaiseTo, la.minRaiseTo);
      $('raiseRow').style.display = '';
      updateRaiseLabel(la);
      buildQuickBets(la);
    } else {
      raise.disabled = true; $('raiseRow').style.display = 'none'; $('quickBets').innerHTML = '';
    }

    fold.onclick = function () { humanAct({ type: 'fold' }); };
    check.onclick = function () { humanAct(la.canCheck ? { type: 'check' } : { type: 'call' }); };
    raise.onclick = function () {
      var v = +slider.value;
      humanAct(v >= la.maxRaiseTo ? { type: 'allin' } : { type: 'raise', amount: v });
    };
    slider.oninput = function () { updateRaiseLabel(la); };
  }

  function updateRaiseLabel(la) {
    var v = +slider.value;
    var raise = $('btnRaise');
    if (v >= la.maxRaiseTo) { raiseAmtEl.textContent = 'All-in'; raise.textContent = 'All-in ' + fmt(la.maxRaiseTo); }
    else { raiseAmtEl.textContent = fmt(v); raise.textContent = (la.currentBet > 0 ? 'Raise to ' : 'Bet ') + fmt(v); }
  }

  function buildQuickBets(la) {
    var box = $('quickBets'); box.innerHTML = '';
    var mk = function (label, val) {
      val = Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, Math.round(val)));
      var b = document.createElement('button'); b.textContent = label;
      b.onclick = function () { slider.value = val; updateRaiseLabel(la); };
      box.appendChild(b);
    };
    mk('½ Pot', la.currentBet + 0.5 * la.pot);
    mk('Pot', la.currentBet + la.pot);
    mk('Max', la.maxRaiseTo);
  }

  function humanAct(act) {
    actionbar.classList.remove('show');
    var i = t.hand.toAct, la = P.legalActions(t);
    var ev = P.applyAction(t, act);
    recordAction(i, ev, la);
    render();
    scheduleLoop(Math.max(300, speed * 0.5));
  }

  /* ============================ misc ============================ */
  function log(html) {
    var d = document.createElement('div'); d.innerHTML = html;
    logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  }

  // boot: connect to a local model if we're served locally
  if (BYOM.isLocal()) {
    endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT;
    loadModels();
  } else {
    setAiStatus('Public site — AI seats play offline bots. Run the arcade locally to drive them with your own model.', '');
  }
  rebuildSeatModels();
  renderRoster();
})();
