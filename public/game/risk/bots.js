/* XenoXanadu — Risk: Global Domination
 * ------------------------------------------------------------------
 * bots.js — the heuristic AI (global RiskBots).
 *
 * Pure decision functions over a RiskEngine state. These ALWAYS produce a
 * legal move (or null = "stop"), so the game is fully playable offline / on
 * the hosted site with no model at all — the named generals get their
 * personality from the weight profile in generals.js. A connected local
 * model is a pure *voice* layer on top (see main.js); it never has to make a
 * legal move, so it can't break the game.
 *
 * Three planners, one per phase:
 *   planReinforcements(state, weights) → [{id, count}]   (+ trades)
 *   planAttack(state, weights)         → {from, to} | null
 *   planFortify(state, weights)        → {from, to, count} | null
 */
(function (root) {
  "use strict";

  var E; // RiskEngine, resolved lazily (load order independent)
  function eng() { return E || (E = root.RiskEngine); }

  // --- attack-odds table: probability the attacker clears one defending army
  //     in a single 3-vs-2 assault is ~0.47 per defender; we use a coarse
  //     win-this-battle estimate from the army ratio for ranking. ---
  function attackEdge(atkArmies, defArmies) {
    // attacker effective force = armies-1 (one must stay)
    var a = atkArmies - 1;
    if (a <= 0) return -1;
    return (a - defArmies) + a / (a + defArmies + 1); // ratio-biased margin
  }

  // Border heat: how exposed is a territory (sum of adjacent enemy armies).
  function enemyPressure(state, id) {
    var T = eng().T, pid = state.terr[id].owner, sum = 0;
    T[id].adj.forEach(function (nb) {
      if (state.terr[nb].owner !== pid) sum += state.terr[nb].armies;
    });
    return sum;
  }

  function isBorder(state, id) {
    var T = eng().T, pid = state.terr[id].owner;
    return T[id].adj.some(function (nb) { return state.terr[nb].owner !== pid; });
  }

  // The strongest opponent right now (by total armies) — for vengeance.
  function leader(state, exceptId) {
    var en = eng(), best = null, bestN = -1;
    state.players.forEach(function (p) {
      if (!p.alive || p.id === exceptId) return;
      var n = en.armyTotal(state, p.id);
      if (n > bestN) { bestN = n; best = p.id; }
    });
    return best;
  }

  // ---------------------------------------------------------------
  //  REINFORCE — trade if required/valuable, then weight placement
  //  toward threatened borders and toward completing target continents.
  // ---------------------------------------------------------------
  function planTrades(state, weights) {
    var en = eng(), p = en.currentPlayer(state), trades = [];
    // Always trade when forced (5+ cards); otherwise trade once a set exists
    // and we're past the early scramble (sets are worth more later, but the
    // bots keep it simple and cash in whenever they hold a set).
    var guard = 0;
    while (p.cards.length >= 3 && guard++ < 10) {
      var set = en.findSet(p.cards);
      if (!set) break;
      var forced = p.cards.length >= 5;
      if (!forced && Math.random() > 0.6 + weights.continent * 0.2) break; // sometimes hold
      trades.push(set);
      en.tradeCards(state, set);
    }
    return trades;
  }

  function planReinforcements(state, weights) {
    var en = eng(), T = en.T, pid = state.turn;
    planTrades(state, weights);
    var placements = [];
    var owned = en.ownedBy(state, pid);
    var borders = owned.filter(function (id) { return isBorder(state, id); });
    if (!borders.length) borders = owned; // fully interior (rare) — dump anywhere

    // Score each border: pressure + bonus if it sits on a continent we nearly own.
    var nearCont = nearlyOwnedContinents(state, pid);
    function score(id) {
      var s = enemyPressure(state, id) + 1;
      if (weights.targetCont && T[id].cont === weights.targetCont) s += 6 * weights.continent;
      if (nearCont[T[id].cont]) s += 8 * weights.continent;
      // a tiny bit of love for the single best springboard (offense)
      s += bestAttackFrom(state, id) * (0.4 + weights.aggression * 0.6);
      return s;
    }

    var budget = state.reinforcements;
    // Distribute proportionally to score, but guarantee the hottest border gets a chunk.
    var scored = borders.map(function (id) { return { id: id, s: score(id) }; })
      .sort(function (a, b) { return b.s - a.s; });
    var total = scored.reduce(function (a, b) { return a + b.s; }, 0) || 1;
    var assigned = 0;
    scored.forEach(function (e, i) {
      if (budget <= 0) return;
      var share = i === 0 ? Math.ceil(budget * (0.4 + 0.3 * weights.aggression))
                          : Math.floor(state.reinforcements * (e.s / total));
      share = Math.min(share, budget);
      if (share > 0) { placements.push({ id: e.id, count: share }); budget -= share; assigned += share; }
    });
    if (budget > 0 && scored.length) placements.push({ id: scored[0].id, count: budget });

    // commit
    placements.forEach(function (pl) { en.placeArmies(state, pl.id, pl.count); });
    // any rounding leftovers
    while (state.reinforcements > 0) en.placeArmies(state, scored[0].id, state.reinforcements);
    return placements;
  }

  // continents where the player owns all-but-1 or 2 (worth pushing to finish)
  function nearlyOwnedContinents(state, pid) {
    var en = eng(), out = {};
    en.CONTINENT_IDS.forEach(function (c) {
      var members = en.CONT_MEMBERS[c];
      var mine = members.filter(function (id) { return state.terr[id].owner === pid; }).length;
      if (mine >= members.length - 2 && mine < members.length) out[c] = true;
    });
    return out;
  }

  // best single attack edge available FROM a territory (springboard value)
  function bestAttackFrom(state, id) {
    var en = eng(), T = en.T, pid = state.terr[id].owner, best = 0;
    T[id].adj.forEach(function (nb) {
      if (state.terr[nb].owner === pid) return;
      var e = attackEdge(state.terr[id].armies, state.terr[nb].armies);
      if (e > best) best = e;
    });
    return best;
  }

  // ---------------------------------------------------------------
  //  ATTACK — pick the best favourable assault; stop when nothing clears
  //  the personality's risk bar. Returns one {from,to} (caller loops).
  // ---------------------------------------------------------------
  function planAttack(state, weights) {
    var en = eng();
    var atks = en.listAttacks(state);
    if (!atks.length) return null;
    var lead = weights.vengeance > 0.6 ? leader(state, state.turn) : null;
    var nearCont = nearlyOwnedContinents(state, state.turn);
    var T = en.T;

    var ranked = atks.map(function (m) {
      var a = state.terr[m.from].armies, d = state.terr[m.to].armies;
      var edge = attackEdge(a, d);
      var v = edge;
      if (lead != null && state.terr[m.to].owner === lead) v += 2 * weights.vengeance;
      if (weights.targetCont && T[m.to].cont === weights.targetCont) v += 1.5 * weights.continent;
      if (nearCont[T[m.to].cont]) v += 2.5 * weights.continent; // finish the continent
      // capturing a 1-army border is cheap expansion
      if (d === 1) v += 1.2 * weights.expansion;
      return { m: m, edge: edge, v: v };
    }).sort(function (x, y) { return y.v - x.v; });

    var top = ranked[0];
    // risk bar: braver generals attack on slimmer margins
    var bar = (1 - weights.bravado) * 2.2 - 0.4; // ~ -0.4 (fearless) .. 1.8 (timid)
    if (top.edge < bar) return null;
    // Marshal Blaze & co. occasionally gamble on an even fight
    if (top.edge <= 0 && Math.random() > weights.aggression) return null;
    return top.m;
  }

  // After a conquest, how many armies to push forward (engine clamps to legal).
  function advanceCount(state, weights) {
    var c = state.lastConquest;
    if (!c) return 0;
    var en = eng();
    // push more if the captured land is itself a frontier we'll attack from
    var forwardThreat = enemyPressure(state, c.to);
    var rearThreat = enemyPressure(state, c.from);
    if (forwardThreat > rearThreat) return c.maxMove;          // lean in
    if (rearThreat > forwardThreat * 1.5) return c.minMove;    // hold the rear
    return Math.round((c.minMove + c.maxMove) / 2);
  }

  // ---------------------------------------------------------------
  //  FORTIFY — funnel armies from a safe interior toward the most
  //  pressured friendly border (one move).
  // ---------------------------------------------------------------
  function planFortify(state, weights) {
    var en = eng();
    var owned = en.ownedBy(state, state.turn);
    // candidate sources: interior or low-pressure stacks with spare armies
    var best = null;
    owned.forEach(function (from) {
      if (state.terr[from].armies < 2) return;
      var reach = en.connectedOwn(state, from);
      var fromPressure = enemyPressure(state, from);
      reach.forEach(function (to) {
        if (state.terr[to].owner !== state.turn) return;
        var toPressure = enemyPressure(state, to);
        // value = moving strength from calm to threatened, scaled by spare troops
        var spare = state.terr[from].armies - 1;
        var gain = (toPressure - fromPressure) * 0.5 + (isBorder(state, to) ? 2 : -1) + (isBorder(state, from) ? -1 : 1);
        gain *= Math.min(spare, 8) / 4;
        if (best == null || gain > best.gain) best = { from: from, to: to, gain: gain, spare: spare };
      });
    });
    if (!best || best.gain <= 0.5) return null;
    // move most of the spare, keeping a token guard if the source is a border
    var keep = isBorder(state, best.from) ? Math.ceil(best.spare * 0.3) : 0;
    var count = Math.max(1, best.spare - keep);
    return { from: best.from, to: best.to, count: count };
  }

  // ---------------------------------------------------------------
  //  SETUP — choose ONE owned territory to drop a starting army on, during
  //  the manual one-at-a-time placement draft. Favours threatened borders and
  //  a coveted continent, spread out so it doesn't over-stack a single tile.
  // ---------------------------------------------------------------
  function planSetupPlacement(state, weights) {
    var en = eng(), T = en.T, pid = state.turn;

    // CLAIM phase: while empty land remains, every placement must grab one.
    // Favour our coveted continent, then tiles touching land we already hold
    // (build one connected bloc), with a little noise for spread.
    var unclaimed = en.TERRITORY_IDS.filter(function (id) { return state.terr[id].owner == null; });
    if (unclaimed.length) {
      var pickC = null, bestCS = -Infinity;
      unclaimed.forEach(function (id) {
        var s = Math.random() * 1.0;
        if (weights.targetCont && T[id].cont === weights.targetCont) s += 6 * (weights.continent || 1);
        if (T[id].adj.some(function (nb) { return state.terr[nb].owner === pid; })) s += 3;
        if (s > bestCS) { bestCS = s; pickC = id; }
      });
      return pickC || unclaimed[0];
    }

    // STACK phase: pile remaining armies onto our exposed borders.
    var owned = en.ownedBy(state, pid);
    var borders = owned.filter(function (id) { return isBorder(state, id); });
    var pool = borders.length ? borders : owned;
    var best = null, bestS = -Infinity;
    pool.forEach(function (id) {
      var s = enemyPressure(state, id) + 1;
      if (weights.targetCont && T[id].cont === weights.targetCont) s += 5 * weights.continent;
      s /= Math.sqrt(state.terr[id].armies);   // discourage over-stacking one tile
      s += Math.random() * 1.2;                 // a little spread / variety
      if (s > bestS) { bestS = s; best = id; }
    });
    return best || owned[0];
  }

  root.RiskBots = {
    planReinforcements: planReinforcements,
    planAttack: planAttack,
    planFortify: planFortify,
    planSetupPlacement: planSetupPlacement,
    advanceCount: advanceCount,
    // exposed for the model-voice layer / debugging
    attackEdge: attackEdge, enemyPressure: enemyPressure, isBorder: isBorder, leader: leader,
    nearlyOwnedContinents: nearlyOwnedContinents,
  };
})(typeof self !== "undefined" ? self : this);
