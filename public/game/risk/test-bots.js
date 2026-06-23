/* Headless harness: play full games with the REAL heuristic planners
 * (engine.js + bots.js + generals.js) to shake out logic bugs.
 * Run: node test-bots.js [games]
 */
globalThis.self = globalThis;
globalThis.RiskEngine = require("./engine.js");
require("./generals.js");
require("./bots.js");
var E = globalThis.RiskEngine, B = globalThis.RiskBots, G = globalThis.RiskGenerals;

function botTurn(s) {
  var p = E.currentPlayer(s);
  var w = p.general ? p.general.weights : { aggression: .6, bravado: .5, expansion: .6, continent: .6, vengeance: .4, targetCont: null };
  // reinforce
  B.planReinforcements(s, w);
  if (s.reinforcements !== 0) throw new Error("reinforcements left after planning: " + s.reinforcements);
  if (!E.endPhase(s)) throw new Error("could not end reinforce (mustTrade=" + E.mustTrade(s, s.turn) + ")");
  // attack
  var guard = 0;
  while (s.winner == null && guard++ < 60) {
    var m = B.planAttack(s, w);
    if (!m) break;
    var r = E.rollAttack(s, m.from, m.to);
    if (!r.ok) throw new Error("illegal attack chosen: " + JSON.stringify(m) + " — " + r.error);
    if (s.lastConquest) E.moveAfterConquest(s, B.advanceCount(s, w));
  }
  if (s.lastConquest) throw new Error("unresolved conquest at end of attack");
  if (s.winner != null) return;
  if (!E.endPhase(s)) throw new Error("could not end attack");
  // fortify
  var f = B.planFortify(s, w);
  if (f && E.canFortify(s, f.from, f.to)) E.fortify(s, f.from, f.to, f.count);
  else E.skipFortify(s);
}

var GAMES = +(process.argv[2] || 30);
var wins = {}, turnsHist = [], invalidStates = 0;
for (var g = 0; g < GAMES; g++) {
  var n = 2 + (g % 5); // cycle 2..6 players
  var gens = G.pick(n);
  var defs = gens.map(function (gen) { return { name: gen.name, isHuman: false, general: gen }; });
  var s = E.newGame({ players: defs });
  var turns = 0, cap = 3000;
  while (s.winner == null && turns < cap) { botTurn(s); turns++; }
  // invariant checks
  var totalArmies = E.TERRITORY_IDS.reduce(function (a, id) { return a + s.terr[id].armies; }, 0);
  var owned = {};
  E.TERRITORY_IDS.forEach(function (id) {
    var o = s.terr[id].owner;
    if (o == null || !s.players[o]) invalidStates++;
    if (s.terr[id].armies < 1) invalidStates++;
    owned[o] = (owned[o] || 0) + 1;
  });
  if (s.winner != null) {
    wins[n] = (wins[n] || 0) + 1;
    // winner should own all 42
    if (E.ownedBy(s, s.winner).length !== 42) invalidStates++;
  }
  turnsHist.push(turns);
}

var avg = Math.round(turnsHist.reduce(function (a, b) { return a + b; }, 0) / turnsHist.length);
var finished = turnsHist.filter(function (t) { return t < 3000; }).length;
console.log("games:", GAMES, "| finished:", finished + "/" + GAMES, "| avg turns:", avg, "| max:", Math.max.apply(null, turnsHist));
console.log("invalid-state flags:", invalidStates, invalidStates === 0 ? "✓" : "✗ PROBLEM");
console.log("wins by player-count:", JSON.stringify(wins));
process.exit(invalidStates === 0 ? 0 : 1);
