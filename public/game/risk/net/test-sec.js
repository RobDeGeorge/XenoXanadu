/* Security regression tests for the match-server hardening. Uses Node's
 * built-in WebSocket client (no deps). Verifies the defenses actually fire:
 *   - a normal small message keeps the connection open (control)
 *   - an over-the-cap message gets the connection closed (RFC 1009)
 *   - a message flood trips the rate limiter and closes the connection
 * Run: node test-sec.js
 */
"use strict";
process.env.PORT = process.env.PORT || "18050";
process.env.MSG_RATE = "30"; process.env.MSG_BURST = "60";
var srv = require("./server.js");
var URL = "ws://127.0.0.1:" + process.env.PORT;
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function open() {
  return new Promise(function (res) {
    var ws = new WebSocket(URL);
    var o = { ws: ws, closed: false, closeCode: null, gotMsg: false };
    ws.onopen = function () { res(o); };
    ws.onclose = function (e) { o.closed = true; o.closeCode = e.code; };
    ws.onmessage = function () { o.gotMsg = true; };
  });
}

var pass = 0, fail = 0;
function check(n, c, d) { c ? (pass++, console.log("  ✓ " + n + (d ? " — " + d : ""))) : (fail++, console.log("  ✗ " + n + (d ? " — " + d : ""))); }

(async function () {
  await sleep(150);
  console.log("config: host=" + srv.CONFIG.host + " maxPayload=" + srv.CONFIG.maxPayload + " rate=" + srv.CONFIG.msgRatePerSec + "/s");

  // 0) bind safe-by-default
  check("binds to localhost by default", srv.CONFIG.host === "127.0.0.1", srv.CONFIG.host);
  check("payload cap is small (≤64KB)", srv.CONFIG.maxPayload <= 65536, srv.CONFIG.maxPayload + " bytes");

  // 1) control: a normal message keeps the socket open
  var a = await open();
  a.ws.send(JSON.stringify({ t: "create", name: "Ok", map: "classic" }));
  await sleep(250);
  check("normal client stays connected", !a.closed && a.gotMsg, a.gotMsg ? "got a reply" : "no reply");
  a.ws.close();

  // 2) oversized frame → server closes (RFC 1009 "message too big")
  var b = await open();
  b.ws.send(JSON.stringify({ t: "junk", blob: "x".repeat(80 * 1024) })); // ~80KB > 64KB cap
  await sleep(400);
  check("over-cap message closes the connection", b.closed, b.closeCode != null ? "close code " + b.closeCode : "closed");

  // 3) flood → rate limiter closes (RFC 1008 "policy violation")
  var c = await open();
  for (var i = 0; i < 250; i++) c.ws.send(JSON.stringify({ t: "noop", i: i }));
  await sleep(600);
  check("message flood closes the connection", c.closed, c.closeCode != null ? "close code " + c.closeCode : "closed");

  console.log("\n" + (fail === 0 ? "✓ ALL PASS" : "✗ " + fail + " FAILED") + " (" + pass + " passed)");
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.error("✗ crashed:", e); process.exit(1); });
