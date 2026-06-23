/* XenoXanadu — Risk: Global Domination
 * ------------------------------------------------------------------
 * net/server.js — the authoritative match-server (zero dependencies).
 *
 * One Node process holds the ONE real game state for each room and is the
 * single source of truth: it validates every move with the SAME engine the
 * browser uses (engine.js, run here under Node), rolls all dice / shuffles the
 * deck (so randomness can't be cheated or desynced), and broadcasts a redacted
 * snapshot to each player (you see your own cards; everyone else's are a count).
 *
 *   node server.js                 # localhost only — ws://127.0.0.1:8790
 *   HOST=lan node server.js        # expose on this machine's network (LAN)
 *   PORT=9000 ROOM_PASSWORD=hunter2 node server.js
 *
 * SECURITY: this is a small hand-rolled WebSocket server, hardened against the
 * usual abuse following the `ws` library + OWASP WebSocket guidance — see
 * SECURITY.md for the full audit. In short: localhost-only by default, 64 KB
 * frame cap (RFC 1009), Origin allowlist (anti-CSWSH), per-IP + global
 * connection caps, per-socket message rate limit, ping/pong heartbeat + idle
 * timeout, RFC-6455 frame validation, and no shell/file/eval surface at all.
 */
"use strict";
var http = require("http");
var crypto = require("crypto");

// ---- bootstrap the shared game brain (same files the browser loads) ----
globalThis.self = globalThis;
globalThis.RiskEngine = require("../engine.js");
var RiskMaps = require("../maps.js");
require("../generals.js");
require("../bots.js");
var E = globalThis.RiskEngine;

// ==================================================================
//  Config — all env-overridable. Safe-by-default.
// ==================================================================
function envInt(name, def) { var v = parseInt(process.env[name], 10); return isFinite(v) ? v : def; }
var CONFIG = {
  // localhost-only unless explicitly exposed (Redis/Mongo learned this the hard way)
  host: (process.env.HOST === "lan" || process.env.HOST === "0.0.0.0") ? "0.0.0.0" : (process.env.HOST || "127.0.0.1"),
  port: envInt("PORT", 8790),
  maxPayload: envInt("MAX_PAYLOAD", 64 * 1024),     // OWASP: "64KB or less" (ws default is 100 MiB — overkill for tiny JSON)
  maxFragments: 64,
  maxConns: envInt("MAX_CONN", 200),                // global socket cap
  maxConnsPerIP: envInt("MAX_CONN_PER_IP", 16),     // per-IP socket cap
  maxRooms: envInt("MAX_ROOMS", 100),
  msgRatePerSec: envInt("MSG_RATE", 30),            // token-bucket refill (OWASP baseline ~100/min; games click more)
  msgBurst: envInt("MSG_BURST", 60),                // bucket size
  pingMs: 30000,                                    // ws-style heartbeat cadence
  idleMs: envInt("IDLE_MS", 120000),                // socket-level idle cutoff (slowloris / zombies)
  handshakeMs: 10000,                               // drop sockets that don't finish the HTTP upgrade
  roomTtlMs: envInt("ROOM_TTL_MS", 30 * 60 * 1000), // reap rooms idle this long
  allowedOrigins: (process.env.ORIGINS || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
  allowAnyOrigin: process.env.ALLOW_ANY_ORIGIN === "1",
  roomPassword: process.env.ROOM_PASSWORD || null,  // optional shared secret to create/join
};
function logSec() { try { console.log.apply(console, ["[sec]"].concat([].slice.call(arguments))); } catch (e) {} }

var GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ==================================================================
//  Minimal WebSocket connection (RFC 6455 subset, hardened)
// ==================================================================
function Conn(socket, ip) {
  this.socket = socket; this.ip = ip;
  this.handlers = {};               // ev -> [fn] (multiple listeners per event)
  this.alive = true; this.isAlive = true; this._fired = false;
  this._buf = Buffer.alloc(0); this._fragOp = 0; this._frag = []; this._fragBytes = 0;
  this.tokens = CONFIG.msgBurst; this._lastRefill = Date.now(); this.violations = 0;
  var self = this;
  socket.setTimeout(CONFIG.idleMs);
  socket.on("timeout", function () { self.terminate(); });
  socket.on("data", function (d) { self._onData(d); });
  socket.on("close", function () { self._down(); });
  socket.on("error", function () { self._down(); });
}
Conn.prototype.on = function (ev, fn) { (this.handlers[ev] || (this.handlers[ev] = [])).push(fn); return this; };
Conn.prototype._fire = function (ev, a) { (this.handlers[ev] || []).forEach(function (fn) { try { fn(a); } catch (e) { /* contain handler errors */ } }); };
Conn.prototype._down = function () { if (this._fired) return; this._fired = true; this.alive = false; this._fire("close"); };
Conn.prototype.terminate = function () { try { this.socket.destroy(); } catch (e) {} this._down(); };

Conn.prototype._rateOk = function () {
  var now = Date.now();
  this.tokens = Math.min(CONFIG.msgBurst, this.tokens + (now - this._lastRefill) / 1000 * CONFIG.msgRatePerSec);
  this._lastRefill = now;
  if (this.tokens < 1) return false;
  this.tokens -= 1; return true;
};

Conn.prototype._onData = function (d) {
  this.isAlive = true;
  this._buf = Buffer.concat([this._buf, d]);
  while (true) {
    var buf = this._buf;
    if (buf.length < 2) return;
    var b0 = buf[0], b1 = buf[1];
    var fin = (b0 & 0x80) !== 0, rsv = (b0 & 0x70), opcode = b0 & 0x0f;
    var masked = (b1 & 0x80) !== 0, len = b1 & 0x7f, off = 2;
    if (rsv !== 0) return this.closeWith(1002);                         // no extensions negotiated → RSV must be 0
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) {
      if (buf.length < 10) return;
      var big = buf.readBigUInt64BE(2);
      if (big > BigInt(CONFIG.maxPayload)) return this.closeWith(1009); // RFC 1009: message too big
      len = Number(big); off = 10;
    }
    if (len > CONFIG.maxPayload) return this.closeWith(1009);
    if (!masked) return this.closeWith(1002);                           // RFC: client→server frames MUST be masked
    var isControl = (opcode & 0x8) !== 0;
    if (isControl && (!fin || len > 125)) return this.closeWith(1002);  // control frames: FIN=1, len ≤125
    if (buf.length < off + 4) return;
    var maskKey = buf.slice(off, off + 4); off += 4;
    if (buf.length < off + len) return;                                 // await full payload (bounded by maxPayload)
    var payload = buf.slice(off, off + len);
    for (var i = 0; i < len; i++) payload[i] ^= maskKey[i & 3];
    this._buf = buf.slice(off + len);

    if (opcode === 0x8) { this.terminate(); return; }                   // close
    if (opcode === 0x9) { this._send(0xA, payload); continue; }         // ping → pong
    if (opcode === 0xA) { continue; }                                   // pong (isAlive already set)

    // data: text (0x1) / binary (0x2) / continuation (0x0)
    if (opcode === 0x0) {
      if (!this._fragOp) return this.closeWith(1002);                   // continuation with no start
      this._frag.push(payload); this._fragBytes += len;
    } else {
      if (this._fragOp) return this.closeWith(1002);                    // new data frame mid-fragment
      this._fragOp = opcode; this._frag = [payload]; this._fragBytes = len;
    }
    if (this._fragBytes > CONFIG.maxPayload || this._frag.length > CONFIG.maxFragments) return this.closeWith(1009);
    if (fin) {
      var op = this._fragOp, full = Buffer.concat(this._frag);
      this._fragOp = 0; this._frag = []; this._fragBytes = 0;
      if (op !== 0x1) continue;                                         // we only speak text JSON
      var txt;
      try { txt = new TextDecoder("utf-8", { fatal: true }).decode(full); }
      catch (e) { return this.closeWith(1007); }                       // RFC 1007: invalid UTF-8
      if (!this._rateOk()) { if (++this.violations > 30) { logSec("rate flood", this.ip); return this.closeWith(1008); } continue; }
      this._fire("message", txt);
    }
  }
};

Conn.prototype._send = function (opcode, payload) {
  if (!this.alive) return;
  payload = payload || Buffer.alloc(0);
  var len = payload.length, header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  try {
    this.socket.write(Buffer.concat([header, payload]));
    if (this.socket.writableLength > 8 * 1024 * 1024) this.terminate();  // slow reader / backpressure → drop
  } catch (e) { this._down(); }
};
Conn.prototype.sendJSON = function (obj) { this._send(0x1, Buffer.from(JSON.stringify(obj), "utf8")); };
Conn.prototype.closeWith = function (code) {
  try { var b = Buffer.alloc(2); b.writeUInt16BE(code || 1000, 0); this._send(0x8, b); } catch (e) {}
  this.terminate();
};

// Origin allowlist — the OWASP-recommended defense against Cross-Site
// WebSocket Hijacking. Browsers always send Origin; native clients don't.
function originAllowed(origin) {
  if (CONFIG.allowAnyOrigin) return true;
  if (!origin) return true;                                  // non-browser client (no Origin header)
  if (CONFIG.allowedOrigins.indexOf(origin) >= 0) return true;
  try { var h = new URL(origin).hostname; if (h === "localhost" || h === "127.0.0.1" || h === "::1" || /\.local$/i.test(h)) return true; } catch (e) {}
  return false;
}
function deny(socket, code, msg) {
  try { socket.write("HTTP/1.1 " + code + " " + msg + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); socket.destroy(); } catch (e) {}
}

function createServer(onConn) {
  var conns = new Set(), perIP = {};
  var server = http.createServer(function (req, res) {
    // Health probe for cloud platforms (Fly.io / Railway / Render).
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" });
      res.end("ok\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" });
    res.end("XenoXanadu Risk match-server — connect over WebSocket.\n");
  });
  server.headersTimeout = CONFIG.handshakeMs;
  server.requestTimeout = CONFIG.handshakeMs;
  server.on("upgrade", function (req, socket) {
    var ip = socket.remoteAddress || "?";
    if (!originAllowed(req.headers["origin"])) { logSec("blocked origin", req.headers["origin"], "from", ip); return deny(socket, 403, "Forbidden origin"); }
    if (conns.size >= CONFIG.maxConns) { logSec("global conn cap hit"); return deny(socket, 503, "Server full"); }
    if ((perIP[ip] || 0) >= CONFIG.maxConnsPerIP) { logSec("per-IP cap", ip); return deny(socket, 429, "Too many connections"); }
    var key = req.headers["sec-websocket-key"];
    if (!key) return deny(socket, 400, "Bad WebSocket request");
    var accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
    socket.setNoDelay(true);
    var conn = new Conn(socket, ip);
    conns.add(conn); perIP[ip] = (perIP[ip] || 0) + 1;
    conn.on("close", function () { conns.delete(conn); perIP[ip] = Math.max(0, (perIP[ip] || 1) - 1); });
    onConn(conn);
  });
  // ws-style ping/pong heartbeat: drop anything that doesn't answer.
  var hb = setInterval(function () {
    conns.forEach(function (c) { if (!c.alive) return; if (!c.isAlive) { c.terminate(); return; } c.isAlive = false; c._send(0x9); });
  }, CONFIG.pingMs); hb.unref();
  server.listen(CONFIG.port, CONFIG.host, function () {
    console.log("Risk match-server on ws://" + CONFIG.host + ":" + CONFIG.port +
      (CONFIG.host === "127.0.0.1" ? "  (localhost only — set HOST=lan to expose to your network)" : "  (reachable on this host's network interfaces)"));
    if (CONFIG.roomPassword) console.log("  • room password required to create/join");
  });
  return server;
}

// ==================================================================
//  Rooms
// ==================================================================
var rooms = {}; // code -> room
function makeCode() {
  var alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", c;
  do { c = ""; for (var i = 0; i < 4; i++) c += alpha[crypto.randomInt(alpha.length)]; } while (rooms[c]);
  return c;
}
function touch(room) { if (room) room.lastActivity = Date.now(); }
function sanitizeName(n) { return (String(n == null ? "" : n).replace(/[ -]/g, "").trim().slice(0, 16)) || "Player"; }

function newRoom(code) {
  return {
    code: code,
    members: [],                 // [{conn, name, id}] in join order; members[0] is host
    nextId: 1,
    config: { mapId: "classic", manualSetup: false },
    state: null,                 // engine state once started
    seatConn: [],                // seat index -> conn (or null if gone)
    started: false,
    lastActivity: Date.now(),
  };
}

function memberOf(room, conn) { return room.members.filter(function (m) { return m.conn === conn; })[0]; }
function isHost(room, conn) { return room.members.length && room.members[0].conn === conn; }

function lobbyMsg(room) {
  return {
    t: "lobby", code: room.code,
    hostId: room.members.length ? room.members[0].id : null,
    members: room.members.map(function (m) { return { id: m.id, name: m.name }; }),
    config: room.config,
    started: room.started,
  };
}
function broadcastLobby(room) { room.members.forEach(function (m) { m.conn.sendJSON(lobbyMsg(room)); }); }

// Redacted per-recipient snapshot: your own hand in full, everyone else a count.
function snapshotFor(state, seat) {
  return {
    turn: state.turn, phase: state.phase, reinforcements: state.reinforcements,
    setupRemaining: state.setupRemaining, conqueredThisTurn: state.conqueredThisTurn,
    lastConquest: state.lastConquest, setsTraded: state.setsTraded, winner: state.winner,
    log: state.log.slice(-40),
    terr: state.terr,
    players: state.players.map(function (p) {
      return {
        id: p.id, name: p.name, color: p.color, isHuman: p.isHuman, alive: p.alive,
        general: p.general ? { name: p.general.name, emoji: p.general.emoji } : null,
        cardCount: p.cards.length,
        cards: p.id === seat ? p.cards : null,
      };
    }),
  };
}
function broadcastState(room) {
  room.seatConn.forEach(function (conn, seat) {
    if (conn && conn.alive) conn.sendJSON({ t: "state", snapshot: snapshotFor(room.state, seat) });
  });
}
function broadcastEvent(room, evt) {
  room.seatConn.forEach(function (conn) { if (conn && conn.alive) conn.sendJSON(Object.assign({ t: "event" }, evt)); });
}

// ---- start the game from the current lobby ----
function startGame(room) {
  var n = room.members.length;
  if (n < 2 || n > 6) return;
  var mapDef = (RiskMaps.get(room.config.mapId)) || E.CLASSIC_MAP;
  var defs = room.members.map(function (m) { return { name: m.name, isHuman: true }; });
  room.state = E.newGame({ players: defs, map: mapDef, manualSetup: !!room.config.manualSetup });
  room.started = true;
  room.seatConn = room.members.map(function (m) { return m.conn; });
  room.members.forEach(function (m, seat) {
    m.seat = seat;
    m.conn.sendJSON({ t: "start", mySeat: seat, mapId: room.config.mapId, code: room.code });
  });
  broadcastState(room);
}

// ==================================================================
//  Intent handling — the only way the authoritative state changes
// ==================================================================
function reject(conn, msg) { conn.sendJSON({ t: "error", msg: msg }); }

function handleIntent(room, conn, m) {
  var s = room.state;
  if (!s || s.winner != null) return reject(conn, "Game not in progress");
  var mem = memberOf(room, conn);
  if (!mem || mem.seat !== s.turn) return reject(conn, "Not your turn");
  // a staged conquest must be resolved with `advance` before anything else
  if (s.lastConquest && m.action !== "advance") return reject(conn, "Resolve your conquest first");

  var res;
  switch (m.action) {
    case "setup":      res = E.placeSetupArmy(s, m.id); break;
    case "deploy":     res = E.placeArmies(s, m.id, m.count || 1); break;
    case "trade":      res = Array.isArray(m.idxs) ? E.tradeCards(s, m.idxs) : { ok: false, error: "bad card selection" }; break;
    case "endPhase":   res = E.endPhase(s) ? { ok: true } : { ok: false, error: "Can't end phase yet" }; break;
    case "skipFortify":res = E.skipFortify(s); break;
    case "fortify":    res = E.fortify(s, m.from, m.to, m.count); break;
    case "advance":    res = E.moveAfterConquest(s, m.count); break;
    case "attack":     return handleAttack(room, conn, m); // emits dice events itself
    default:           return reject(conn, "Unknown action: " + m.action);
  }
  if (!res || !res.ok) return reject(conn, (res && res.error) || "Illegal move");
  if (s.winner != null) broadcastEvent(room, { kind: "log", msg: s.log[s.log.length - 1] });
  broadcastState(room);
}

// One attack intent → server rolls (optionally blitzes), emitting a dice event
// per roll, then a single state broadcast. A conquest stages `lastConquest`,
// after which the attacker must send an `advance`.
function handleAttack(room, conn, m) {
  var s = room.state;
  if (!E.canAttack(s, m.from, m.to)) return reject(conn, "Illegal attack");
  var rounds = 0, conquered = false;
  do {
    var res = E.rollAttack(s, m.from, m.to);
    if (!res.ok) break;
    broadcastEvent(room, {
      kind: "dice", from: m.from, to: m.to,
      aRolls: res.aRolls, dRolls: res.dRolls,
      attackerLoss: res.attackerLoss, defenderLoss: res.defenderLoss, conquered: res.conquered,
    });
    conquered = res.conquered;
  } while (m.blitz && !conquered && E.canAttack(s, m.from, m.to) && ++rounds < 60);
  broadcastState(room);
}

// ==================================================================
//  Connection / message routing
// ==================================================================
createServer(function (conn) {
  conn.room = null;
  conn.on("message", function (txt) {
    var m; try { m = JSON.parse(txt); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;
    // optional shared-secret gate on entering a room
    if ((m.t === "create" || m.t === "join") && CONFIG.roomPassword && m.password !== CONFIG.roomPassword) {
      return reject(conn, "Wrong room password");
    }
    if (m.t === "create") {
      if (Object.keys(rooms).length >= CONFIG.maxRooms) return reject(conn, "Server is busy — too many rooms open");
      var code = makeCode();
      var room = rooms[code] = newRoom(code);
      if (typeof m.map === "string") room.config.mapId = m.map.slice(0, 32);
      if (m.manualSetup != null) room.config.manualSetup = !!m.manualSetup;
      var id = room.nextId++;
      room.members.push({ conn: conn, name: sanitizeName(m.name), id: id });
      conn.room = room; touch(room);
      conn.sendJSON({ t: "created", code: code, you: id });
      broadcastLobby(room);
      return;
    }
    if (m.t === "join") {
      var r = rooms[(typeof m.code === "string" ? m.code : "").toUpperCase()];
      if (!r) return reject(conn, "No room " + (m.code || ""));
      if (r.started) return reject(conn, "That game already started");
      if (r.members.length >= 6) return reject(conn, "Room is full (6 max)");
      var jid = r.nextId++;
      r.members.push({ conn: conn, name: sanitizeName(m.name), id: jid });
      conn.room = r; touch(r);
      conn.sendJSON({ t: "joined", code: r.code, you: jid });
      broadcastLobby(r);
      return;
    }
    var room2 = conn.room;
    if (!room2) return;
    touch(room2);
    if (m.t === "config" && isHost(room2, conn) && !room2.started) {
      if (typeof m.map === "string") room2.config.mapId = m.map.slice(0, 32);
      if (m.manualSetup != null) room2.config.manualSetup = !!m.manualSetup;
      broadcastLobby(room2);
      return;
    }
    if (m.t === "start" && isHost(room2, conn) && !room2.started) { startGame(room2); return; }
    if (m.t === "intent" && room2.started) { handleIntent(room2, conn, m); return; }
  });

  conn.on("close", function () {
    var room = conn.room; if (!room) return;
    var idx = room.members.findIndex(function (mm) { return mm.conn === conn; });
    if (idx >= 0) {
      var who = room.members[idx];
      if (!room.started) {
        room.members.splice(idx, 1);
        if (!room.members.length) { delete rooms[room.code]; return; }
        broadcastLobby(room);
      } else {
        // mid-game: free the seat; the turn may stall until they rejoin (slice-1 limit)
        if (who.seat != null) room.seatConn[who.seat] = null;
        broadcastEvent(room, { kind: "log", msg: who.name + " disconnected." });
        if (!room.seatConn.some(function (c) { return c && c.alive; })) delete rooms[room.code];
      }
    }
  });
});

// Reap dead/stale rooms so memory can't grow without bound.
var sweep = setInterval(function () {
  var now = Date.now();
  Object.keys(rooms).forEach(function (code) {
    var r = rooms[code];
    var live = r.started ? r.seatConn.some(function (c) { return c && c.alive; })
                         : r.members.some(function (m) { return m.conn.alive; });
    if (!live || now - (r.lastActivity || 0) > CONFIG.roomTtlMs) delete rooms[code];
  });
}, 60000); sweep.unref();

// expose for tests
module.exports = { rooms: rooms, CONFIG: CONFIG };
