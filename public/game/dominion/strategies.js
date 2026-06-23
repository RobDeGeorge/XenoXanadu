/* ============================================================================
 *  XenoXanadu — Deckforge AI strategies / personas  (pure logic, no DOM)
 *  ----------------------------------------------------------------------------
 *  The built-in offline opponents. Each strategy is a small policy that, given
 *  the live game from engine.js, decides:
 *    • which action to PLAY this action phase (pickPlay → a legal play idx, or -1)
 *    • what to BUY this buy phase            (pickBuy  → a legal buy id, or '__end')
 *    • how to resolve a gain / sift choice   (pickGain / pickSift)
 *  They ONLY ever return choices from the legal lists the engine provides, so a
 *  bot can never make an illegal move — same contract as the model.
 *
 *  Crucially the buy policies ADAPT to whatever kingdom was dealt: they score the
 *  kingdom for engine pieces / draw / +buys / attacks and weight purchases by
 *  what's actually on the table, not a fixed shopping list.
 *
 *  Three personas:
 *    • bigmoney  — "The Treasurer": almost ignores actions, buys Gold→Province.
 *    • engine    — "The Architect": builds an action chain, then converts to VP.
 *    • attack    — "The Raider": prioritises attack cards + pressure, money second.
 *
 *  Exposes window.DeckforgeAI. Depends on window.Deckforge (engine).
 * ========================================================================== */
(function (root) {
  'use strict';
  var E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.Deckforge;

  var PERSONAS = {
    bigmoney: {
      key: 'bigmoney', name: 'The Treasurer', tag: 'TR', hue: 45,
      blurb: 'Pure Big Money. Buys treasure and Provinces, skips fancy engines.',
      style: 'You play classic Big Money: you almost never buy action cards. You buy Gold whenever you can, Province as soon as you can afford it (8+ coins), Duchy late, and Silver early to power up your coins. Cards in deck are a liability — you want fewer, richer cards.'
    },
    engine: {
      key: 'engine', name: 'The Architect', tag: 'AR', hue: 175,
      blurb: 'Engine builder. Chains +action / +card cards, then pivots to VP.',
      style: 'You build an engine: you buy +Action / +Card cards (cantrips, villages, labs) to draw your whole deck each turn, plus +Buy and gain effects to expand fast. Once your engine produces lots of coins and buys, you pivot hard to Provinces. You value non-terminal actions highly.'
    },
    attack: {
      key: 'attack', name: 'The Raider', tag: 'RD', hue: 5,
      blurb: 'Attack-heavy. Hoards Curse-givers / discard attacks to grind foes down.',
      style: 'You play aggressive attack cards: you prioritise buying Curse-givers and discard attacks to wreck opponents, back it with solid money, and close on Provinces. Pressure first, points last — but never miss a Province you can buy.'
    }
  };

  /* ---- kingdom analysis (shared by every adaptive buy policy) -------------- */
  function analyzeKingdom(g) {
    var info = { engine: [], cards: [], money: [], gain: [], attack: [], sift: [], all: g.kingdom.slice() };
    g.kingdom.forEach(function (id) {
      var d = E.cardDef(id);
      if (d.role && info[d.role]) info[d.role].push(id);
    });
    return info;
  }

  /* ---- action phase: which action to play --------------------------------- */
  // Play the most valuable action available; prefer non-terminal (+action) cards
  // first so chains don't fizzle, then terminals. Returns a legal play idx or -1.
  function pickPlay(g) {
    var plays = E.legalPlays(g);                 // already gated to phase==='action'
    if (!plays.length) return -1;
    // sort: non-terminal (gives actions) first, then by draw, then by coin, then cost
    plays.sort(function (a, b) {
      var da = a.def, db = b.def;
      var na = (da.a || 0) > 0 ? 1 : 0, nb = (db.a || 0) > 0 ? 1 : 0;
      if (na !== nb) return nb - na;
      if ((db.c || 0) !== (da.c || 0)) return (db.c || 0) - (da.c || 0);
      if ((db.m || 0) !== (da.m || 0)) return (db.m || 0) - (da.m || 0);
      return db.cost - da.cost;
    });
    // Big-money plays terminals only if they don't strand other actions; but with
    // actions left it's always fine to play one, so just play the top.
    return plays[0].idx;
  }

  /* ---- gain / sift resolution --------------------------------------------- */
  function pickGain(g, maxCost, persona) {
    var opts = E.gainable(g, maxCost);
    if (!opts.length) return null;
    // engine-ish: grab the best action piece; else best treasure; else a Duchy/Estate
    var rank = opts.map(function (id) { return { id: id, s: gainScore(g, id, persona) }; })
      .sort(function (a, b) { return b.s - a.s; });
    return rank[0].id;
  }
  function gainScore(g, id, persona) {
    var d = E.cardDef(id);
    var base = d.cost * 2;
    if (d.type === 'action') {
      if (persona === 'bigmoney') base -= 6;
      if (d.a > 0) base += 6;                       // non-terminal
      base += (d.c || 0) * 2 + (d.m || 0) * 2 + (d.b || 0);
      if (d.attack && persona === 'attack') base += 8;
    } else if (d.type === 'treasure') {
      base += (d.coin || 0) * 3;
    } else if (d.type === 'victory') {
      base += (d.vp || 0) - (g.supply.province > 3 ? 4 : -2);  // grab VP only when piles run low
    }
    return base;
  }
  // Cellar: discard victory cards and surplus coppers (dead/weak in hand).
  function pickSift(g) {
    var p = g.players[g.current], toss = [];
    p.hand.forEach(function (id, i) {
      var d = E.cardDef(id);
      if (d.type === 'victory' || d.type === 'curse') toss.push(i);
      else if (id === 'copper' && p.hand.length > 4) toss.push(i);   // thin a little
    });
    return toss;
  }

  /* ---- buy phase: the adaptive shopping policies --------------------------- */
  function pickBuy(g, persona) {
    var coins = g.coins, buys = E.legalBuys(g), can = {};
    buys.forEach(function (b) { if (!b.endTurn) can[b.id] = true; });
    var prov = g.supply.province;
    var info = analyzeKingdom(g);

    // shared end-game pivot: when Provinces are scarce, grab green.
    function endgameGreen() {
      if (prov <= 4 && can.province && coins >= 8) return 'province';
      if (prov <= 2) {
        if (can.duchy && coins >= 5) return 'duchy';
        if (can.estate && coins >= 2 && prov <= 1) return 'estate';
      }
      return null;
    }

    var pick = null;
    if (persona === 'bigmoney') pick = buyBigMoney(g, coins, can, prov);
    else if (persona === 'engine') pick = buyEngine(g, coins, can, prov, info);
    else pick = buyAttack(g, coins, can, prov, info);

    // any persona still snaps up cheap green when the game is nearly over
    var g2 = endgameGreen();
    if (g2 && (!pick || (pick !== 'province'))) {
      // only override toward green if we weren't already buying a Province
      if (g2 === 'province' || pick == null || E.cardDef(pick).type !== 'action') pick = g2;
    }

    return (pick && can[pick]) ? pick : '__end';
  }

  function buyBigMoney(g, coins, can, prov) {
    if (can.province && coins >= 8) return 'province';
    if (prov <= 4 && can.duchy && coins >= 5) return 'duchy';
    if (can.gold && coins >= 6) return 'gold';
    if (prov <= 2 && can.estate && coins >= 2) return 'estate';
    if (can.silver && coins >= 3) return 'silver';
    return null;
  }

  function buyEngine(g, coins, can, prov, info) {
    // A "smart money + engine" hybrid: a strong simple deck rather than a fragile
    // pure combo. Always take Provinces/Gold; layer in a FEW high-impact action
    // pieces (big draw + payload + buys) early, then convert coins to points.
    // Green LATE — Duchies only when Provinces are nearly gone, so green cards
    // don't clog the deck and starve our coin density before then.
    if (can.province && coins >= 8) return 'province';
    if (prov <= 2 && can.duchy && coins >= 5) return 'duchy';
    if (can.gold && coins >= 6) return 'gold';        // never pass up Gold

    var counts = E.cardCounts(g, g.players[g.current]);
    var actionsOwned = 0;
    g.kingdom.forEach(function (id) { actionsOwned += (counts[id] || 0); });

    // Value an action piece by its NET economic gain — a card only earns a slot if
    // it pays its way (draws into treasure, adds coins, or stacks buys). Cards that
    // merely cycle (a bare +1 card / +1 action) dilute coin density, so they score
    // low. Hard caps keep the deck lean — a thin, treasure-rich deck buys Provinces.
    var ranked = info.all.map(function (id) {
      var d = E.cardDef(id), owned = counts[id] || 0;
      var net = (d.c || 0) - 1;                        // net cards drawn (after the card itself)
      var s = net * 9 + (d.m || 0) * 6 + (d.b || 0) * 4 + (d.gain ? 6 : 0);
      if (d.a > 0) s += 4;                             // chains nicely
      var terminal = d.a === 0 && d.role !== 'gain';
      if (terminal && owned >= 1) s -= 24;            // at most ~1 terminal draw card
      s -= owned * 10;                                 // strong diminishing returns
      if (owned >= 2) s -= 30;                         // ≤2 of any action
      if (d.cost > coins) s = -99;
      return { id: id, s: s };
    }).filter(function (x) { return x.s > 0 && can[x.id]; }).sort(function (a, b) { return b.s - a.s; });

    // Buy at most a handful of action pieces (keep the deck lean); otherwise stack
    // money so coins keep converting into Provinces.
    if (actionsOwned < 4 && ranked.length && ranked[0].s >= 10) return ranked[0].id;
    if (can.gold && coins >= 6) return 'gold';
    if (can.silver && coins >= 3) return 'silver';
    if (ranked.length && ranked[0].s >= 14) return ranked[0].id;
    return null;
  }

  function buyAttack(g, coins, can, prov, info) {
    if (can.province && coins >= 8) return 'province';
    if (prov <= 4 && can.duchy && coins >= 5) return 'duchy';
    var counts = E.cardCounts(g, g.players[g.current]);

    // grab attack cards first (cap at ~3 of each), preferring curse-givers
    var attacks = info.attack.slice().sort(function (a, b) {
      var da = E.cardDef(a), db = E.cardDef(b);
      var pa = da.attack === 'curse' ? 2 : 1, pb = db.attack === 'curse' ? 2 : 1;
      return pb - pa || db.cost - da.cost;
    });
    for (var i = 0; i < attacks.length; i++) {
      var id = attacks[i];
      if (can[id] && (counts[id] || 0) < 3) return id;
    }
    // back it with money
    if (can.gold && coins >= 6) return 'gold';
    if (can.silver && coins >= 3) return 'silver';
    return null;
  }

  /* ---- a full automated turn (used by the offline bot driver) -------------- */
  // Plays out the current player's whole turn deterministically-ish via the
  // policy. Returns a list of human-readable step strings for the log/think
  // panel. The model path in main.js calls the same primitives but can override.
  function botTurn(g, persona) {
    var steps = [];
    // ACTION phase
    var guard = 40;
    while (g.phase === 'action' && guard-- > 0) {
      var idx = pickPlay(g);
      if (idx < 0) break;
      var def = E.cardDef(g.players[g.current].hand[idx]);
      var ev = E.playAction(g, idx);
      if (!ev) break;
      steps.push('Plays ' + def.name + (ev.drew ? ' (+' + ev.drew + ' cards)' : ''));
      if (ev.pending && ev.pending.type === 'gain') {
        var gid = pickGain(g, ev.pending.maxCost, persona);
        if (E.resolveGain(g, ev.pending.maxCost, gid)) steps.push('  → gains ' + E.cardDef(gid).name);
      } else if (ev.pending && ev.pending.type === 'sift') {
        var n = E.resolveSift(g, pickSift(g));
        if (n) steps.push('  → sifts ' + n + ' card(s)');
      }
      if (ev.attack) steps.push('  → ' + (ev.attack.type === 'curse' ? 'curses' : 'forces discard on') + ' the table');
    }
    // BUY phase
    E.playAllTreasures(g);
    steps.push('Has ' + g.coins + ' coin' + (g.coins === 1 ? '' : 's') + ', ' + g.buys + ' buy' + (g.buys === 1 ? '' : 's'));
    var bguard = 12;
    while (g.phase === 'buy' && g.buys > 0 && bguard-- > 0) {
      var id = pickBuy(g, persona);
      if (id === '__end') break;
      if (!E.buyCard(g, id)) break;
      steps.push('Buys ' + E.cardDef(id).name);
    }
    return steps;
  }

  var DeckforgeAI = {
    PERSONAS: PERSONAS, analyzeKingdom: analyzeKingdom,
    pickPlay: pickPlay, pickBuy: pickBuy, pickGain: pickGain, pickSift: pickSift,
    botTurn: botTurn
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DeckforgeAI;
  else root.DeckforgeAI = DeckforgeAI;
})(typeof window !== 'undefined' ? window : globalThis);
