/* ============================================================================
 *  XenoXanadu — Dominion ("Deckforge") table UI + AI seat
 *  ----------------------------------------------------------------------------
 *  Drives the pure engine (engine.js) and adaptive bots (strategies.js). You sit
 *  in seat 0; seat 1 is the AI. The AI seat is played offline by a built-in bot
 *  (always available, fully legal) OR — when you connect a local model and pick
 *  "Your model" — by your model wearing the chosen strategy's PERSONA.
 *
 *  Pattern B2: the model only ever PICKS from the numbered legal lists the engine
 *  hands it (`legalPlays` / `legalBuys` / `gainable`), replying `PLAY: n` / `BUY: n`,
 *  and its banter streams to the think panel. Any unparseable / failed reply falls
 *  straight back to the strategy bot's choice — raw model output never mutates
 *  state. Same contract as Texas Hold'em and rock-paper-scissors.
 * ========================================================================== */
(function () {
  'use strict';
  var BYOM = window.XenoBYOM;
  var E = window.Deckforge;
  var AI = window.DeckforgeAI;
  var $ = function (id) { return document.getElementById(id); };

  /* ---- config / state ---- */
  var stratKey = 'bigmoney';        // chosen opponent strategy (also the persona)
  var kingdomChoice = null;          // explicit kingdom id list (null = random each game)
  var brain = 'bot';                 // 'bot' | 'model'
  var g = null;                      // live game
  var pending = null;                // a player's pending choice: {type:'gain',maxCost} | {type:'sift'}
  var siftSel = [];                  // selected hand indices during a Cellar sift
  var busy = false, gen = 0, aiController = null;
  var SPEED = 620;

  /* ---- AI connection ---- */
  var defaultModel = '', modelReady = false;
  var endpointEl = $('endpoint'), modelSel = $('modelSel'), thinkEl = $('aiThink');
  function endpoint() { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); }
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var aiUsable = function () { return BYOM.isLocal() && modelReady && defaultModel; };

  /* ============================ CARD RENDER ============================ */
  function deltaStr(d) {
    var parts = [];
    if (d.c) parts.push('+' + d.c + ' Card' + (d.c > 1 ? 's' : ''));
    if (d.a) parts.push('+' + d.a + ' Action' + (d.a > 1 ? 's' : ''));
    if (d.m) parts.push('+' + d.m + ' Coin' + (d.m > 1 ? 's' : ''));
    if (d.b) parts.push('+' + d.b + ' Buy' + (d.b > 1 ? 's' : ''));
    return parts.join(', ');
  }
  function cardHTML(id, opts) {
    opts = opts || {};
    var d = E.cardDef(id);
    var cls = 'card t-' + d.type;
    if (opts.empty) cls += ' empty';
    if (opts.buyable) cls += ' buyable';
    if (opts.playable) cls += ' playable';
    if (opts.sel) cls += ' selsift';
    var sub = '';
    if (d.type === 'action') sub = deltaStr(d) || d.role;
    else if (d.type === 'treasure') sub = '+' + d.coin + ' Coin' + (d.coin > 1 ? 's' : '');
    else if (d.type === 'victory') sub = d.vp + ' VP';
    else if (d.type === 'curse') sub = d.vp + ' VP';
    var left = (opts.count != null) ? '<div class="left"><b>' + opts.count + '</b> left</div>' : '';
    var desc = opts.showDesc ? '<div class="desc">' + d.blurb + '</div>' : '';
    return '<div class="' + cls + '" data-id="' + id + '"' + (opts.idx != null ? ' data-idx="' + opts.idx + '"' : '') + '>' +
      '<span class="cost">' + d.cost + '</span>' +
      '<span class="nm">' + d.name + '</span>' +
      '<span class="typ">' + sub + '</span>' + desc + left + '</div>';
  }

  /* ============================ SETUP UI ============================ */
  $('stratSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    setSeg('stratSeg', b); stratKey = b.dataset.strat;
  });
  $('kingSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    if (b.dataset.king === 'reroll') { kingdomChoice = E.pickKingdom(10); renderKingdomPreview(); return; }
    setSeg('kingSeg', $('kingSeg').querySelector('[data-king="random"]'));
    kingdomChoice = null; renderKingdomPreview();
  });
  $('brainSeg') && $('brainSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    setSeg('brainSeg', b); brain = b.dataset.brain;
  });
  function setSeg(segId, btn) {
    $(segId).querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === btn); });
  }

  function renderKingdomPreview() {
    var ids = kingdomChoice || E.pickKingdom(10);
    if (!kingdomChoice) previewIds = ids;     // remember so "Random" uses the shown set
    $('kingPreview').innerHTML = ids.map(function (id) {
      return cardHTML(id, { showDesc: true });
    }).join('');
  }
  var previewIds = null;

  $('startBtn').addEventListener('click', function () {
    var kingdom = kingdomChoice || previewIds || E.pickKingdom(10);
    startGame(kingdom);
  });
  $('newGame').addEventListener('click', function () {
    gen++; if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; }
    $('overlay').classList.remove('show');
    $('stage').classList.add('hide'); $('setup').classList.remove('hide');
  });

  /* ============================ GAME START ============================ */
  function startGame(kingdom) {
    gen++;
    g = E.createGame([
      { name: 'You', isHuman: true },
      { name: AI.PERSONAS[stratKey].name, isAI: true, persona: AI.PERSONAS[stratKey], strategy: stratKey }
    ], { kingdom: kingdom });
    pending = null; siftSel = []; busy = false;

    $('scAiName').textContent = AI.PERSONAS[stratKey].name;
    $('setup').classList.add('hide'); $('stage').classList.remove('hide');
    $('log').innerHTML = ''; thinkEl.textContent = 'The opponent\'s reasoning streams here when it\'s the model\'s turn…';

    E.startTurn(g);
    logLine('turn', 'Turn 1 — your move.');
    renderAll();
  }

  /* ============================ RENDER ============================ */
  function renderAll() {
    if (!g) return;
    var you = g.players[0], ai = g.players[1];
    $('hudTurn').textContent = Math.ceil((g.turnNo) / 2) || 1;
    $('hudOn').textContent = g.current === 0 ? 'You' : ai.name;
    $('hudProv').textContent = g.supply.province;
    $('hudEmpty').textContent = E.emptyPiles(g);

    $('scYouVP').textContent = E.scoreFor(g, you);
    $('scAiVP').textContent = E.scoreFor(g, ai);
    $('scYouDeck').textContent = E.deckCount(you) + ' cards';
    $('scAiName').textContent = ai.name;
    $('scAiDeck').textContent = E.deckCount(ai) + ' cards';
    $('scYou').classList.toggle('active', g.current === 0);
    $('scAi').classList.toggle('active', g.current === 1);

    $('resA').textContent = g.actions; $('resC').textContent = g.coins; $('resB').textContent = g.buys;

    renderHand();
    renderSupply();
    renderControls();
  }

  function renderHand() {
    var you = g.players[0];
    var host = $('hand');
    var myTurn = g.current === 0;
    var playable = {};
    if (myTurn && !pending) E.legalPlays(g).forEach(function (p) { playable[p.idx] = true; });
    if (!you.hand.length) { host.innerHTML = '<div class="empty-note">(hand empty)</div>'; }
    else {
      host.innerHTML = you.hand.map(function (id, idx) {
        var sel = pending && pending.type === 'sift' && siftSel.indexOf(idx) >= 0;
        return cardHTML(id, { idx: idx, playable: playable[idx], showDesc: true, sel: sel });
      }).join('');
    }
    $('handMeta').textContent = pending
      ? (pending.type === 'gain' ? 'choose a card to gain below ▾' : 'click cards to discard, then Confirm')
      : (g.current === 0 ? (g.phase === 'action' ? 'play an action, or end the action phase' : 'play treasures, then buy below') : 'opponent is thinking…');
  }

  function renderSupply() {
    var host = $('supply');
    var ids = E.allSupplyIds(g);
    var buyable = {}, gainable = {};
    if (g.current === 0 && !pending && g.phase === 'buy') {
      E.legalBuys(g).forEach(function (b) { if (!b.endTurn) buyable[b.id] = true; });
    }
    if (g.current === 0 && pending && pending.type === 'gain') {
      E.gainable(g, pending.maxCost).forEach(function (id) { gainable[id] = true; });
    }
    host.innerHTML = ids.map(function (id) {
      return cardHTML(id, {
        count: g.supply[id], empty: g.supply[id] === 0,
        buyable: buyable[id] || gainable[id], showDesc: false
      });
    }).join('');
  }

  function renderControls() {
    var myTurn = g.current === 0 && !g.over;
    var sift = pending && pending.type === 'sift';
    var gain = pending && pending.type === 'gain';
    $('btnTreasures').style.display = (myTurn && !pending) ? '' : 'none';
    $('btnEndPhase').style.display = (myTurn && !pending && g.phase === 'action') ? '' : 'none';
    $('btnEndTurn').style.display = (myTurn && !pending && g.phase === 'buy') ? '' : 'none';
    $('btnConfirmSift').style.display = sift ? '' : 'none';
    $('btnTreasures').disabled = !hasTreasureInHand();
    $('supplyMeta').textContent = gain ? 'choose a card to GAIN (free)' :
      (g.phase === 'buy' && myTurn ? 'click a card to buy it (' + g.coins + ' coins, ' + g.buys + ' buy' + (g.buys === 1 ? '' : 's') + ')' :
      'supply piles — buy in the buy phase');
    setStatus();
  }
  function hasTreasureInHand() {
    return g.players[0].hand.some(function (id) { return E.cardDef(id).type === 'treasure'; });
  }
  function setStatus() {
    var s;
    if (g.over) s = 'Game over.';
    else if (g.current === 1) s = g.players[1].name + ' is taking their turn…';
    else if (pending && pending.type === 'gain') s = 'Gain a card costing up to ' + pending.maxCost + '.';
    else if (pending && pending.type === 'sift') s = 'Discard any cards, then draw that many.';
    else if (g.phase === 'action') s = 'Your turn — <b>Action phase</b>. Actions: ' + g.actions;
    else s = 'Your turn — <b>Buy phase</b>. Coins: ' + g.coins + ', Buys: ' + g.buys;
    $('status').innerHTML = s;
  }

  /* ============================ HUMAN INPUT ============================ */
  // hand clicks: play an action, or toggle a sift selection
  $('hand').addEventListener('click', function (e) {
    var card = e.target.closest('.card'); if (!card || busy) return;
    if (g.current !== 0) return;
    var idx = parseInt(card.dataset.idx, 10);
    if (pending && pending.type === 'sift') {
      var k = siftSel.indexOf(idx);
      if (k >= 0) siftSel.splice(k, 1); else siftSel.push(idx);
      renderHand(); return;
    }
    if (pending) return;
    if (g.phase !== 'action') return;
    if (!card.classList.contains('playable')) return;
    humanPlayAction(idx);
  });

  // supply clicks: buy a card, or pick a gain target
  $('supply').addEventListener('click', function (e) {
    var card = e.target.closest('.card'); if (!card || busy) return;
    if (g.current !== 0) return;
    var id = card.dataset.id;
    if (pending && pending.type === 'gain') {
      if (!card.classList.contains('buyable')) return;
      E.resolveGain(g, pending.maxCost, id);
      logLine('you', 'You gain ' + E.cardDef(id).name + '.');
      pending = null; renderAll(); return;
    }
    if (pending) return;
    if (g.phase !== 'buy') return;
    if (!card.classList.contains('buyable')) return;
    if (E.buyCard(g, id)) { logLine('you', 'You buy ' + E.cardDef(id).name + '.'); renderAll(); }
  });

  function humanPlayAction(idx) {
    var def = E.cardDef(g.players[0].hand[idx]);
    var ev = E.playAction(g, idx);
    if (!ev) return;
    logLine('you', 'You play ' + def.name + (ev.drew ? ' (+' + ev.drew + ' cards)' : '') + '.');
    if (ev.attack) logLine('you', '  → ' + (ev.attack.type === 'curse' ? 'the opponent gains a Curse' : 'the opponent discards down to ' + ev.attack.to) + '.');
    if (ev.pending) { pending = ev.pending; if (pending.type === 'sift') siftSel = []; }
    renderAll();
  }

  $('btnTreasures').addEventListener('click', function () {
    if (busy || g.current !== 0 || pending) return;
    var got = E.playAllTreasures(g);          // also flips to buy phase
    if (got) logLine('you', 'You play your treasures (+' + got + ' coins).');
    renderAll();
  });
  $('btnEndPhase').addEventListener('click', function () {
    if (busy || g.current !== 0 || pending) return;
    E.toBuyPhase(g); renderAll();
  });
  $('btnEndTurn').addEventListener('click', function () { if (!busy && g.current === 0 && !pending) endHumanTurn(); });
  $('btnConfirmSift').addEventListener('click', function () {
    if (!pending || pending.type !== 'sift') return;
    var n = E.resolveSift(g, siftSel);
    logLine('you', 'You sift ' + n + ' card(s).');
    pending = null; siftSel = []; renderAll();
  });

  function endHumanTurn() {
    var over = E.cleanup(g);                   // discards, draws 5, advances or ends
    if (over) { renderAll(); showGameOver(); return; }
    renderAll();
    logLine('turn', g.players[1].name + '\'s turn.');
    runAiTurn();
  }

  /* ============================ AI TURN ============================ */
  async function runAiTurn() {
    busy = true; var myGen = gen;
    if (brain === 'model' && aiUsable()) {
      thinkEl.textContent = '';
      try { await modelTurn(myGen); }
      catch (e) { if (myGen === gen) { thinkEl.textContent += '\n[model error — the bot finishes the turn]'; botFinishTurn(); } }
    } else {
      await botTurnAnimated(myGen);
    }
    if (myGen !== gen) return;
    var over = E.cleanup(g);
    busy = false;
    renderAll();
    if (over) { showGameOver(); return; }
    logLine('turn', 'Turn ' + (Math.ceil(g.turnNo / 2)) + ' — your move.');
    renderAll();
  }

  // Built-in bot turn, stepped with a small delay so the player can follow it.
  async function botTurnAnimated(myGen) {
    // ACTION phase
    var guard = 40;
    while (g.phase === 'action' && guard-- > 0) {
      var idx = AI.pickPlay(g);
      if (idx < 0) break;
      var def = E.cardDef(g.players[1].hand[idx]);
      var ev = E.playAction(g, idx);
      if (!ev) break;
      logLine('ai', g.players[1].name + ' plays ' + def.name + (ev.drew ? ' (+' + ev.drew + ' cards)' : '') + '.');
      resolveBotPending(ev);
      renderAll(); await sleep(SPEED * 0.55); if (myGen !== gen) return;
    }
    // BUY phase
    var got = E.playAllTreasures(g);
    logLine('ai', g.players[1].name + ' has ' + g.coins + ' coins, ' + g.buys + ' buy' + (g.buys === 1 ? '' : 's') + '.');
    renderAll(); await sleep(SPEED * 0.7); if (myGen !== gen) return;
    var bguard = 12;
    while (g.phase === 'buy' && g.buys > 0 && bguard-- > 0) {
      var id = AI.pickBuy(g, stratKey);
      if (id === '__end' || !E.buyCard(g, id)) break;
      logLine('ai', g.players[1].name + ' buys ' + E.cardDef(id).name + '.');
      renderAll(); await sleep(SPEED * 0.7); if (myGen !== gen) return;
    }
  }

  function botFinishTurn() {
    // used when a model turn errors mid-way: let the bot complete legally
    var guard = 40;
    while (g.phase === 'action' && guard-- > 0) {
      var idx = AI.pickPlay(g); if (idx < 0) break;
      var ev = E.playAction(g, idx); if (!ev) break; resolveBotPending(ev);
    }
    E.playAllTreasures(g);
    var bg = 12;
    while (g.phase === 'buy' && g.buys > 0 && bg-- > 0) {
      var id = AI.pickBuy(g, stratKey); if (id === '__end' || !E.buyCard(g, id)) break;
    }
  }

  function resolveBotPending(ev) {
    if (ev.pending && ev.pending.type === 'gain') {
      var gid = AI.pickGain(g, ev.pending.maxCost, stratKey);
      if (E.resolveGain(g, ev.pending.maxCost, gid)) logLine('ai', '  → gains ' + E.cardDef(gid).name + '.');
    } else if (ev.pending && ev.pending.type === 'sift') {
      var n = E.resolveSift(g, AI.pickSift(g));
      if (n) logLine('ai', '  → sifts ' + n + ' card(s).');
    }
    if (ev.attack) logLine('ai', '  → ' + (ev.attack.type === 'curse' ? 'you gain a Curse' : 'you discard down to ' + ev.attack.to) + '.');
  }

  /* ============================ MODEL TURN (B2) ============================ */
  // The model PICKS from numbered legal lists; bad reply → the bot's choice.
  async function modelTurn(myGen) {
    var name = g.players[1].name, persona = AI.PERSONAS[stratKey];
    // ACTION phase: ask once per playable action, until it ends the phase.
    var guard = 30;
    while (g.phase === 'action' && guard-- > 0) {
      var plays = E.legalPlays(g);
      if (!plays.length) break;
      // option list: the legal plays + an "end action phase" choice
      var idx = await askPlay(myGen, plays, persona, name);
      if (myGen !== gen) return;
      if (idx === -1) { E.toBuyPhase(g); break; }
      var def = E.cardDef(g.players[1].hand[idx]);
      var ev = E.playAction(g, idx);
      if (!ev) { E.toBuyPhase(g); break; }
      logLine('ai', name + ' plays ' + def.name + (ev.drew ? ' (+' + ev.drew + ' cards)' : '') + '.');
      // pending gain/sift resolved by the bot heuristic (keeps the model on rails)
      resolveBotPending(ev);
      renderAll(); await sleep(220); if (myGen !== gen) return;
    }
    if (g.phase === 'action') E.toBuyPhase(g);

    // BUY phase
    var got = E.playAllTreasures(g);
    logLine('ai', name + ' has ' + g.coins + ' coins, ' + g.buys + ' buy' + (g.buys === 1 ? '' : 's') + '.');
    renderAll(); await sleep(220); if (myGen !== gen) return;
    var bguard = 10;
    while (g.phase === 'buy' && g.buys > 0 && bguard-- > 0) {
      var id = await askBuy(myGen, persona, name);
      if (myGen !== gen) return;
      if (id === '__end' || !E.buyCard(g, id)) break;
      logLine('ai', name + ' buys ' + E.cardDef(id).name + '.');
      renderAll(); await sleep(260); if (myGen !== gen) return;
    }
  }

  function personaSys(persona, name) {
    return 'You are "' + name + '", an AI opponent in a Dominion-style deckbuilder. ' + persona.style +
      ' You will be shown your current resources and a NUMBERED list of LEGAL choices. ' +
      'Reply with one or two short sentences explaining your pick in character, then a final line ' +
      'in the exact format requested (PLAY: <n> or BUY: <n>). You MUST choose one number from the list — ' +
      'nothing else is legal.';
  }
  function resourcesLine() {
    return 'Actions=' + g.actions + ', Coins=' + g.coins + ', Buys=' + g.buys +
      ', Provinces left=' + g.supply.province + ', your deck size=' + E.deckCount(g.players[1]) + '.';
  }

  async function askPlay(myGen, plays, persona, name) {
    // build numbered options: plays then an "end phase" option
    var opts = plays.map(function (p) {
      var d = p.def; return d.name + ' (' + (deltaStr(d) || d.role) + ')';
    });
    opts.push('End action phase (play no more actions)');
    var sys = personaSys(persona, name);
    var user = 'It is your ACTION phase. ' + resourcesLine() + '\nYour hand: ' +
      g.players[1].hand.map(function (id) { return E.cardDef(id).name; }).join(', ') + '.\n' +
      'Legal choices:\n' + numbered(opts) + '\nChoose one and end with: PLAY: <number>';
    var reply = await chat(myGen, sys, user, persona);
    var n = parseNum(reply, 'play');
    if (n == null || n < 1 || n > opts.length) {            // bad reply → bot's choice
      var fb = AI.pickPlay(g);
      narrateFallback(myGen);
      return fb;                                            // bot index (or -1)
    }
    return (n === opts.length) ? -1 : plays[n - 1].idx;     // last option = end phase
  }

  async function askBuy(myGen, persona, name) {
    var buys = E.legalBuys(g);                              // includes __end as last
    var opts = buys.map(function (b) {
      if (b.endTurn) return 'Buy nothing / end turn';
      var d = b.def; return 'Buy ' + d.name + ' (cost ' + d.cost + ', ' + cardKind(d) + ')';
    });
    var sys = personaSys(persona, name);
    var user = 'It is your BUY phase. ' + resourcesLine() + '\n' +
      'Legal choices (you can afford all of these):\n' + numbered(opts) +
      '\nPick the buy that best fits your strategy, then end with: BUY: <number>';
    var reply = await chat(myGen, sys, user, persona);
    var n = parseNum(reply, 'buy');
    if (n == null || n < 1 || n > buys.length) {            // bad reply → bot's choice
      narrateFallback(myGen);
      return AI.pickBuy(g, stratKey);
    }
    return buys[n - 1].id;                                  // could be '__end'
  }
  function cardKind(d) {
    if (d.type === 'treasure') return '+' + d.coin + ' coin';
    if (d.type === 'victory') return d.vp + ' VP';
    if (d.type === 'curse') return d.vp + ' VP';
    return deltaStr(d) || d.role;
  }

  function narrateFallback(myGen) {
    if (myGen === gen) thinkEl.textContent += (thinkEl.textContent ? '\n' : '') + '[unclear reply — falling back to the strategy bot]\n';
  }

  async function chat(myGen, sys, user, persona) {
    if (aiController) { try { aiController.abort(); } catch (e) {} }
    aiController = new AbortController();
    var reply = await BYOM.chat({
      endpoint: endpoint(), model: defaultModel, temperature: 0.55,
      maxTokens: aiIsReasoning(defaultModel) ? 1400 : 320,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      onToken: function (d) { if (myGen === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
      onThinking: function (d) { if (myGen === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
      signal: aiController.signal
    });
    aiController = null;
    if (myGen === gen) thinkEl.textContent += '\n';
    return reply || '';
  }
  function numbered(opts) { return opts.map(function (o, i) { return (i + 1) + '. ' + o; }).join('\n'); }
  function parseNum(reply, kind) {
    var re = new RegExp(kind + '\\s*:?\\s*(\\d+)', 'i');
    var m = (reply || '').match(re);
    if (m) return parseInt(m[1], 10);
    // last-ditch: a lone trailing number
    var m2 = (reply || '').match(/(\d+)\s*$/);
    return m2 ? parseInt(m2[1], 10) : null;
  }

  /* ============================ GAME OVER ============================ */
  function showGameOver() {
    var you = g.players[0], ai = g.players[1];
    you.vp = E.scoreFor(g, you); ai.vp = E.scoreFor(g, ai);
    var title, body;
    if (g.winner === 0) title = 'You win!';
    else if (g.winner === 1) title = ai.name + ' wins.';
    else title = 'A draw!';
    body = '<div class="scores">' +
      '<div class="row"><span>You</span><b>' + you.vp + ' VP</b></div>' +
      '<div class="row"><span>' + ai.name + '</span><b>' + ai.vp + ' VP</b></div>' +
      '</div><p>' + (g.supply.province === 0 ? 'Provinces ran out.' : 'Three supply piles emptied.') +
      ' Turns played: you ' + you.turns + ', ' + ai.name + ' ' + ai.turns + '.</p>';
    $('ovTitle').textContent = title;
    $('ovBody').innerHTML = body;
    $('ovControls').innerHTML = '';
    var again = document.createElement('button');
    again.className = 'btn-primary'; again.textContent = 'Play again ▸';
    again.addEventListener('click', function () {
      $('overlay').classList.remove('show');
      startGame(g.kingdom);                  // same kingdom rematch
    });
    var menu = document.createElement('button');
    menu.className = 'btn-ghost'; menu.textContent = 'Back to setup';
    menu.addEventListener('click', function () {
      $('overlay').classList.remove('show');
      $('stage').classList.add('hide'); $('setup').classList.remove('hide');
    });
    $('ovControls').appendChild(again); $('ovControls').appendChild(menu);
    $('overlay').classList.add('show');
    logLine('big', '★ ' + title + ' (You ' + you.vp + ' — ' + ai.vp + ' ' + ai.name + ')');
  }

  /* ============================ LOG / UTIL ============================ */
  function logLine(cls, text) {
    var d = document.createElement('div');
    d.className = 'li ' + cls; d.textContent = text;
    $('log').appendChild(d); $('log').scrollTop = $('log').scrollHeight;
  }
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
      setAiStatus(res.error.message + ' — the built-in bot still plays offline.', 'err');
      return;
    }
    modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    modelSel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved
      : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
    modelSel.value = fav; defaultModel = fav; modelReady = true;
    BYOM.saveConfig({ model: fav });
    setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. Pick “Your model” to let it play the AI seat.', 'on');
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  /* ============================ BOOT ============================ */
  renderKingdomPreview();
  if (BYOM.isLocal()) { endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT; loadModels(); }
  else setAiStatus('Public site — you face the offline strategy bots. Run locally to add a model rival.', '');
})();
