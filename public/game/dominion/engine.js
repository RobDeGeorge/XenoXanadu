/* ============================================================================
 *  XenoXanadu — Dominion ("Deckforge") engine  (pure logic, no DOM)
 *  ----------------------------------------------------------------------------
 *  A self-contained 2-player deckbuilder core. Original / generic card set to
 *  steer clear of any trademark — treasures (Copper/Silver/Gold), victory cards
 *  (Estate/Duchy/Province) and a kingdom of ~10 renamed action cards drawn from
 *  a pool ("Hamlet" ≈ +card/+action, "Forge" ≈ +cards, "Bazaar" ≈ +coin/buy, …).
 *
 *  Turn = Action phase (play action cards, spend actions) → Buy phase (play
 *  treasures, then buy 1 card if you can afford it) → Cleanup (discard hand +
 *  played, draw 5). Game ends when the Province pile empties OR any 3 supply
 *  piles are empty; most victory points wins (ties broken by fewer turns taken).
 *
 *  It knows nothing about the page or the AI. main.js drives it and the bots /
 *  model only ever choose from the legal lists this file hands back
 *  (`legalPlays`, `legalBuys`), so nothing illegal can ever touch state.
 *
 *  Exposes window.Deckforge in the browser; module.exports under Node (tests).
 * ========================================================================== */
(function (root) {
  'use strict';

  /* ---- card definitions ---------------------------------------------------
   * Every card: { id, name, type:'treasure'|'victory'|'curse'|'action',
   *   cost, coin?, vp?, blurb, effect? }. `effect` is a pure function of the
   *   per-turn play state (no DOM). Action cards declare +cards/+actions/+coin/
   *   +buys and optional special hooks (attack / gain) handled in playAction.
   */
  var BASE = {
    copper:   { id: 'copper',   name: 'Copper',   type: 'treasure', cost: 0, coin: 1, blurb: 'Worth 1 coin when played.' },
    silver:   { id: 'silver',   name: 'Silver',   type: 'treasure', cost: 3, coin: 2, blurb: 'Worth 2 coins when played.' },
    gold:     { id: 'gold',     name: 'Gold',     type: 'treasure', cost: 6, coin: 3, blurb: 'Worth 3 coins when played.' },
    estate:   { id: 'estate',   name: 'Estate',   type: 'victory',  cost: 2, vp: 1, blurb: 'Worth 1 victory point.' },
    duchy:    { id: 'duchy',    name: 'Duchy',    type: 'victory',  cost: 5, vp: 3, blurb: 'Worth 3 victory points.' },
    province: { id: 'province', name: 'Province', type: 'victory',  cost: 8, vp: 6, blurb: 'Worth 6 victory points.' },
    curse:    { id: 'curse',    name: 'Curse',    type: 'curse',    cost: 0, vp: -1, blurb: 'Worth -1 victory point. Dead weight.' }
  };

  // Kingdom action-card pool. `a`/`c`/`m`/`b` = +actions/+cards/+coin(money)/+buys.
  // Special tags drive the engine: attack:'curse' (give foe a curse), attack:'discard'
  // (foe discards down to discardTo), gain:{maxCost} (gain a card costing ≤ maxCost),
  // trash:n (trash up to n from hand). Kept small, deliberate, classic-shaped.
  var KINGDOM_POOL = [
    { id: 'hamlet',   name: 'Hamlet',    cost: 3, a: 2, c: 1, m: 0, b: 0, role: 'engine',
      blurb: '+1 Card, +2 Actions. The backbone of any action chain.' },
    { id: 'forge',    name: 'Forge',     cost: 4, a: 0, c: 3, m: 0, b: 0, role: 'cards',
      blurb: '+3 Cards. Pure draw — refills your hand.' },
    { id: 'bazaar',   name: 'Bazaar',    cost: 5, a: 2, c: 1, m: 1, b: 0, role: 'engine',
      blurb: '+1 Card, +2 Actions, +1 Coin. Action chain that also pays.' },
    { id: 'market',   name: 'Trade Row', cost: 5, a: 1, c: 1, m: 1, b: 1, role: 'engine',
      blurb: '+1 Card, +1 Action, +1 Coin, +1 Buy. The all-rounder.' },
    { id: 'coinmint', name: 'Coin Mint', cost: 4, a: 0, c: 0, m: 2, b: 0, role: 'money',
      blurb: '+2 Coins. Non-terminal money? No — terminal, but pure cash.' },
    { id: 'workshop', name: 'Workshop',  cost: 3, a: 0, c: 0, m: 0, b: 0, role: 'gain',
      gain: { maxCost: 4 }, blurb: 'Gain a card costing up to 4. Builds your deck fast.' },
    { id: 'depot',    name: 'Depot',     cost: 6, a: 0, c: 0, m: 0, b: 0, role: 'gain',
      gain: { maxCost: 5 }, blurb: 'Gain a card costing up to 5 (often a Duchy or engine piece).' },
    { id: 'patrol',   name: 'Patrol',    cost: 5, a: 0, c: 3, m: 0, b: 0, role: 'cards',
      blurb: '+3 Cards. A bigger, costlier Forge.' },
    { id: 'cellar',   name: 'Cellar',    cost: 2, a: 1, c: 0, m: 0, b: 0, role: 'sift',
      sift: true, blurb: '+1 Action, then discard any number of cards and draw that many.' },
    { id: 'militia',  name: 'Raiders',   cost: 4, a: 0, c: 0, m: 2, b: 0, role: 'attack',
      attack: 'discard', discardTo: 3, blurb: '+2 Coins. Each opponent discards down to 3 cards.' },
    { id: 'witch',    name: 'Hex',       cost: 5, a: 0, c: 2, m: 0, b: 0, role: 'attack',
      attack: 'curse', blurb: '+2 Cards. Each opponent gains a Curse (-1 VP).' },
    { id: 'spy',      name: 'Scout',     cost: 4, a: 1, c: 1, m: 0, b: 0, role: 'engine',
      blurb: '+1 Card, +1 Action. A cheap cantrip that thins your draws.' },
    { id: 'festival', name: 'Revel',     cost: 5, a: 2, c: 0, m: 2, b: 1, role: 'engine',
      blurb: '+2 Actions, +2 Coins, +1 Buy. Terminal-clearing money + buys.' },
    { id: 'lab',      name: 'Atelier',   cost: 5, a: 1, c: 2, m: 0, b: 0, role: 'engine',
      blurb: '+2 Cards, +1 Action. Non-terminal draw — chains forever.' },
    { id: 'woodcut',  name: 'Lumberjack', cost: 3, a: 0, c: 0, m: 2, b: 1, role: 'money',
      blurb: '+2 Coins, +1 Buy. Terminal money that lets you double-buy.' }
  ];

  function poolMap() { var m = {}; KINGDOM_POOL.forEach(function (k) { m[k.id] = k; }); return m; }
  var POOL = poolMap();

  // Full card lookup: a kingdom action becomes a card record with type 'action'.
  function cardDef(id) {
    if (BASE[id]) return BASE[id];
    var k = POOL[id];
    if (!k) return null;
    return {
      id: k.id, name: k.name, type: 'action', cost: k.cost,
      a: k.a, c: k.c, m: k.m, b: k.b, role: k.role,
      attack: k.attack || null, discardTo: k.discardTo, gain: k.gain || null,
      sift: !!k.sift, blurb: k.blurb
    };
  }

  /* ---- deterministic-ish RNG helpers -------------------------------------- */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---- supply selection ---------------------------------------------------- */
  // Pick `count` distinct kingdom cards (returns their ids). Spread across roles
  // so the bots always have an engine piece, money, draw, gain and an attack.
  function pickKingdom(count) {
    count = count || 10;
    var byRole = {};
    KINGDOM_POOL.forEach(function (k) { (byRole[k.role] = byRole[k.role] || []).push(k.id); });
    var chosen = [];
    // guarantee at least one of each key role if available
    ['engine', 'cards', 'money', 'gain', 'attack', 'sift'].forEach(function (r) {
      if (byRole[r] && byRole[r].length) chosen.push(shuffle(byRole[r].slice())[0]);
    });
    var rest = KINGDOM_POOL.map(function (k) { return k.id; }).filter(function (id) { return chosen.indexOf(id) < 0; });
    shuffle(rest);
    while (chosen.length < count && rest.length) chosen.push(rest.shift());
    return shuffle(chosen).slice(0, count);
  }

  /* ---- game construction --------------------------------------------------- */
  // playerDefs: [{ name, isHuman, isAI, persona?, strategy? }]  (exactly 2 here,
  // but the core is written for N>=2). opts.kingdom = explicit id list (else random).
  function createGame(playerDefs, opts) {
    opts = opts || {};
    var nP = playerDefs.length;
    var kingdom = (opts.kingdom && opts.kingdom.length) ? opts.kingdom.slice() : pickKingdom(opts.kingdomSize || 10);

    // supply pile counts. Victory piles: 8 each for 2p; curses 10*(n-1); kingdom 10.
    var supply = {};
    var vCount = nP <= 2 ? 8 : 12;
    supply.copper = 60 - nP * 7;
    supply.silver = 40;
    supply.gold = 30;
    supply.estate = vCount;
    supply.duchy = vCount;
    supply.province = vCount;
    supply.curse = 10 * (nP - 1);
    kingdom.forEach(function (id) { supply[id] = 10; });

    var players = playerDefs.map(function (d, i) {
      // starting deck: 7 Coppers + 3 Estates, shuffled, draw 5
      var deck = shuffle(
        Array.apply(null, Array(7)).map(function () { return 'copper'; })
          .concat(Array.apply(null, Array(3)).map(function () { return 'estate'; }))
      );
      var hand = deck.splice(0, 5);
      return {
        id: i, name: d.name, isHuman: !!d.isHuman, isAI: !!d.isAI,
        persona: d.persona || null, strategy: d.strategy || 'bigmoney',
        deck: deck, hand: hand, discard: [], play: [],
        turns: 0
      };
    });

    var g = {
      players: players, kingdom: kingdom, supply: supply,
      nPlayers: nP, current: 0, turnNo: 0,
      phase: 'action',            // 'action' | 'buy'
      actions: 1, coins: 0, buys: 1,
      over: false, winner: null,
      log: []
    };
    return g;
  }

  /* ---- deck mechanics ------------------------------------------------------ */
  function drawCards(g, p, n) {
    var drawn = [];
    for (var i = 0; i < n; i++) {
      if (p.deck.length === 0) {
        if (p.discard.length === 0) break;       // truly out of cards
        p.deck = shuffle(p.discard); p.discard = [];
      }
      drawn.push(p.deck.pop());
    }
    p.hand = p.hand.concat(drawn);
    return drawn;
  }

  function startTurn(g) {
    var p = g.players[g.current];
    g.phase = 'action'; g.actions = 1; g.coins = 0; g.buys = 1;
    g.turnNo++; p.turns++;
    g.log.push({ t: 'turn', who: p.id, name: p.name, turn: p.turns });
  }

  /* ---- legal options ------------------------------------------------------- */
  // In the action phase: playable actions (need actions>0). In the buy phase:
  // treasures still in hand are auto-playable; we expose them so the UI/model
  // can "play treasures". Returns an array of { idx, id, def } for cards in hand.
  function legalPlays(g) {
    var p = g.players[g.current], out = [];
    p.hand.forEach(function (id, idx) {
      var def = cardDef(id);
      if (g.phase === 'action') {
        if (def.type === 'action' && g.actions > 0) out.push({ idx: idx, id: id, def: def });
      } else {                       // buy phase: only treasures are "played"
        if (def.type === 'treasure') out.push({ idx: idx, id: id, def: def });
      }
    });
    return out;
  }

  // Cards the current player can BUY right now (buy phase, buys>0, affordable,
  // pile not empty). Always includes a synthetic { id:'__end', endTurn:true }
  // so "buy nothing / end" is a first-class legal choice.
  function legalBuys(g) {
    var out = [];
    if (g.phase === 'buy' && g.buys > 0) {
      allSupplyIds(g).forEach(function (id) {
        if (g.supply[id] > 0) {
          var def = cardDef(id);
          if (def.cost <= g.coins) out.push({ id: id, def: def, cost: def.cost });
        }
      });
    }
    out.sort(function (a, b) { return b.cost - a.cost || a.id.localeCompare(b.id); });
    out.push({ id: '__end', endTurn: true, def: { name: 'End turn', cost: 0 }, cost: 0 });
    return out;
  }

  function allSupplyIds(g) {
    return ['province', 'duchy', 'estate', 'gold', 'silver', 'copper', 'curse'].concat(g.kingdom)
      .filter(function (id) { return g.supply[id] != null; });
  }

  /* ---- actions ------------------------------------------------------------- */
  // Play the action card at hand index `idx`. Returns an event describing what
  // happened (and any pending choice the caller must resolve). Illegal calls are
  // ignored (returns null) — the engine is the source of truth.
  function playAction(g, idx) {
    if (g.phase !== 'action') return null;
    var p = g.players[g.current];
    var id = p.hand[idx];
    if (id == null) return null;
    var def = cardDef(id);
    if (def.type !== 'action' || g.actions <= 0) return null;

    // move card to the play area, spend one action
    p.hand.splice(idx, 1); p.play.push(id);
    g.actions -= 1;

    var ev = { t: 'play', who: p.id, id: id, name: def.name, gained: null, attack: null, pending: null };

    // resource deltas
    g.actions += (def.a || 0);
    g.coins += (def.m || 0);
    g.buys += (def.b || 0);
    if (def.c) ev.drew = drawCards(g, p, def.c).length;

    // gain effect (Workshop/Depot): caller resolves the choice via resolveGain
    if (def.gain) ev.pending = { type: 'gain', maxCost: def.gain.maxCost };

    // sift (Cellar): caller resolves via resolveSift
    if (def.sift) ev.pending = { type: 'sift' };

    // attacks: apply immediately to every other player
    if (def.attack === 'curse') {
      ev.attack = { type: 'curse', hit: [] };
      g.players.forEach(function (op) {
        if (op.id === p.id) return;
        if (g.supply.curse > 0) { g.supply.curse--; op.discard.push('curse'); ev.attack.hit.push(op.id); }
      });
    } else if (def.attack === 'discard') {
      ev.attack = { type: 'discard', to: def.discardTo, hit: [] };
      g.players.forEach(function (op) {
        if (op.id === p.id) return;
        var over = op.hand.length - def.discardTo;
        if (over > 0) {
          // discard the lowest-value cards (engine auto-resolves the opponent's
          // discard so a bot/model never has to babysit a foe's hand)
          var ranked = op.hand.map(function (cid, i) { return { i: i, v: keepValue(cid) }; })
            .sort(function (a, b) { return a.v - b.v; });
          var toss = ranked.slice(0, over).map(function (x) { return x.i; }).sort(function (a, b) { return b - a; });
          toss.forEach(function (i) { op.discard.push(op.hand.splice(i, 1)[0]); });
          ev.attack.hit.push(op.id);
        }
      });
    }
    g.log.push(ev);
    return ev;
  }

  // higher = more worth keeping in hand when forced to discard
  function keepValue(id) {
    var d = cardDef(id);
    if (d.type === 'action') return 50 + d.cost;
    if (d.type === 'treasure') return 20 + (d.coin || 0) * 3;
    if (d.type === 'victory' || d.type === 'curse') return 0;  // dead in hand
    return 5;
  }

  // Resolve a Workshop/Depot gain. `gainId` must be a legal gainable card
  // (in supply, cost ≤ maxCost). Bad id → no-op (returns false).
  function resolveGain(g, maxCost, gainId) {
    if (gainId == null) return false;                 // declined / nothing
    if (g.supply[gainId] == null || g.supply[gainId] <= 0) return false;
    var def = cardDef(gainId);
    if (!def || def.cost > maxCost) return false;
    g.supply[gainId]--; g.players[g.current].discard.push(gainId);
    g.log.push({ t: 'gain', who: g.current, id: gainId, name: def.name });
    return true;
  }

  function gainable(g, maxCost) {
    return allSupplyIds(g).filter(function (id) {
      return g.supply[id] > 0 && cardDef(id).cost <= maxCost;
    });
  }

  // Resolve a Cellar sift: discard the given hand indices, then draw that many.
  function resolveSift(g, indices) {
    var p = g.players[g.current];
    indices = (indices || []).slice().sort(function (a, b) { return b - a; });
    var n = 0;
    indices.forEach(function (i) {
      if (i >= 0 && i < p.hand.length) { p.discard.push(p.hand.splice(i, 1)[0]); n++; }
    });
    var drew = drawCards(g, p, n);
    g.log.push({ t: 'sift', who: p.id, discarded: n, drew: drew.length });
    return drew.length;
  }

  /* ---- buy phase ----------------------------------------------------------- */
  function toBuyPhase(g) { if (g.phase === 'action') g.phase = 'buy'; }

  // Play a single treasure from hand (buy phase). Returns its coin value or 0.
  function playTreasure(g, idx) {
    if (g.phase !== 'buy') return 0;
    var p = g.players[g.current];
    var id = p.hand[idx];
    var def = id != null ? cardDef(id) : null;
    if (!def || def.type !== 'treasure') return 0;
    p.hand.splice(idx, 1); p.play.push(id);
    g.coins += def.coin;
    return def.coin;
  }

  // Auto-play every treasure in hand (the common case).
  function playAllTreasures(g) {
    toBuyPhase(g);
    var p = g.players[g.current], total = 0;
    for (var i = p.hand.length - 1; i >= 0; i--) {
      var def = cardDef(p.hand[i]);
      if (def.type === 'treasure') { g.coins += def.coin; total += def.coin; p.play.push(p.hand.splice(i, 1)[0]); }
    }
    if (total) g.log.push({ t: 'treasure', who: p.id, coins: total });
    return total;
  }

  // Buy a card: must be in buy phase, buys>0, affordable, pile non-empty.
  // Returns true on success. (Card goes to discard, as in Dominion.)
  function buyCard(g, id) {
    if (g.phase !== 'buy' || g.buys <= 0) return false;
    if (g.supply[id] == null || g.supply[id] <= 0) return false;
    var def = cardDef(id);
    if (def.cost > g.coins) return false;
    g.supply[id]--; g.coins -= def.cost; g.buys -= 1;
    g.players[g.current].discard.push(id);
    g.log.push({ t: 'buy', who: g.current, id: id, name: def.name, cost: def.cost });
    return true;
  }

  /* ---- cleanup / end of turn ----------------------------------------------- */
  function cleanup(g) {
    var p = g.players[g.current];
    p.discard = p.discard.concat(p.hand).concat(p.play);
    p.hand = []; p.play = [];
    drawCards(g, p, 5);
    if (checkEnd(g)) { finish(g); return true; }
    g.current = (g.current + 1) % g.nPlayers;
    startTurn(g);
    return false;
  }

  /* ---- end conditions + scoring -------------------------------------------- */
  function emptyPiles(g) {
    var n = 0;
    allSupplyIds(g).forEach(function (id) { if (g.supply[id] === 0) n++; });
    return n;
  }
  function checkEnd(g) {
    return g.supply.province === 0 || emptyPiles(g) >= 3;
  }
  function scoreFor(g, p) {
    var all = p.deck.concat(p.hand).concat(p.discard).concat(p.play);
    var vp = 0;
    all.forEach(function (id) { var d = cardDef(id); if (d.type === 'victory' || d.type === 'curse') vp += (d.vp || 0); });
    return vp;
  }
  function finish(g) {
    g.over = true;
    var best = -Infinity, winners = [];
    g.players.forEach(function (p) {
      p.vp = scoreFor(g, p);
      if (p.vp > best) { best = p.vp; winners = [p.id]; }
      else if (p.vp === best) winners.push(p.id);
    });
    // tie broken by FEWER turns taken; still tied = true draw
    if (winners.length > 1) {
      var fewest = Math.min.apply(null, winners.map(function (id) { return g.players[id].turns; }));
      var byTurns = winners.filter(function (id) { return g.players[id].turns === fewest; });
      winners = byTurns;
    }
    g.winner = winners.length === 1 ? winners[0] : null;   // null = draw
    g.log.push({ t: 'end', winner: g.winner, scores: g.players.map(function (p) { return p.vp; }) });
  }

  /* ---- helpers exposed for UI / bots --------------------------------------- */
  function deckCount(p) { return p.deck.length + p.hand.length + p.discard.length + p.play.length; }
  function cardCounts(g, p) {
    var all = p.deck.concat(p.hand).concat(p.discard).concat(p.play), m = {};
    all.forEach(function (id) { m[id] = (m[id] || 0) + 1; });
    return m;
  }
  function provincesLeft(g) { return g.supply.province; }

  /* ---- exports ------------------------------------------------------------- */
  var Deckforge = {
    BASE: BASE, KINGDOM_POOL: KINGDOM_POOL, cardDef: cardDef, shuffle: shuffle,
    pickKingdom: pickKingdom, createGame: createGame,
    drawCards: drawCards, startTurn: startTurn,
    legalPlays: legalPlays, legalBuys: legalBuys, allSupplyIds: allSupplyIds,
    playAction: playAction, resolveGain: resolveGain, gainable: gainable, resolveSift: resolveSift,
    toBuyPhase: toBuyPhase, playTreasure: playTreasure, playAllTreasures: playAllTreasures,
    buyCard: buyCard, cleanup: cleanup,
    checkEnd: checkEnd, emptyPiles: emptyPiles, scoreFor: scoreFor,
    deckCount: deckCount, cardCounts: cardCounts, provincesLeft: provincesLeft, keepValue: keepValue
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Deckforge;
  else root.Deckforge = Deckforge;
})(typeof window !== 'undefined' ? window : globalThis);
