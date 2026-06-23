/* XenoXanadu — Risk: Global Domination
 * ------------------------------------------------------------------
 * net/client.js — tiny browser transport for the match-server (global
 * window.RiskNet). Wraps a native WebSocket: queues messages until the
 * socket opens, parses JSON frames, and dispatches them by their `t` field.
 *
 *   var conn = RiskNet.connect("ws://localhost:8790");
 *   conn.on("@open",  fn);         // socket connected   (reserved: @open/@close/@error)
 *   conn.on("lobby",  fn);         // server message t:"lobby"
 *   conn.on("state",  fn);         // …t:"state", etc.
 *   conn.send({ t:"create", name:"Alice" });
 *
 * Server message types (t): created, joined, lobby, start, state, event, error.
 * Connection events use @-prefixed names so they can't collide with a t value.
 */
(function () {
  "use strict";
  function connect(url) {
    var ws, handlers = {}, queue = [];
    var api = {
      connected: false,
      url: url,
      on: function (t, fn) { handlers[t] = fn; return api; },
      send: function (o) { var s = JSON.stringify(o); if (api.connected) { try { ws.send(s); } catch (e) {} } else queue.push(s); },
      close: function () { try { ws.close(); } catch (e) {} },
    };
    function emit(t, m) { if (handlers[t]) try { handlers[t](m); } catch (e) { console.error("RiskNet handler", t, e); } }

    try { ws = new WebSocket(url); }
    catch (e) { setTimeout(function () { emit("@error", e); }, 0); return api; }

    ws.onopen = function () { api.connected = true; queue.forEach(function (s) { try { ws.send(s); } catch (e) {} }); queue = []; emit("@open"); };
    ws.onclose = function () { api.connected = false; emit("@close"); };
    ws.onerror = function (e) { emit("@error", e); };
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (err) { return; } emit(m.t, m); };
    return api;
  }
  window.RiskNet = { connect: connect };
})();
