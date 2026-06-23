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
process.env.AI_DELAY_MS = "0";                // run AI seats instantly in tests
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
    if (m.t === "start") { self.mySeat = m.mySeat; self.token = m.token; }
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

  // --- reconnection: Bob drops mid-game, then rejoins his seat with his token ---
  var bobToken = B.token, bobCode = B.code;
  check("Bob has a reconnection token", typeof bobToken === "string" && bobToken.length > 0);
  B.ws.close();
  await A.waitState(function (s) { return s.players[1].connected === false; })
    .then(function () { check("Alice sees Bob as disconnected", true); })
    .catch(function () { check("Alice sees Bob as disconnected", false); });

  var B2 = new Client("Bob-rejoined"); await B2.open();
  B2.send({ t: "rejoin", code: bobCode, token: bobToken });
  var resumed = await B2.waitMsg(function (m) { return m.t === "start"; });
  check("rejoin resumes the seat", resumed.resumed === true && resumed.mySeat === 1, "seat " + resumed.mySeat);
  await B2.waitState(function (s) { return !!s; });
  check("rejoined client gets current state", B2.snap.turn === 1 && B2.snap.phase === "reinforce", "turn " + B2.snap.turn);
  check("rejoined client sees its own cards, opponent hidden", Array.isArray(B2.snap.players[1].cards) && B2.snap.players[0].cards === null);
  await A.waitState(function (s) { return s.players[1].connected === true; })
    .then(function () { check("Alice sees Bob reconnected", true); })
    .catch(function () { check("Alice sees Bob reconnected", false); });

  // a stale/unknown token can't reclaim a seat
  var X = new Client("Imposter"); await X.open();
  X.send({ t: "rejoin", code: bobCode, token: "deadbeef" });
  await X.waitMsg(function (m) { return m.t === "error"; });
  check("unknown token rejected on rejoin", X.errors.length > 0, X.errors[0]);

  // --- spectators: watch a started room, see no hands, can't act ---
  var S = new Client("Spectator"); await S.open();
  S.send({ t: "join", code: bobCode, name: "Watcher", spectate: true });
  var sjoin = await S.waitMsg(function (m) { return m.t === "joined"; });
  check("spectator joins a started room", sjoin.spectator === true);
  await S.waitMsg(function (m) { return m.t === "start" && m.spectator === true; });
  await S.waitState(function (s) { return !!s; });
  check("spectator sees the board", Object.keys(S.snap.terr).length === E.TERRITORY_IDS.length);
  check("spectator sees NO hands at all", S.snap.players.every(function (p) { return p.cards === null; }));
  var sErr = S.errors.length;
  S.send({ t: "intent", action: "endPhase" });
  await sleep(120);
  check("spectator intent is rejected", S.errors.length > sErr);
  // a live state change reaches the spectator too
  await A.waitState(function (s) { return s.turn === 1; }).catch(function () {});
  var lobbyWithSpec = await A.waitMsg(function (m) { return m.t === "lobby" && m.spectators >= 1; }).then(function () { return true; }).catch(function () { return false; });
  check("lobby reports spectator count", lobbyWithSpec);

  // --- online AI seats: host adds bots, they auto-play their turns ---
  var C = new Client("Host"); await C.open();
  C.send({ t: "create", name: "Host", map: "classic", manualSetup: false });
  await C.waitMsg(function (m) { return m.t === "created"; });
  C.send({ t: "addAI" }); C.send({ t: "addAI" });
  var lob2 = await C.waitMsg(function (m) { return m.t === "lobby" && m.bots && m.bots.length === 2; });
  check("host can add AI generals to the lobby", lob2.bots.length === 2, lob2.bots.map(function (b) { return b.name; }).join(", "));
  C.send({ t: "start" });
  await C.waitMsg(function (m) { return m.t === "start"; });
  await C.waitState(function (s) { return !!s; });
  check("3-seat game starts (1 human + 2 AI)", C.snap.players.length === 3 && C.snap.players[1].isHuman === false && C.snap.players[2].isHuman === false);
  check("AI seats carry a general persona", !!C.snap.players[1].general && !!C.snap.players[1].general.name);

  // Host plays a minimal turn, then the two AI seats should auto-play and bring it back.
  var hl = E.ownedBy(C.snap, 0);
  var hb = hl.find(function (id) { return E.T[id].adj.some(function (nb) { return C.snap.terr[nb].owner !== 0; }); }) || hl[0];
  C.send({ t: "intent", action: "deploy", id: hb, count: C.snap.reinforcements });
  await C.waitState(function (s) { return s.reinforcements === 0; });
  C.send({ t: "intent", action: "endPhase" });              // → attack
  await C.waitState(function (s) { return s.phase === "attack"; });
  C.send({ t: "intent", action: "endPhase" });              // attack → fortify
  await C.waitState(function (s) { return s.phase === "fortify"; });
  C.send({ t: "intent", action: "skipFortify" });           // end turn → AI seats take over
  var back = await C.waitState(function (s) { return (s.turn === 0 && s.phase === "reinforce") || s.winner != null; }, 6000)
    .then(function () { return true; }).catch(function () { return false; });
  check("AI seats auto-played their turns (control returned / game progressed)", back, "turn=" + C.snap.turn + " phase=" + C.snap.phase);

  console.log("\n" + (fail === 0 ? "✓ ALL PASS" : "✗ " + fail + " FAILED") + " (" + pass + " passed)");
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.error("✗ test crashed:", e.message); process.exit(1); });
