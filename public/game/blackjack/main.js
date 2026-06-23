/* ============================================================================
 *  XenoXanadu — Blackjack — engine + sly dealer + coach + optional BYOM voice
 *  ----------------------------------------------------------------------------
 *  Blackjack vs the dealer. Standard rules: hit / stand / double-down / split;
 *  blackjack pays 3:2; dealer stands on 17 (configurable hit-soft-17); a shoe of
 *  1–6 decks; a chip bankroll + bet.
 *
 *  The DEALER's play is 100% engine — fixed HOUSE rules (hit until 17, optionally
 *  hit a soft 17). The model NEVER decides the dealer's action and never sees the
 *  hole card before it is turned up.
 *
 *  Built-in, model-free features (work offline / on the hosted site):
 *    • Sly dealer persona with shifting moods — scripted neon one-liners.
 *    • COACH: flags the basic-strategy-optimal play for the current hand vs the
 *      dealer upcard (a standard multi-deck S17/H17 table), plus a card-counting
 *      tell (Hi-Lo running / true count nudge).
 *
 *  Pattern B2: a connected local model OPTIONALLY voices the dealer banter and/or
 *  paraphrases the coach's call, streamed to the .ai-think panel. ANY failure
 *  falls back to the scripted lines / the deterministic coach. Raw model output
 *  never mutates game state.
 * ========================================================================== */
(function () {
  'use strict';
  var BYOM = window.XenoBYOM;
  var $ = function (id) { return document.getElementById(id); };

  /* ============================ CARDS ============================ */
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var SUITS = [{ s: '♠', c: 'black' }, { s: '♥', c: 'red' }, { s: '♦', c: 'red' }, { s: '♣', c: 'black' }];

  function cardValue(r) { if (r === 'A') return 11; if (r === '10' || r === 'J' || r === 'Q' || r === 'K') return 10; return parseInt(r, 10); }
  function hiLo(r) { var v = cardValue(r); if (r === 'A' || v === 10) return -1; if (v >= 2 && v <= 6) return 1; return 0; }

  // hand total honouring soft aces; returns {total, soft}
  function handTotal(cards) {
    var total = 0, aces = 0;
    cards.forEach(function (c) { total += cardValue(c.r); if (c.r === 'A') aces++; });
    var soft = false;
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    if (aces > 0 && total <= 21) soft = true;   // an ace still counted as 11
    return { total: total, soft: soft };
  }
  function isBlackjack(cards) { return cards.length === 2 && handTotal(cards).total === 21; }

  /* ============================ STATE ============================ */
  var BANK_KEY = 'xeno.blackjack.bank';
  var decks = 6, hitSoft17 = false, coachOn = true, voiceMode = 'script';
  var bankroll = loadBank();
  var pendingBet = 0;
  var shoe = [];           // array of {r,s,c}
  var penetration = 0;     // index at which we reshuffle
  var runningCount = 0, cardsDealt = 0;
  var dealer = [];         // dealer cards (index 1 is the hole card while in play)
  var hands = [];          // player hands: [{cards, bet, done, doubled, busted, blackjack, split, outcome}]
  var active = 0;          // index of the hand currently acting
  var phase = 'bet';       // 'bet' | 'player' | 'dealer' | 'done'
  var holeHidden = true;
  var busy = false;        // dealer auto-play / settle in progress
  var gen = 0;             // generation guard for async model calls

  // AI
  var defaultModel = '', modelReady = false, aiController = null;
  var endpointEl = $('endpoint'), modelSel = $('modelSel'), thinkEl = $('aiThink');
  function endpoint() { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); }
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var aiUsable = function () { return BYOM.isLocal() && modelReady && defaultModel && voiceMode === 'model'; };

  function loadBank() { try { var v = parseInt(localStorage.getItem(BANK_KEY), 10); return (v && v > 0) ? v : 500; } catch (e) { return 500; } }
  function saveBank() { try { localStorage.setItem(BANK_KEY, String(bankroll)); } catch (e) {} }

  /* ============================ SHOE ============================ */
  function buildShoe() {
    shoe = [];
    for (var d = 0; d < decks; d++) {
      for (var s = 0; s < SUITS.length; s++) {
        for (var r = 0; r < RANKS.length; r++) shoe.push({ r: RANKS[r], s: SUITS[s].s, c: SUITS[s].c });
      }
    }
    // Fisher-Yates
    for (var i = shoe.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = shoe[i]; shoe[i] = shoe[j]; shoe[j] = t; }
    penetration = Math.floor(shoe.length * (decks === 1 ? 0.5 : 0.75));   // cut-card
    runningCount = 0; cardsDealt = 0;
  }
  function needsShuffle() { return cardsDealt >= penetration || shoe.length < 15; }
  function draw() {
    if (!shoe.length) buildShoe();
    var c = shoe.pop();
    runningCount += hiLo(c.r); cardsDealt++;
    return c;
  }
  function trueCount() {
    var remainingDecks = Math.max(0.5, (shoe.length) / 52);
    return runningCount / remainingDecks;
  }

  /* ============================ DEAL / ROUND ============================ */
  function startRound() {
    if (pendingBet <= 0 || pendingBet > bankroll) return;
    if (needsShuffle()) { buildShoe(); dealerSay(pick(LINES.shuffle)); }
    gen++;
    bankroll -= pendingBet; saveBank();
    dealer = [];
    hands = [{ cards: [], bet: pendingBet, done: false, doubled: false, busted: false, blackjack: false, split: false, outcome: null }];
    active = 0; phase = 'player'; holeHidden = true;
    setResult('', '');

    // deal: player, dealer(up), player, dealer(hole)
    hands[0].cards.push(draw());
    dealer.push(draw());
    hands[0].cards.push(draw());
    dealer.push(draw());

    renderBet(); renderTable(); renderActions();
    // immediate blackjack check
    var pBJ = isBlackjack(hands[0].cards), dBJ = isBlackjack(dealer);
    if (pBJ || dBJ) {
      hands[0].done = true; hands[0].blackjack = pBJ;
      revealDealer(); settle();
      return;
    }
    coachTip(true);   // quiet: the dealer voice (below) owns the think panel this tick
    dealerSay(pick(LINES.deal));
    if (aiUsable()) voiceDealer('deal');
  }

  // ---- player actions ----
  function curHand() { return hands[active]; }
  function canSplit(h) {
    return h.cards.length === 2 && !h.split && hands.length < 4 &&
      cardValue(h.cards[0].r) === cardValue(h.cards[1].r) && bankroll >= h.bet;
  }
  function canDouble(h) { return h.cards.length === 2 && bankroll >= h.bet; }

  function hit() {
    if (phase !== 'player' || busy) return;
    var h = curHand();
    h.cards.push(draw());
    var t = handTotal(h.cards).total;
    if (t > 21) { h.busted = true; h.done = true; advance(); }
    else if (t === 21) { h.done = true; advance(); }
    else { renderTable(); renderActions(); coachTip(); }
  }
  function stand() { if (phase !== 'player' || busy) return; curHand().done = true; advance(); }
  function doubleDown() {
    if (phase !== 'player' || busy) return;
    var h = curHand(); if (!canDouble(h)) return;
    bankroll -= h.bet; saveBank(); h.bet *= 2; h.doubled = true;
    h.cards.push(draw());
    if (handTotal(h.cards).total > 21) h.busted = true;
    h.done = true; renderBet(); advance();
  }
  function split() {
    if (phase !== 'player' || busy) return;
    var h = curHand(); if (!canSplit(h)) return;
    bankroll -= h.bet; saveBank();
    var moved = h.cards.pop();
    var nh = { cards: [moved], bet: h.bet, done: false, doubled: false, busted: false, blackjack: false, split: true, outcome: null };
    h.split = true;
    h.cards.push(draw()); nh.cards.push(draw());
    hands.splice(active + 1, 0, nh);
    // split aces get one card each, then stand
    if (h.cards[0].r === 'A') { h.done = true; nh.done = true; }
    renderBet(); renderTable(); renderActions(); coachTip();
    if (h.done) advance();
  }

  function advance() {
    // move to next un-done hand, else dealer
    renderTable();
    while (active < hands.length && hands[active].done) active++;
    if (active < hands.length) { phase = 'player'; renderTable(); renderActions(); coachTip(); }
    else { active = hands.length - 1; revealDealer(); dealerPlay(); }
  }

  /* ============================ DEALER (engine only) ============================ */
  function revealDealer() { holeHidden = false; renderTable(); }

  function allPlayerBusted() { return hands.every(function (h) { return h.busted; }); }

  function dealerPlay() {
    phase = 'dealer'; busy = true; renderActions();
    if (allPlayerBusted()) { busy = false; settle(); return; }   // dealer needn't draw
    if (aiUsable()) voiceDealer('reveal');
    var step = function () {
      var info = handTotal(dealer);
      var hitMore = info.total < 17 || (info.total === 17 && info.soft && hitSoft17);
      if (hitMore) {
        dealer.push(draw()); renderTable();
        setTimeout(step, 520);
      } else { busy = false; settle(); }
    };
    setTimeout(step, 620);
  }

  /* ============================ SETTLE ============================ */
  function settle() {
    phase = 'done'; revealDealer();
    var dInfo = handTotal(dealer), dTot = dInfo.total, dBJ = isBlackjack(dealer);
    var net = 0, anyWin = false, anyLose = false;

    hands.forEach(function (h) {
      var pTot = handTotal(h.cards).total;
      var pBJ = h.blackjack;
      if (h.busted) { h.outcome = 'lose'; net -= h.bet; anyLose = true; return; }
      if (pBJ && !dBJ) { var w = Math.floor(h.bet * 3 / 2); h.outcome = 'bj'; net += h.bet + w; bankroll += h.bet + w; anyWin = true; return; }
      if (dBJ && !pBJ) { h.outcome = 'lose'; net -= h.bet; anyLose = true; return; }
      if (pBJ && dBJ) { h.outcome = 'push'; bankroll += h.bet; return; }
      if (dTot > 21) { h.outcome = 'win'; net += h.bet; bankroll += h.bet * 2; anyWin = true; return; }
      if (pTot > dTot) { h.outcome = 'win'; net += h.bet; bankroll += h.bet * 2; anyWin = true; }
      else if (pTot < dTot) { h.outcome = 'lose'; net -= h.bet; anyLose = true; }
      else { h.outcome = 'push'; bankroll += h.bet; }
    });
    saveBank();

    var msg, cls;
    if (hands.length === 1) {
      var o = hands[0].outcome;
      if (o === 'bj')   { msg = 'BLACKJACK! Pays 3:2 (+' + (Math.floor(hands[0].bet * 3 / 2)) + ')'; cls = 'win'; }
      else if (o === 'win')  { msg = 'You win +' + net; cls = 'win'; }
      else if (o === 'lose') { msg = hands[0].busted ? 'Bust. You lose ' + (-net) : 'Dealer takes it (' + (-net) + ')'; cls = 'lose'; }
      else { msg = 'Push — bet returned'; cls = 'push'; }
    } else {
      if (net > 0) { msg = 'Net +' + net + ' across ' + hands.length + ' hands'; cls = 'win'; }
      else if (net < 0) { msg = 'Net ' + net + ' across ' + hands.length + ' hands'; cls = 'lose'; }
      else { msg = 'Even across ' + hands.length + ' hands'; cls = 'push'; }
    }
    if (bankroll <= 0) { bankroll = 0; saveBank(); msg += ' — you\'re tapped out. Reshuffle & reset to rebuy.'; }
    setResult(msg, cls);
    renderBet(); renderTable(); renderActions();

    // dealer mood reacts to the outcome (scripted; model may override its voice)
    var moodLines = anyLose && !anyWin ? LINES.dealerWin : (anyWin && !anyLose ? LINES.playerWin : LINES.mixed);
    dealerSay(pick(moodLines));
    if (aiUsable()) voiceDealer('settle', { net: net, anyWin: anyWin, anyLose: anyLose });

    coachCount();   // post-hand count nudge stays visible
    pendingBet = Math.min(pendingBet, bankroll);   // keep last bet if affordable
  }

  /* ============================ BASIC STRATEGY COACH ============================ */
  // Returns one of: 'H' hit, 'S' stand, 'D' double (else hit), 'P' split, 'Ds' double (else stand)
  function basicStrategy(h, dealerUp) {
    var up = cardValue(dealerUp.r);   // 11 for ace
    var cards = h.cards;
    // pairs
    if (cards.length === 2 && cardValue(cards[0].r) === cardValue(cards[1].r)) {
      var pv = cardValue(cards[0].r);
      var p = pairPlay(pv, up);
      if (p) return p;
    }
    var info = handTotal(cards), t = info.total;
    if (info.soft) return softPlay(t, up);
    return hardPlay(t, up);
  }
  function pairPlay(pv, up) {
    // pv: 11=A, 10, 9..2
    if (pv === 11) return 'P';                       // A,A
    if (pv === 10) return null;                       // 10,10 -> stand (fall through to hard 20)
    if (pv === 9)  return (up === 7 || up >= 10 || up === 11) ? null : 'P';  // 9,9 stand vs 7,10,A else split
    if (pv === 8)  return 'P';                        // 8,8 always
    if (pv === 7)  return up <= 7 ? 'P' : null;
    if (pv === 6)  return up <= 6 ? 'P' : null;
    if (pv === 5)  return null;                       // treat as hard 10
    if (pv === 4)  return (up === 5 || up === 6) ? 'P' : null;
    if (pv === 3 || pv === 2) return up <= 7 ? 'P' : null;
    return null;
  }
  function softPlay(t, up) {  // t is the soft total (e.g. A,7 -> 18)
    if (t >= 20) return 'S';
    if (t === 19) return (up === 6 && hitSoft17) ? 'Ds' : 'S';   // A,8 doubles vs 6 only under H17
    if (t === 18) { if (up >= 3 && up <= 6) return 'Ds'; if (up === 2 || up === 7 || up === 8) return 'S'; return 'H'; }
    if (t === 17) return (up >= 3 && up <= 6) ? 'D' : 'H';
    if (t === 16 || t === 15) return (up >= 4 && up <= 6) ? 'D' : 'H';
    if (t === 14 || t === 13) return (up >= 5 && up <= 6) ? 'D' : 'H';
    return 'H';
  }
  function hardPlay(t, up) {
    if (t >= 17) return 'S';
    if (t >= 13 && t <= 16) return up <= 6 ? 'S' : 'H';
    if (t === 12) return (up >= 4 && up <= 6) ? 'S' : 'H';
    if (t === 11) return 'D';
    if (t === 10) return up <= 9 ? 'D' : 'H';
    if (t === 9)  return (up >= 3 && up <= 6) ? 'D' : 'H';
    return 'H';   // 8 or less
  }
  var ACTION_NAME = { H: 'Hit', S: 'Stand', D: 'Double (else hit)', Ds: 'Double (else stand)', P: 'Split' };

  function strategyAvailable(h, code) {
    // downgrade D/Ds/P if the table can't actually do it
    if (code === 'P' && !canSplit(h)) { var i = handTotal(h.cards); return i.soft ? softPlay(i.total, cardValue(dealer[0].r)) || 'H' : (i.total >= 17 ? 'S' : 'H'); }
    if ((code === 'D' || code === 'Ds') && !canDouble(h)) return code === 'Ds' ? 'S' : 'H';
    return code;
  }

  // quiet=true suppresses model coach voicing (used when a dealer line is being
  // voiced on the same tick so the two don't fight over the one think panel).
  function coachTip(quiet) {
    if (!coachOn || phase !== 'player') { $('coach').hidden = true; return; }
    var h = curHand();
    var raw = basicStrategy(h, dealer[0]);
    var code = strategyAvailable(h, raw);
    var info = handTotal(h.cards);
    var label = info.soft ? ('soft ' + info.total) : ('hard ' + info.total);
    if (h.cards.length === 2 && cardValue(h.cards[0].r) === cardValue(h.cards[1].r)) label = 'a pair of ' + h.cards[0].r + '’s';
    var up = dealer[0].r;
    var html = 'With <b>' + label + '</b> vs the dealer’s <b>' + up + '</b>, basic strategy says <b>' + ACTION_NAME[code] + '</b>. ' + countPhrase();
    setCoach(html);
    $('coach').hidden = false;
    if (!quiet && aiUsable()) voiceCoach(label, up, ACTION_NAME[code]);
  }
  function coachCount() {
    if (!coachOn) { $('coach').hidden = true; return; }
    setCoach('Hand over. ' + countPhrase(true));
    $('coach').hidden = false;
  }
  function countPhrase(post) {
    var tc = trueCount();
    var rc = runningCount;
    var nudge;
    if (tc >= 2) nudge = 'count is hot — the deck favours you, lean into bigger bets';
    else if (tc <= -2) nudge = 'count is cold — high cards are thin, bet small';
    else nudge = 'count is roughly neutral';
    var pre = post ? 'Running ' : 'Running count ';
    return '<span class="count">' + pre + (rc >= 0 ? '+' : '') + rc + ', true ' + (tc >= 0 ? '+' : '') + tc.toFixed(1) + '</span> — ' + nudge + '.';
  }

  /* ============================ SLY DEALER (scripted) ============================ */
  var LINES = {
    shuffle: ['Fresh shoe. New luck, same house edge.', 'Shuffling. The cards forget nothing — neither do I.',
              'Clean deck. Don’t get comfortable.'],
    deal:    ['Cards are out. Let’s see what you do with them.', 'Make it interesting.',
              'The felt is listening.', 'Your move, hot shot.'],
    hit:     ['Greedy. I like it.', 'One more for the brave.', 'Pushing your luck, are we?'],
    dealerWin: ['House wins. Shocking, I know.', 'The math always comes home.', 'Better luck never, friend.',
                'I do this all day. You do this on weekends.'],
    playerWin: ['Hmph. Enjoy it while it lasts.', 'Beginner’s luck has a long tail tonight.',
                'Fine. Take your little win.', 'Don’t let it go to your head.'],
    mixed:   ['Split decision. The shoe stays interesting.', 'A little for you, a little for me.',
              'Call it a draw — the house never really loses.']
  };
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  // Always show a scripted line immediately; in model mode the streamed reply
  // overwrites it when (if) it arrives, and an error leaves the scripted line up.
  function dealerSay(t) { $('dealerTalk').textContent = t; }

  /* ============================ MODEL VOICE (B2 enhancement) ============================ */
  // The model NEVER decides play and NEVER sees the hole card until it is up.
  function dealerView(includeHole) {
    var up = dealer[0].r;
    var d = includeHole && !holeHidden
      ? dealer.map(function (c) { return c.r; }).join(',') + ' (total ' + handTotal(dealer).total + ')'
      : up + ' + hidden hole card';
    return 'Dealer showing: ' + d;
  }
  function playerView() {
    return hands.map(function (h, i) {
      var info = handTotal(h.cards);
      return 'Hand ' + (i + 1) + ': ' + h.cards.map(function (c) { return c.r; }).join(',') +
        ' (' + (info.soft ? 'soft ' : '') + info.total + ')' + (h.busted ? ' BUST' : '') + (h.blackjack ? ' BLACKJACK' : '');
    }).join('; ');
  }

  async function voiceDealer(when, extra) {
    var g = gen;
    var sys = 'You are the SLY DEALER at a neon underground blackjack table — smooth, smug, ' +
      'theatrical, a touch menacing but never cruel. You deal the cards; the HOUSE rules decide your play, not you. ' +
      'Reply with ONE or TWO short, punchy lines of in-character table talk. No rules advice, no card values, just attitude.';
    var ctx;
    if (when === 'deal') ctx = 'A fresh hand is dealt. ' + dealerView(false) + '. ' + playerView() + '. Greet the player’s situation.';
    else if (when === 'reveal') ctx = 'You just turned over your hole card and are about to play out the house hand. ' + dealerView(true) + '. React.';
    else ctx = 'The hand just settled. ' + (extra && extra.anyWin && !extra.anyLose ? 'The player BEAT you.' : extra && extra.anyLose && !extra.anyWin ? 'The HOUSE won.' : 'It was a wash.') + ' Net to player: ' + (extra ? extra.net : 0) + '. Gloat or grumble accordingly.';
    streamVoice(sys, ctx, g, function (txt) { $('dealerTalk').textContent = txt; });
  }
  function voiceCoach(label, up, action) {
    var g = gen;
    var sys = 'You are a sharp, friendly blackjack COACH. The correct basic-strategy play has ALREADY been computed for you; ' +
      'your job is only to explain WHY in one or two plain-English sentences. Do not change the recommendation. Be concise and encouraging.';
    var ctx = 'The player has ' + label + ' against the dealer’s ' + up + '. The correct play is: ' + action + '. ' +
      countPhraseText() + ' Explain the reasoning briefly.';
    streamVoice(sys, ctx, g, null);   // streams to think panel only
  }
  function countPhraseText() { var tc = trueCount(); return 'Hi-Lo running count ' + runningCount + ', true count ' + tc.toFixed(1) + '.'; }

  async function streamVoice(sys, ctx, g, onDone) {
    if (aiController) { try { aiController.abort(); } catch (e) {} }
    aiController = new AbortController();
    thinkEl.textContent = '';
    var reply = '';
    try {
      reply = await BYOM.chat({
        endpoint: endpoint(), model: defaultModel, temperature: 0.85,
        maxTokens: aiIsReasoning(defaultModel) ? 1000 : 160,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: ctx }],
        onToken: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        onThinking: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        signal: aiController.signal
      });
    } catch (e) {
      aiController = null;   // model failed — the scripted line (already on screen) stands
      return;
    }
    aiController = null;
    if (g !== gen) return;
    var clean = (reply || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (onDone && clean) onDone(clean.slice(0, 200));
  }

  /* ============================ RENDER ============================ */
  function cardEl(card, faceDown) {
    var el = document.createElement('div');
    if (faceDown) { el.className = 'card back'; el.innerHTML = '<span class="pip">✦</span>'; return el; }
    el.className = 'card ' + card.c;
    var pip = (card.r === 'A' ? 'A' : card.r);
    el.innerHTML = '<span class="rank">' + card.r + card.s + '</span>' +
      '<span class="pip">' + card.s + '</span>' +
      '<span class="rank br">' + card.r + card.s + '</span>';
    return el;
  }

  function renderTable() {
    // dealer
    var dc = $('dealerCards'); dc.innerHTML = '';
    dealer.forEach(function (c, i) { dc.appendChild(cardEl(c, holeHidden && i === 1)); });
    var dt = $('dealerTotal');
    if (holeHidden && dealer.length) {
      dt.className = 'total'; dt.textContent = dealer.length ? cardValue(dealer[0].r) === 11 ? 'A' : cardValue(dealer[0].r) : '';
    } else if (dealer.length) {
      var di = handTotal(dealer);
      dt.textContent = di.total + (di.soft ? ' (soft)' : '');
      dt.className = 'total' + (di.total > 21 ? ' bust' : isBlackjack(dealer) ? ' bj' : '');
    } else dt.textContent = '';

    // player hands
    var pr = $('playerRow'); pr.innerHTML = '';
    hands.forEach(function (h, i) {
      var block = document.createElement('div');
      block.className = 'hand-block';
      if (phase === 'player' && i === active && !h.done) block.classList.add('active');
      if (h.outcome === 'win' || h.outcome === 'bj') block.classList.add('win');
      else if (h.outcome === 'lose') block.classList.add('lose');
      else if (h.outcome === 'push') block.classList.add('push');
      var info = handTotal(h.cards);
      var tcls = 'total' + (h.busted ? ' bust' : h.blackjack ? ' bj' : '');
      var who = hands.length > 1 ? 'Hand ' + (i + 1) : 'You';
      var head = document.createElement('div'); head.className = 'hand-head';
      head.innerHTML = '<span class="who">' + who + '</span><span class="' + tcls + '">' +
        (info.total + (info.soft && !h.busted ? ' (soft)' : '')) + '</span>';
      var cards = document.createElement('div'); cards.className = 'cards';
      h.cards.forEach(function (c) { cards.appendChild(cardEl(c, false)); });
      var betLbl = document.createElement('div'); betLbl.className = 'hand-bet'; betLbl.textContent = 'Bet ' + h.bet + (h.doubled ? ' (doubled)' : '');
      block.appendChild(head); block.appendChild(cards); block.appendChild(betLbl);
      pr.appendChild(block);
    });

    $('scoreShoe').textContent = shoe.length + '/' + (decks * 52);
  }

  function renderBet() {
    $('scoreBank').textContent = bankroll;
    $('scoreBet').textContent = phase === 'bet' ? pendingBet : sumBets();
    $('chips').querySelectorAll('.chip').forEach(function (ch) {
      ch.classList.toggle('disabled', parseInt(ch.dataset.v, 10) > bankroll - pendingBet);
    });
    $('dealBtn').disabled = !(pendingBet > 0 && pendingBet <= bankroll);
  }
  function sumBets() { return hands.reduce(function (s, h) { return s + h.bet; }, 0); }

  function renderActions() {
    var betting = phase === 'bet' || phase === 'done';
    $('betpad').hidden = !betting;
    $('actionbar').hidden = betting;
    if (!betting) {
      var h = curHand();
      var live = phase === 'player' && !busy;
      $('btnHit').disabled = !live;
      $('btnStand').disabled = !live;
      $('btnDouble').disabled = !live || !canDouble(h);
      $('btnSplit').disabled = !live || !canSplit(h);
    }
    if (betting) { renderBet(); if (phase === 'done') $('coach').hidden = !coachOn; else $('coach').hidden = true; }
  }

  function setResult(t, cls) { var el = $('result'); el.className = 'result-line' + (cls ? ' ' + cls : ''); el.textContent = t || (phase === 'bet' || phase === 'done' ? 'Place a bet to deal ▾' : ''); }
  function setCoach(html) { $('coachBody').innerHTML = html; }

  /* ============================ BET PAD ============================ */
  function buildChips() {
    var host = $('chips'); host.innerHTML = '';
    [5, 25, 100, 500].forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.v = v; b.textContent = v;
      b.addEventListener('click', function () { addBet(v); });
      host.appendChild(b);
    });
  }
  function addBet(v) {
    if (phase !== 'bet' && phase !== 'done') return;
    if (phase === 'done') { phase = 'bet'; setResult('', ''); }
    if (pendingBet + v > bankroll) return;
    pendingBet += v; renderBet();
    $('dealerTalk').textContent = '';
  }

  /* ============================ EVENTS ============================ */
  $('clearBet').addEventListener('click', function () { pendingBet = 0; renderBet(); });
  $('dealBtn').addEventListener('click', startRound);
  $('btnHit').addEventListener('click', function () { hit(); if (Math.random() < 0.4) dealerSay(pick(LINES.hit)); });
  $('btnStand').addEventListener('click', stand);
  $('btnDouble').addEventListener('click', doubleDown);
  $('btnSplit').addEventListener('click', split);

  $('deckSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b || phase === 'player' || phase === 'dealer') return;
    seg('deckSeg', b); decks = parseInt(b.dataset.decks, 10); buildShoe(); fullReset();
  });
  $('s17Seg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    seg('s17Seg', b); hitSoft17 = b.dataset.h17 === '1';
    if (phase === 'player') coachTip();
  });
  $('coachSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    seg('coachSeg', b); coachOn = b.dataset.coach === '1';
    if (coachOn && phase === 'player') coachTip(); else if (coachOn && phase === 'done') coachCount(); else $('coach').hidden = true;
  });
  $('voiceSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    seg('voiceSeg', b); voiceMode = b.dataset.voice;
    if (voiceMode === 'script' && aiController) { try { aiController.abort(); } catch (er) {} }
  });
  $('newGame').addEventListener('click', function () {
    if (bankroll <= 0) bankroll = 500;
    buildShoe(); fullReset(); $('dealerTalk').textContent = pick(LINES.shuffle);
  });

  function seg(id, b) { $(id).querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); }); }

  function fullReset() {
    gen++; busy = false;
    if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; }
    dealer = []; hands = []; active = 0; phase = 'bet'; holeHidden = true;
    pendingBet = Math.min(pendingBet, bankroll);
    saveBank();
    setResult('Place a bet to deal ▾', '');
    $('coach').hidden = true;
    renderTable(); renderBet(); renderActions();
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
      setAiStatus(res.error.message + ' — the scripted dealer & coach still run offline.', 'err');
      return;
    }
    modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    modelSel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved
      : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
    modelSel.value = fav; defaultModel = fav; modelReady = true;
    BYOM.saveConfig({ model: fav });
    setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. Pick “Your model” for a live dealer voice.', 'on');
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  /* ============================ BOOT ============================ */
  buildChips();
  buildShoe();
  fullReset();
  $('dealerTalk').textContent = pick(LINES.deal);
  if (BYOM.isLocal()) { endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT; loadModels(); }
  else setAiStatus('Public site — the sly dealer & coach run offline. Run locally to give the dealer a model voice.', '');
})();
