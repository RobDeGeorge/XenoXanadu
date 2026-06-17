/* ============================================================================
 *  XenoXanadu — Texas Hold'em engine (pure logic, no DOM)
 *  ----------------------------------------------------------------------------
 *  A self-contained no-limit Hold'em tournament core: deck, 7-card hand
 *  evaluation, a full betting state-machine (blinds, raises, all-ins, side
 *  pots), and rising-blind tournament bookkeeping.
 *
 *  It knows nothing about the page or the AI — main.js drives it and the model
 *  only ever chooses from the legal actions this file hands back, so a model
 *  can never make an illegal bet.
 *
 *  Exposes window.Poker in the browser; module.exports under Node (for tests).
 *
 *  Card  = { r:2..14, s:'s'|'h'|'d'|'c' }      (11=J 12=Q 13=K 14=A)
 *  State lives on a "tourney" object; the live hand on tourney.hand.
 * ========================================================================== */
(function (root) {
  'use strict';

  // ---- cards ---------------------------------------------------------------
  var SUITS = ['s', 'h', 'd', 'c'];
  var RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  var RANK_CH = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  var RANK_NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven',
    8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  var RANK_NAME_PL = { 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens',
    8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' };

  function rankChar(r) { return RANK_CH[r] || String(r); }
  function cardStr(c) { return c ? rankChar(c.r) + SUIT_SYM[c.s] : '??'; }       // "A♠"
  function cardCode(c) { return c ? rankChar(c.r) + c.s : '??'; }                // "As" (ASCII, for prompts)

  function makeDeck() {
    var d = [];
    for (var i = 0; i < SUITS.length; i++)
      for (var j = 0; j < RANKS.length; j++) d.push({ r: RANKS[j], s: SUITS[i] });
    return d;
  }
  function shuffle(d) {
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
  }

  // ---- 7-card hand evaluation ----------------------------------------------
  // Returns { cat, score, name } where score is a comparable array
  // [category, tiebreak...] (higher wins, compare lexicographically).
  var CAT = { HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5,
    FULL: 6, QUADS: 7, STRAIGHT_FLUSH: 8 };

  function straightHigh(rankSet) {
    // rankSet: Set of ranks present. Returns high card of best straight or 0.
    var has = {};
    rankSet.forEach(function (r) { has[r] = true; });
    if (has[14]) has[1] = true;                 // ace plays low for the wheel
    for (var hi = 14; hi >= 5; hi--) {
      if (has[hi] && has[hi - 1] && has[hi - 2] && has[hi - 3] && has[hi - 4]) return hi;
    }
    return 0;
  }

  function evaluate(cards) {
    // cards: 5..7 Card objects → best 5-card hand value.
    var byCount = {};                  // rank -> count
    var bySuit = { s: [], h: [], d: [], c: [] };
    var allRanks = new Set();
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      byCount[c.r] = (byCount[c.r] || 0) + 1;
      bySuit[c.s].push(c.r);
      allRanks.add(c.r);
    }

    // flush suit (>=5 of a suit)?
    var flushSuit = null;
    for (var s in bySuit) if (bySuit[s].length >= 5) flushSuit = s;

    // straight flush
    if (flushSuit) {
      var sfHi = straightHigh(new Set(bySuit[flushSuit]));
      if (sfHi) return mk(CAT.STRAIGHT_FLUSH, [sfHi]);
    }

    // group ranks by their multiplicity
    var quads = [], trips = [], pairs = [], singles = [];
    Object.keys(byCount).map(Number).sort(function (a, b) { return b - a; }).forEach(function (r) {
      var n = byCount[r];
      if (n === 4) quads.push(r);
      else if (n === 3) trips.push(r);
      else if (n === 2) pairs.push(r);
      else singles.push(r);
    });
    var descRanks = cards.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
    function topKExcluding(k, exclude) {
      var ex = {}; (exclude || []).forEach(function (r) { ex[r] = true; });
      var out = [];
      for (var i = 0; i < descRanks.length && out.length < k; i++) {
        if (!ex[descRanks[i]] && (out.length === 0 || out[out.length - 1] !== descRanks[i])) out.push(descRanks[i]);
      }
      return out;
    }

    // four of a kind
    if (quads.length) return mk(CAT.QUADS, [quads[0]].concat(topKExcluding(1, [quads[0]])));

    // full house (trips + pair, or two trips)
    if (trips.length && (trips.length >= 2 || pairs.length)) {
      var tripRank = trips[0];
      var pairRank = Math.max(trips.length >= 2 ? trips[1] : 0, pairs.length ? pairs[0] : 0);
      return mk(CAT.FULL, [tripRank, pairRank]);
    }

    // flush
    if (flushSuit) {
      var fr = bySuit[flushSuit].slice().sort(function (a, b) { return b - a; }).slice(0, 5);
      return mk(CAT.FLUSH, fr);
    }

    // straight
    var stHi = straightHigh(allRanks);
    if (stHi) return mk(CAT.STRAIGHT, [stHi]);

    // trips
    if (trips.length) return mk(CAT.TRIPS, [trips[0]].concat(topKExcluding(2, [trips[0]])));

    // two pair
    if (pairs.length >= 2) return mk(CAT.TWO_PAIR, [pairs[0], pairs[1]].concat(topKExcluding(1, [pairs[0], pairs[1]])));

    // one pair
    if (pairs.length === 1) return mk(CAT.PAIR, [pairs[0]].concat(topKExcluding(3, [pairs[0]])));

    // high card
    return mk(CAT.HIGH, topKExcluding(5, []));
  }

  function mk(cat, tb) { var score = [cat].concat(tb); return { cat: cat, score: score, name: handName(cat, tb) }; }

  function handName(cat, tb) {
    switch (cat) {
      case CAT.STRAIGHT_FLUSH: return tb[0] === 14 ? 'Royal flush' : 'Straight flush, ' + RANK_NAME[tb[0]] + ' high';
      case CAT.QUADS: return 'Four of a kind, ' + RANK_NAME_PL[tb[0]];
      case CAT.FULL: return 'Full house, ' + RANK_NAME_PL[tb[0]] + ' over ' + RANK_NAME_PL[tb[1]];
      case CAT.FLUSH: return 'Flush, ' + RANK_NAME[tb[0]] + ' high';
      case CAT.STRAIGHT: return 'Straight, ' + RANK_NAME[tb[0]] + ' high';
      case CAT.TRIPS: return 'Three of a kind, ' + RANK_NAME_PL[tb[0]];
      case CAT.TWO_PAIR: return 'Two pair, ' + RANK_NAME_PL[tb[0]] + ' and ' + RANK_NAME_PL[tb[1]];
      case CAT.PAIR: return 'Pair of ' + RANK_NAME_PL[tb[0]];
      default: return RANK_NAME[tb[0]] + '-high';
    }
  }

  function cmpScore(a, b) {
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  // ---- side pots -----------------------------------------------------------
  // committed[i] = total chips seat i put in this hand; folded[i] = forfeited.
  // Returns [{ amount, eligible:[seat...], contributors:[seat...] }] from main
  // pot outward. An uncalled bet falls out naturally as a pot whose sole
  // eligible seat is the bettor. A pot whose contributors ALL folded has empty
  // `eligible`; resolve() refunds those (uncontested) chips to its contributors.
  function buildPots(committed, folded) {
    var seats = [];
    for (var i = 0; i < committed.length; i++) if (committed[i] > 0) seats.push({ i: i, c: committed[i], folded: !!folded[i] });
    var levels = [];
    seats.forEach(function (x) { if (levels.indexOf(x.c) < 0) levels.push(x.c); });
    levels.sort(function (a, b) { return a - b; });

    var pots = [], prev = 0;
    levels.forEach(function (L) {
      var contributors = seats.filter(function (x) { return x.c >= L; }).map(function (x) { return x.i; });
      var amount = (L - prev) * contributors.length;
      var eligible = contributors.filter(function (s) { return !folded[s]; });
      prev = L;
      if (amount <= 0) return;
      var ekey = eligible.join(','), ckey = contributors.join(',');
      var last = pots[pots.length - 1];
      // merge only when BOTH winners and contributors match, so refunds stay exact
      if (last && last.ekey === ekey && last.ckey === ckey) last.amount += amount;
      else pots.push({ amount: amount, eligible: eligible, contributors: contributors, ekey: ekey, ckey: ckey });
    });
    return pots.map(function (p) { return { amount: p.amount, eligible: p.eligible, contributors: p.contributors }; });
  }

  // ============================ TOURNAMENT ==================================

  var DEFAULT_LEVELS = [
    { sb: 25, bb: 50 }, { sb: 50, bb: 100 }, { sb: 75, bb: 150 }, { sb: 100, bb: 200 },
    { sb: 150, bb: 300 }, { sb: 200, bb: 400 }, { sb: 300, bb: 600 }, { sb: 400, bb: 800 },
    { sb: 600, bb: 1200 }, { sb: 800, bb: 1600 }, { sb: 1200, bb: 2400 }, { sb: 2000, bb: 4000 },
    { sb: 3000, bb: 6000 }, { sb: 5000, bb: 10000 }
  ];

  // seatDefs: [{ name, isHuman, isAI, persona, tag, hue, modelOverride }]
  function createTournament(seatDefs, opts) {
    opts = opts || {};
    var stack = opts.startingStack || 5000;
    var t = {
      seats: seatDefs.map(function (d, i) {
        return {
          id: i, name: d.name, isHuman: !!d.isHuman, isAI: !!d.isAI,
          persona: d.persona || null, tag: d.tag || '??', hue: (d.hue == null ? 150 : d.hue),
          modelOverride: d.modelOverride || null,
          chips: stack, out: false, place: 0
        };
      }),
      button: null, level: 0, handNum: 0,
      levelSchedule: opts.levels || DEFAULT_LEVELS,
      handsPerLevel: opts.handsPerLevel || 8,
      startingStack: stack,
      hand: null, over: false, winner: null,
      finishOrder: []           // seats in elimination order, last entry = champion
    };
    return t;
  }

  function aliveCount(t) { var n = 0; t.seats.forEach(function (s) { if (s.chips > 0) n++; }); return n; }
  function nextAlive(t, from) {
    var n = t.seats.length;
    for (var k = 1; k <= n; k++) { var i = (from + k) % n; if (t.seats[i].chips > 0) return i; }
    return from;
  }
  function level(t) { return t.levelSchedule[Math.min(t.levelSchedule.length - 1, t.level)]; }

  function actionable(t, i) {
    var h = t.hand;
    return h.inHand[i] && !h.allIn[i] && t.seats[i].chips > 0;
  }
  function needsAct(t, i) {
    var h = t.hand;
    return actionable(t, i) && (!h.acted[i] || h.streetBet[i] < h.currentBet);
  }
  function contestableCount(t) {
    var n = 0; for (var i = 0; i < t.seats.length; i++) if (actionable(t, i)) n++; return n;
  }
  function inHandCount(t) {
    var n = 0; for (var i = 0; i < t.seats.length; i++) if (t.hand.inHand[i]) n++; return n;
  }
  function findNextToAct(t, startInclusive) {
    var n = t.seats.length;
    for (var k = 0; k < n; k++) { var i = (startInclusive + k) % n; if (needsAct(t, i)) return i; }
    return -1;
  }

  function commit(t, i, amt) {
    if (amt <= 0) return;
    var h = t.hand;
    t.seats[i].chips -= amt;
    h.streetBet[i] += amt;
    h.committed[i] += amt;
    h.pot += amt;
    if (t.seats[i].chips === 0) h.allIn[i] = true;
  }

  function startHand(t) {
    t.handNum++;
    t.level = Math.floor((t.handNum - 1) / t.handsPerLevel);
    var lvl = level(t);
    var n = t.seats.length;

    t.button = (t.button == null) ? firstAlive(t) : nextAlive(t, t.button);
    var alive = aliveCount(t);
    var sb, bb, first;
    if (alive === 2) { sb = t.button; bb = nextAlive(t, t.button); first = t.button; }
    else { sb = nextAlive(t, t.button); bb = nextAlive(t, sb); first = nextAlive(t, bb); }

    var deck = shuffle(makeDeck());
    var h = {
      street: 'preflop', board: [], deck: deck, hole: [],
      inHand: [], allIn: [], acted: [], streetBet: [], committed: [],
      currentBet: 0, lastRaiseSize: lvl.bb, lastAggressor: -1,
      toAct: -1, button: t.button, sb: sb, bb: bb, sbAmt: lvl.sb, bbAmt: lvl.bb,
      pot: 0, complete: false, result: null
    };
    t.hand = h;
    for (var i = 0; i < n; i++) {
      var live = t.seats[i].chips > 0;
      h.inHand[i] = live; h.allIn[i] = false; h.acted[i] = false;
      h.streetBet[i] = 0; h.committed[i] = 0;
      h.hole[i] = live ? [deck.pop(), deck.pop()] : null;
    }

    commit(t, sb, Math.min(lvl.sb, t.seats[sb].chips));
    commit(t, bb, Math.min(lvl.bb, t.seats[bb].chips));
    h.currentBet = Math.max.apply(null, h.streetBet);
    h.lastRaiseSize = lvl.bb;

    h.toAct = resolveToAct(t, first);
    return h;
  }
  function firstAlive(t) { for (var i = 0; i < t.seats.length; i++) if (t.seats[i].chips > 0) return i; return 0; }

  // pick the next seat with a real decision; skip a lone player who has nothing to call
  function resolveToAct(t, startInclusive) {
    var i = findNextToAct(t, startInclusive);
    if (i < 0) return -1;
    if (contestableCount(t) < 2 && (t.hand.currentBet - t.hand.streetBet[i]) <= 0) return -1;
    return i;
  }

  // What the seat on the button-relative "first to act" of a street is (postflop = left of button)
  function postflopStart(t) { return (t.hand.button + 1) % t.seats.length; }

  function legalActions(t) {
    var h = t.hand, i = h.toAct;
    if (i < 0) return null;
    var seat = t.seats[i];
    var need = h.currentBet - h.streetBet[i];
    var callAmt = Math.min(need, seat.chips);
    var maxRaiseTo = h.streetBet[i] + seat.chips;            // all-in total this street
    var minRaiseTo = Math.min(h.currentBet + h.lastRaiseSize, maxRaiseTo);
    return {
      seat: i, need: need,
      canCheck: need <= 0,
      canCall: need > 0 && seat.chips > 0,
      callAmt: callAmt,
      canRaise: seat.chips > 0 && maxRaiseTo > h.currentBet,
      minRaiseTo: minRaiseTo, maxRaiseTo: maxRaiseTo,
      currentBet: h.currentBet, streetBet: h.streetBet[i],
      chips: seat.chips, pot: h.pot, canFold: true
    };
  }

  // action: { type:'fold'|'check'|'call'|'raise'|'allin', amount? }
  // amount on a raise = total this-street bet to raise TO. Returns an event record.
  function applyAction(t, action) {
    var h = t.hand, i = h.toAct, seat = t.seats[i];
    if (i < 0 || h.complete) return null;
    var need = h.currentBet - h.streetBet[i];
    var ev = { seat: i, type: action.type, amount: 0, allIn: false, street: h.street };

    if (action.type === 'fold') {
      h.inHand[i] = false;
    } else if (action.type === 'check') {
      h.acted[i] = true;
    } else if (action.type === 'call') {
      var pay = Math.min(need, seat.chips);
      commit(t, i, pay); h.acted[i] = true; ev.amount = pay;
    } else { // raise / allin
      var target = (action.type === 'allin') ? (h.streetBet[i] + seat.chips) : action.amount;
      var maxTo = h.streetBet[i] + seat.chips;
      var minTo = h.currentBet + h.lastRaiseSize;
      if (target > maxTo) target = maxTo;
      if (target < minTo && target < maxTo) target = minTo;       // enforce min-raise unless all-in for less
      var pay2 = target - h.streetBet[i];
      commit(t, i, pay2); ev.amount = pay2;
      if (target > h.currentBet) {
        var raiseSize = target - h.currentBet;
        if (raiseSize >= h.lastRaiseSize) h.lastRaiseSize = raiseSize;   // full raise sets the new bar
        h.currentBet = target;
        h.lastAggressor = i;
        for (var j = 0; j < t.seats.length; j++) if (actionable(t, j) && j !== i) h.acted[j] = false;
      }
      h.acted[i] = true;
    }
    ev.allIn = h.allIn[i];
    ev.streetTotal = h.streetBet[i];     // capture before endStreet() may reset it

    if (inHandCount(t) === 1) { h.street = 'done'; h.complete = true; h.toAct = -1; return ev; }

    var nxt = findNextToAct(t, i + 1);
    if (nxt < 0) endStreet(t);
    else h.toAct = nxt;
    return ev;
  }

  var STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  function endStreet(t) {
    var h = t.hand;
    var nextStreet = STREETS[STREETS.indexOf(h.street) + 1];
    h.street = nextStreet;
    for (var i = 0; i < t.seats.length; i++) { h.streetBet[i] = 0; h.acted[i] = false; }
    h.currentBet = 0; h.lastRaiseSize = h.bbAmt;

    if (nextStreet === 'showdown') { h.complete = true; h.toAct = -1; return; }
    if (nextStreet === 'flop') { h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop()); }
    else { h.board.push(h.deck.pop()); }

    h.toAct = resolveToAct(t, postflopStart(t));
  }

  // Deal one more street with no betting (used by the UI to reveal an all-in
  // run-out one card group at a time). Safe to call whenever toAct<0 and the
  // hand isn't finished.
  function runoutStep(t) {
    var h = t.hand;
    if (h.complete || h.toAct >= 0) return false;
    endStreet(t);
    return true;
  }

  // Resolve the finished hand: build pots, evaluate, pay out, update standings.
  function resolve(t) {
    var h = t.hand;
    var pots = buildPots(h.committed, h.inHand.map(function (v) { return !v; }));
    var board = h.board;

    // evaluate each player still in the hand
    var hands = {};
    for (var i = 0; i < t.seats.length; i++) {
      if (h.inHand[i] && h.hole[i]) hands[i] = evaluate(h.hole[i].concat(board));
    }

    var payouts = {};
    var potResults = [];
    var anyShowdown = false;
    pots.forEach(function (pot, idx) {
      var elig = pot.eligible;
      var winners;
      if (elig.length === 0) {
        // nobody left to contest these chips — refund equally to contributors
        // (each put in the same per-band amount, so this returns exactly that)
        var refund = Math.floor(pot.amount / pot.contributors.length);
        var oddR = pot.amount - refund * pot.contributors.length;
        orderFromButton(t, pot.contributors).forEach(function (s, k) {
          payouts[s] = (payouts[s] || 0) + refund + (k < oddR ? 1 : 0);
        });
        potResults.push({ amount: pot.amount, eligible: [], winners: pot.contributors.slice(), refund: true, label: idx === 0 ? 'Main pot' : 'Side pot ' + idx });
        return;
      }
      if (elig.length === 1) {
        winners = elig.slice();
      } else {
        anyShowdown = true;
        var best = null;
        elig.forEach(function (s) { if (!best || cmpScore(hands[s].score, best) > 0) best = hands[s].score; });
        winners = elig.filter(function (s) { return cmpScore(hands[s].score, best) === 0; });
      }
      // split, odd chips to first winner seat clockwise from button
      var share = Math.floor(pot.amount / winners.length);
      var odd = pot.amount - share * winners.length;
      var ordered = orderFromButton(t, winners);
      ordered.forEach(function (s, k) {
        var amt = share + (k < odd ? 1 : 0);
        payouts[s] = (payouts[s] || 0) + amt;
      });
      potResults.push({ amount: pot.amount, eligible: elig, winners: ordered, label: idx === 0 ? 'Main pot' : 'Side pot ' + idx });
    });

    for (var s in payouts) t.seats[s].chips += payouts[s];

    h.result = {
      pots: potResults, payouts: payouts, hands: hands,
      showdown: anyShowdown && h.street === 'showdown', board: board.slice()
    };
    updateStandings(t);
    return h.result;
  }

  function orderFromButton(t, seatList) {
    var n = t.seats.length, out = [];
    for (var k = 1; k <= n; k++) { var i = (t.button + k) % n; if (seatList.indexOf(i) >= 0) out.push(i); }
    return out;
  }

  function updateStandings(t) {
    // newly busted players record their finishing place
    var aliveNow = [];
    t.seats.forEach(function (s) {
      if (s.chips <= 0 && !s.out) { s.out = true; }
      if (s.chips > 0) aliveNow.push(s.id);
    });
    // finishing order: anyone marked out and not yet recorded gets recorded now
    t.seats.forEach(function (s) {
      if (s.out && t.finishOrder.indexOf(s.id) < 0) t.finishOrder.push(s.id);
    });
    if (aliveNow.length === 1) {
      t.over = true; t.winner = aliveNow[0];
      if (t.finishOrder.indexOf(t.winner) < 0) t.finishOrder.push(t.winner);
      // places: champion = 1
      var order = t.finishOrder.slice().reverse();
      order.forEach(function (id, k) { t.seats[id].place = k + 1; });
    }
  }

  // ---- exports -------------------------------------------------------------
  var Poker = {
    SUITS: SUITS, RANKS: RANKS, CAT: CAT, DEFAULT_LEVELS: DEFAULT_LEVELS,
    rankChar: rankChar, cardStr: cardStr, cardCode: cardCode, suitSym: function (s) { return SUIT_SYM[s]; },
    makeDeck: makeDeck, shuffle: shuffle,
    evaluate: evaluate, handName: handName, cmpScore: cmpScore, buildPots: buildPots,
    createTournament: createTournament, startHand: startHand, legalActions: legalActions,
    applyAction: applyAction, endStreet: endStreet, runoutStep: runoutStep, resolve: resolve,
    aliveCount: aliveCount, contestableCount: contestableCount, inHandCount: inHandCount,
    actionable: actionable, level: level, RANK_NAME: RANK_NAME, RANK_NAME_PL: RANK_NAME_PL
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Poker;
  else root.Poker = Poker;
})(typeof window !== 'undefined' ? window : globalThis);
