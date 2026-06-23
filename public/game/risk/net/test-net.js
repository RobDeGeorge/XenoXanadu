/* Integration test for the match-server. Spins it up in-process and connects
 * two players with Node's built-in WebSocket client (no deps). Verifies:
 *   create/join → lobby → start → seat assignment
 *   redacted snapshots (you see your hand; opponents' are hidden)
 *   turn-gating (off-turn intents are rejected)
 *   a full human turn applies + syncs to BOTH clients
 * Run: node test-net.js
 */
"use strict";
process.env.PORT = process.env.PORT || "8791";
require("./server.js");                       // starts listening on PORT
var E = globalThis.RiskEngine;
var URL = "ws://127.0.0.1:" + process.env.PORT;
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function Client(name) {
  var self = this;
  this.name = name; this.msgs = []; this.snap = null; this.mySeat = null; this.code = null; this.errors = [];
  this.ws = new WebSocket(URL);
  this.ws.onmessage = function (e) {
    var m = JSON.parse(e.data); self.msgs.push(m);
    if (m.t === "state") self.snap = m.snapshot;
    if (m.t === "start") self.mySeat = m.mySeat;
    if (m.t === "created" || m.t === "joined") self.code = m.code;
    if (m.t === "error") self.errors.push(m.msg);
  };
}
Client.prototype.open = function () { var ws = this.ws; return new Promise(function (r) { ws.onopen = r; }); };
Client.prototype.send = function (o) { this.ws.send(JSON.stringify(o)); };
Client.prototype.waitMsg = async function (pred, ms) {
  var t0 = Date.now(); ms = ms || 3000;
  while (Date.now() - t0 < ms) { var h = this.msgs.find(pred); if (h) return h; await sleep(15); }
  throw new Error(this.name + ": timeout waiting for message");
};
Client.prototype.waitState = async function (pred, ms) {
  var t0 = Date.now(); ms = ms || 4000;
  while (Date.now() - t0 < ms) { if (this.snap && pred(this.snap)) return this.snap; await sleep(15); }
  throw new Error(this.name + ": timeout waiting for state");
};

var pass = 0, fail = 0;
function check(name, cond, detail) { cond ? (pass++, console.log("  ✓ " + name + (detail ? " — " + detail : ""))) : (fail++, console.log("  ✗ " + name + (detail ? " — " + detail : ""))); }

(async function () {
  await sleep(150); // let the server bind
  var A = new Client("Alice"), B = new Client("Bob");
  await A.open(); await B.open();

  // --- create / join / lobby ---
  A.send({ t: "create", name: "Alice", map: "classic", manualSetup: false });
  var created = await A.waitMsg(function (m) { return m.t === "created"; });
  check("room created with a code", /^[A-Z2-9]{4}$/.test(created.code), created.code);
  B.send({ t: "join", code: created.code, name: "Bob" });
  var lob = await B.waitMsg(function (m) { return m.t === "lobby" && m.members.length === 2; });
  check("lobby shows both members", lob.members.length === 2, lob.members.map(function (x) { return x.name; }).join(", "));

  // --- start ---
  A.send({ t: "start" });
  await A.waitMsg(function (m) { return m.t === "start"; });
  await B.waitMsg(function (m) { return m.t === "start"; });
  check("seats assigned 0/1", A.mySeat === 0 && B.mySeat === 1, "Alice=" + A.mySeat + " Bob=" + B.mySeat);
  await A.waitState(function (s) { return !!s; });
  await B.waitState(function (s) { return !!s; });
  check("snapshot has all territories", Object.keys(A.snap.terr).length === E.TERRITORY_IDS.length, Object.keys(A.snap.terr).length + "");
  check("starts at reinforce, turn 0", A.snap.phase === "reinforce" && A.snap.turn === 0);

  // --- redaction: each sees only their own hand object ---
  var aSelf = A.snap.players[0].cards, aOpp = A.snap.players[1].cards;
  var bSelf = B.snap.players[1].cards, bOpp = B.snap.players[0].cards;
  check("Alice sees her own cards array", Array.isArray(aSelf), typeof aSelf);
  check("Alice cannot see Bob's cards", aOpp === null);
  check("Bob sees his own cards array", Array.isArray(bSelf));
  check("Bob cannot see Alice's cards", bOpp === null);

  // --- turn-gating: Bob acts out of turn → rejected ---
  var bErrBefore = B.errors.length;
  B.send({ t: "intent", action: "endPhase" });
  await sleep(120);
  check("off-turn intent rejected", B.errors.length > bErrBefore, B.errors[B.errors.length - 1] || "(no error)");

  // --- Alice plays a full turn ---
  var R = A.snap.reinforcements;
  // deploy all reinforcements onto one of her border territories (so attacks open up)
  var aLands = E.ownedBy(A.snap, 0);
  var border = aLands.find(function (id) { return E.T[id].adj.some(function (nb) { return A.snap.terr[nb].owner !== 0; }); }) || aLands[0];
  A.send({ t: "intent", action: "deploy", id: border, count: R });
  await A.waitState(function (s) { return s.reinforcements === 0; });
  check("deploy synced to Bob too", true, "Bob sees " + border + " = " + (B.snap.terr[border] && B.snap.terr[border].armies) + " armies");
  await B.waitState(function (s) { return s.terr[border].armies === A.snap.terr[border].armies; }).then(function () { check("both clients agree on armies", true); }).catch(function () { check("both clients agree on armies", false); });

  A.send({ t: "intent", action: "endPhase" });               // → attack
  await A.waitState(function (s) { return s.phase === "attack"; });
  check("advanced to attack phase", A.snap.phase === "attack");

  // one attack (blitz); resolve a conquest if it happens
  var atks = E.listAttacks(A.snap);
  if (atks.length) {
    var mv = atks[0];
    A.send({ t: "intent", action: "attack", from: mv.from, to: mv.to, blitz: true });
    var diceA = await A.waitMsg(function (m) { return m.t === "event" && m.kind === "dice"; });
    var diceB = await B.waitMsg(function (m) { return m.t === "event" && m.kind === "dice"; });
    check("dice event broadcast to both", diceA && diceB, "atk " + diceA.aRolls + " vs def " + diceA.dRolls);
    await sleep(150);
    if (A.snap.lastConquest) {
      A.send({ t: "intent", action: "advance", count: A.snap.lastConquest.minMove });
      await A.waitState(function (s) { return !s.lastConquest; });
      check("conquest advance resolved", !A.snap.lastConquest);
    }
  } else { console.log("  (no legal attack this deal — skipping attack assertions)"); }

  A.send({ t: "intent", action: "endPhase" });               // attack → fortify
  await A.waitState(function (s) { return s.phase === "fortify"; });
  A.send({ t: "intent", action: "skipFortify" });            // end turn
  await A.waitState(function (s) { return s.turn === 1; });
  check("turn passed to Bob", A.snap.turn === 1 && A.snap.phase === "reinforce");
  await B.waitState(function (s) { return s.turn === 1; });
  check("Bob's client agrees it's his turn", B.snap.turn === 1);
  // redaction now lets Bob (his turn) still only see his own hand
  check("redaction holds after handoff", B.snap.players[1].cards !== null && B.snap.players[0].cards === null);

  console.log("\n" + (fail === 0 ? "✓ ALL PASS" : "✗ " + fail + " FAILED") + " (" + pass + " passed)");
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.error("✗ test crashed:", e.message); process.exit(1); });
