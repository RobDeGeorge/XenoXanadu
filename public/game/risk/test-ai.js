/* Integration test: drives the REAL local model (Ollama) through one of each
 * phase decision using the SAME prompts main.js builds and the SAME parsers
 * (ai-parse.js), on a realistic mid-game board. Verifies the model's replies
 * parse into LEGAL choices. Run: node test-ai.js [model] [endpoint]
 *
 * Faithful to the browser: we feed the parser the model's thinking + content
 * concatenated (what main.js's streamed `acc` contains).
 */
globalThis.self = globalThis;
globalThis.RiskEngine = require("./engine.js");
require("./generals.js");
require("./bots.js");
var P = require("./ai-parse.js");
var E = globalThis.RiskEngine, B = globalThis.RiskBots, G = globalThis.RiskGenerals;

var MODEL = process.argv[2] || "qwen3:8b";
var ENDPOINT = (process.argv[3] || "http://localhost:11434").replace(/\/$/, "");

function enemyAdjStr(s, id) {
  var pid = s.terr[id].owner, es = E.T[id].adj.filter(function (nb) { return s.terr[nb].owner !== pid; });
  if (!es.length) return "interior/safe";
  return "vs " + es.slice(0, 3).map(function (nb) { return E.T[nb].name + ":" + s.terr[nb].armies; }).join(", ");
}
function sysFor(g, situation) {
  return "You are " + g.name + ", a Risk general — " + g.voice + ". " + situation +
    " Reason briefly, then give your decision in the EXACT format requested. Keep any in-character remark to one short sentence.";
}
async function ask(sys, usr) {
  var res = await fetch(ENDPOINT + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, stream: false, messages: [{ role: "system", content: sys }, { role: "user", content: usr }] }),
  });
  var j = await res.json();
  var m = j.message || {};
  return (m.thinking || "") + "\n" + (m.content || ""); // what the browser's streamed acc holds
}

// candidate fortifies (mirrors main.js fortifyCandidates)
function fortifyCandidates(s) {
  var pid = s.turn, out = [], seen = {};
  E.ownedBy(s, pid).forEach(function (from) {
    if (s.terr[from].armies < 2 || seen[from]) return;
    var best = null;
    E.connectedOwn(s, from).forEach(function (to) {
      if (s.terr[to].owner !== pid || !B.isBorder(s, to)) return;
      var pr = B.enemyPressure(s, to); if (!best || pr > best.pr) best = { to: to, pr: pr };
    });
    if (!best) return;
    var spare = s.terr[from].armies - 1, keep = B.isBorder(s, from) ? Math.ceil(spare * 0.3) : 0;
    seen[from] = true;
    out.push({ from: from, to: best.to, count: Math.max(1, spare - keep), score: best.pr - B.enemyPressure(s, from) });
  });
  return out.sort(function (a, b) { return b.score - a.score; });
}

(async function () {
  // sanity: model reachable?
  try { await fetch(ENDPOINT + "/api/tags"); } catch (e) { console.error("✗ can't reach Ollama at " + ENDPOINT); process.exit(2); }

  // build a realistic mid-game board: 4 AI players, ~12 heuristic turns
  var gens = G.pick(4);
  var s = E.newGame({ players: gens.map(function (g) { return { name: g.name, isHuman: false, general: g }; }) });
  function heuristicTurn(st) {
    var w = E.currentPlayer(st).general.weights;
    B.planReinforcements(st, w); E.endPhase(st);
    var guard = 0;
    while (st.winner == null && guard++ < 40) { var m = B.planAttack(st, w); if (!m) break; E.rollAttack(st, m.from, m.to); if (st.lastConquest) E.moveAfterConquest(st, B.advanceCount(st, w)); }
    if (st.winner != null) return; E.endPhase(st);
    var f = B.planFortify(st, w); if (f && E.canFortify(st, f.from, f.to)) E.fortify(st, f.from, f.to, f.count); else E.skipFortify(st);
  }
  for (var t = 0; t < 12 && s.winner == null; t++) heuristicTurn(s);
  // ensure we're at a fresh reinforce for a living player
  if (s.phase !== "reinforce") E.beginTurn(s, s.turn);
  var p = E.currentPlayer(s), g = p.general;
  console.log("Model:", MODEL, "| testing general:", g.name, "| holds", E.ownedBy(s, p.id).length, "territories\n");

  var pass = 0, fail = 0;
  function check(name, cond, detail) { (cond ? (pass++, console.log("  ✓ " + name + (detail ? " — " + detail : ""))) : (fail++, console.log("  ✗ " + name + (detail ? " — " + detail : "")))); }

  // ---- 1) DEPLOY ----
  var R = s.reinforcements;
  var own = E.ownedBy(s, p.id);
  var borders = own.filter(function (id) { return B.isBorder(s, id); });
  var list = (borders.length ? borders : own).slice().sort(function (a, b) { return B.enemyPressure(s, b) - B.enemyPressure(s, a); }).slice(0, 16);
  var dlines = list.map(function (id, i) { return (i + 1) + ". " + E.T[id].name + " — " + s.terr[id].armies + " armies (" + enemyAdjStr(s, id) + ")"; });
  var dusr = "REINFORCE PHASE. You have " + R + " new armies to deploy onto your front-line territories:\n" + dlines.join("\n") +
    "\n\nStack armies where you intend to break through or must defend. Reply with one line PER territory you reinforce, e.g.:\nDEPLOY 1 " + Math.ceil(R / 2) + "\nDEPLOY 3 " + Math.floor(R / 2) + "\nThe army counts must total exactly " + R + ".";
  console.log("[DEPLOY] R=" + R + " over " + list.length + " territories");
  var dreply = await ask(sysFor(g, "It is your reinforcement phase."), dusr);
  var alloc = P.parseDeploy(dreply, list.length);
  var entries = alloc && P.reconcileDeploy(alloc, R);
  check("deploy parsed", !!entries, entries ? Object.keys(alloc).length + " territories named" : "no allocation found");
  if (entries) {
    var sum = entries.reduce(function (a, e) { return a + e.c; }, 0);
    check("deploy totals exactly R", sum === R, sum + " vs " + R);
    check("deploy indices in range", entries.every(function (e) { return e.i >= 0 && e.i < list.length; }), entries.map(function (e) { return "#" + (e.i + 1) + "×" + e.c; }).join(", "));
  }

  // ---- 2) ATTACK ----
  // place R so attacks exist, then list them
  if (entries) entries.forEach(function (e) { E.placeArmies(s, list[e.i], e.c); });
  while (s.reinforcements > 0) E.placeArmies(s, list[0], s.reinforcements);
  E.endPhase(s);
  var atks = E.listAttacks(s);
  if (!atks.length) { console.log("[ATTACK] no legal attacks on this board — skipping"); }
  else {
    var ranked = atks.map(function (m) { return { m: m, edge: B.attackEdge(s.terr[m.from].armies, s.terr[m.to].armies) }; }).sort(function (a, b) { return b.edge - a.edge; }).slice(0, 12);
    var alines = ranked.map(function (e, i) { var m = e.m; return (i + 1) + ". " + E.T[m.from].name + " (" + s.terr[m.from].armies + ") → " + E.T[m.to].name + " (" + s.terr[m.to].armies + ", " + s.players[s.terr[m.to].owner].name + ")"; });
    var ausr = "ATTACK PHASE (decision 1). Your available assaults — attacker armies → defender armies:\n" + alines.join("\n") + "\n0. Stop attacking and keep your armies\n\nReply `ATTACK: <number>` for the assault you choose, or `ATTACK: 0` to stop.";
    console.log("[ATTACK] " + ranked.length + " options offered");
    var areply = await ask(sysFor(g, "It is your attack phase."), ausr);
    var aidx = P.parseIndex(areply, "attack");
    check("attack parsed to a number", aidx != null, "got " + aidx);
    check("attack index legal (0..N)", aidx != null && aidx >= 0 && aidx <= ranked.length, aidx + " (0=stop, max " + ranked.length + ")");
  }

  // ---- 3) FORTIFY ----
  if (s.phase === "attack") E.endPhase(s);
  var cands = fortifyCandidates(s).slice(0, 8);
  if (!cands.length) { console.log("[FORTIFY] no candidates — skipping"); }
  else {
    var flines = cands.map(function (c, i) { return (i + 1) + ". move " + c.count + " from " + E.T[c.from].name + " (" + s.terr[c.from].armies + ") → " + E.T[c.to].name + " (" + s.terr[c.to].armies + ", " + enemyAdjStr(s, c.to) + ")"; });
    var fusr = "FORTIFY PHASE — you may make ONE army move through connected territory, then your turn ends:\n" + flines.join("\n") + "\n0. Don't fortify\n\nReply `FORTIFY: <number>` (or `FORTIFY: 0`).";
    console.log("[FORTIFY] " + cands.length + " options offered");
    var freply = await ask(sysFor(g, "It is your fortify phase."), fusr);
    var fidx = P.parseIndex(freply, "fortify");
    check("fortify parsed to a number", fidx != null, "got " + fidx);
    check("fortify index legal (0..N)", fidx != null && fidx >= 0 && fidx <= cands.length, fidx + " (0=skip, max " + cands.length + ")");
  }

  console.log("\n" + (fail === 0 ? "✓ ALL PASS" : "✗ " + fail + " FAILED") + " (" + pass + " passed)");
  process.exit(fail === 0 ? 0 : 1);
})();
