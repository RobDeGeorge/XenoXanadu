/* XenoXanadu — Risk: Global Domination
 * ------------------------------------------------------------------
 * main.js — the browser UI: low-poly SVG map, interaction, phase flow,
 * the heuristic-bot turn driver, and the optional Bring-Your-Own-Model
 * VOICE layer (the generals' decisions are always the heuristic bot's, so
 * the model can only ever *speak* — it can never make an illegal move).
 */
(function () {
  "use strict";

  var E = window.RiskEngine, B = window.RiskBots, G = window.RiskGenerals;
  var P = window.RiskAIParse;
  var BYOM = window.XenoBYOM;

  // ---- element refs ----
  var $ = function (id) { return document.getElementById(id); };
  var svg = $("board"), boardWrap = $("boardWrap");
  var setupEl = $("setup"), gameEl = $("game");
  var diceEl = $("dice"), moveModal = $("moveModal");

  // ---- runtime state ----
  var state = null;          // RiskEngine state (or, online, the latest server snapshot)
  var sel = null;            // selected source territory (attack/fortify)
  var busy = false;          // a bot turn or animation is running
  var turnGen = 0;           // generation counter to abort stale async loops
  var polyEls = {}, badgeText = {}, badgeBg = {};
  // online multiplayer (net/server.js). When net.online, `state` is a redacted
  // snapshot from the authority and we send intents instead of mutating locally.
  var net = { online: false, mySeat: null, conn: null, code: null, you: null, host: false, members: [],
              url: null, token: null, reconnecting: false, reconnectTries: 0, leaving: false, spectator: false };

  // ===============================================================
  //  Deterministic low-poly polygon for each territory (stable shape)
  // ===============================================================
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
  function rnd(seed) { seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }

  function polyPoints(id, t, baseR) {
    if (!t) t = E.T[id];
    if (baseR == null) baseR = (E.currentMap && E.currentMap.terrRadius) || 38;
    var cx = t.x, cy = t.y;
    var seed = hashStr(id), n = 7 + Math.floor(rnd(seed) * 2); // 7–8 vertices
    var pts = [];
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + rnd(seed + i * 7) * 0.35 - 0.17;
      var r = baseR * (0.82 + rnd(seed + i * 13) * 0.4);
      // squash slightly vertically so landmasses feel map-like
      pts.push((cx + Math.cos(ang) * r).toFixed(1) + "," + (cy + Math.sin(ang) * r * 0.95).toFixed(1));
    }
    return pts.join(" ");
  }

  // ===============================================================
  //  Continent region backdrops — a soft blob behind each continent so
  //  players can SEE the regions worth taking (and their troop bonus).
  //
  //  The regions are a PARTITION of the board: every point is assigned to
  //  its nearest territory (a Voronoi assignment), so a continent's region
  //  is the union of its territories' cells. Two regions therefore SHARE a
  //  border but can never OVERLAP. Points farther than a coverage radius
  //  from every territory stay "ocean", so each region still hugs its own
  //  lands (sea gaps between distant continents) instead of tiling the
  //  whole canvas. The per-continent membership field is traced into smooth
  //  closed loops with marching squares.
  // ===============================================================

  // Catmull-Rom a closed loop of {x,y} into a smooth SVG subpath.
  function smoothClosed(loop) {
    var n = loop.length;
    if (n < 3) return "";
    // Round each corner with a quadratic through edge midpoints. Unlike a
    // Catmull-Rom spline this can never overshoot, so contours that converge
    // at a junction (e.g. four realms meeting at a point) don't curl into loops.
    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    var m0 = mid(loop[n - 1], loop[0]);
    var d = "M" + m0.x.toFixed(1) + "," + m0.y.toFixed(1);
    for (var i = 0; i < n; i++) {
      var cur = loop[i], m = mid(cur, loop[(i + 1) % n]);
      d += "Q" + cur.x.toFixed(1) + "," + cur.y.toFixed(1) + " " + m.x.toFixed(1) + "," + m.y.toFixed(1);
    }
    return d + "Z";
  }

  // Signed area of a loop (shoelace) — used to discard junction slivers.
  function loopArea(loop) {
    var a = 0;
    for (var i = 0, n = loop.length; i < n; i++) {
      var p = loop[i], q = loop[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  // Drop staircase noise: remove near-duplicate and collinear vertices.
  function simplifyLoop(loop) {
    var dedup = [];
    for (var i = 0; i < loop.length; i++) {
      var p = loop[i], q = dedup[dedup.length - 1];
      if (q && Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5) continue;
      dedup.push(p);
    }
    var res = [], m = dedup.length;
    for (var j = 0; j < m; j++) {
      var a = dedup[(j - 1 + m) % m], b = dedup[j], c = dedup[(j + 1) % m];
      var cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cr) < 1) continue; // b is collinear → skip
      res.push(b);
    }
    return res.length >= 3 ? res : dedup;
  }

  // Build one tinted, non-overlapping region path per continent. Self-contained
  // (reads only the map data), so it serves both the live board and the preview.
  function buildRegions(TT, CC, W, H, terrRadius) {
    var ids = Object.keys(TT);
    // Coverage radius: large enough to bridge same-continent neighbours (no
    // internal holes), finite so distant continents leave open sea between them.
    var maxAdj = 0;
    ids.forEach(function (id) {
      TT[id].adj.forEach(function (nb) {
        if (TT[nb] && TT[nb].cont === TT[id].cont) {
          var dx = TT[id].x - TT[nb].x, dy = TT[id].y - TT[nb].y;
          var dd = Math.sqrt(dx * dx + dy * dy);
          if (dd > maxAdj) maxAdj = dd;
        }
      });
    });
    var cover = Math.max(terrRadius * 2.7, maxAdj * 0.62), cover2 = cover * cover;
    var step = Math.max(6, Math.min(13, Math.round(Math.min(W, H) / 80)));
    // Pad the grid past the coverage radius on every side, so a region near the
    // board edge is fully ringed by ocean points and its contour always CLOSES
    // (otherwise a clipped outline gets sealed with a stray line across the map).
    var margin = cover + 2 * step;
    var GW = Math.ceil((W + 2 * margin) / step) + 1, GH = Math.ceil((H + 2 * margin) / step) + 1;
    var px = function (gx) { return gx * step - margin; }, py = function (gy) { return gy * step - margin; };
    // nearest-continent at a point (null = ocean / beyond coverage)
    function nearestAt(x, y) {
      var best = cover2, bc = null;
      for (var k = 0; k < ids.length; k++) {
        var t = TT[ids[k]], dx = x - t.x, dy = y - t.y, dd = dx * dx + dy * dy;
        if (dd < best) { best = dd; bc = t.cont; }
      }
      return bc;
    }
    // sample the field once at every grid POINT
    var cont = new Array(GW * GH);
    for (var gx = 0; gx < GW; gx++)
      for (var gy = 0; gy < GH; gy++)
        cont[gx * GH + gy] = nearestAt(px(gx), py(gy));
    function at(gx, gy) { return (gx < 0 || gy < 0 || gx >= GW || gy >= GH) ? null : cont[gx * GH + gy]; }

    var g = el("g", { class: "regions" });
    var keyOf = function (p) { return Math.round(p.x / (step / 2)) + ":" + Math.round(p.y / (step / 2)); };
    var edgeId = function (a, b) { return a < b ? a + "|" + b : b + "|" + a; };

    Object.keys(CC).forEach(function (c) {
      var info = CC[c]; if (!info) return;
      var segs = [];
      for (var gx = 0; gx < GW - 1; gx++) {
        for (var gy = 0; gy < GH - 1; gy++) {
          var tl = at(gx, gy) === c, tr = at(gx + 1, gy) === c,
              br = at(gx + 1, gy + 1) === c, bl = at(gx, gy + 1) === c;
          var mask = (tl ? 1 : 0) | (tr ? 2 : 0) | (br ? 4 : 0) | (bl ? 8 : 0);
          if (mask === 0 || mask === 15) continue;
          var x0 = px(gx), y0 = py(gy), hs = step / 2;
          var T = { x: x0 + hs, y: y0 }, R = { x: x0 + step, y: y0 + hs },
              B = { x: x0 + hs, y: y0 + step }, L = { x: x0, y: y0 + hs };
          if (mask === 5 || mask === 10) {
            // saddle — resolve by the cell centre's owner so the field stays consistent
            var mc = nearestAt(x0 + hs, y0 + hs) === c;
            if (mask === 5) { if (mc) { segs.push([T, R], [B, L]); } else { segs.push([L, T], [R, B]); } }
            else            { if (mc) { segs.push([L, T], [R, B]); } else { segs.push([T, R], [B, L]); } }
          } else {
            var cr = [];
            if (tl !== tr) cr.push(T);
            if (tr !== br) cr.push(R);
            if (br !== bl) cr.push(B);
            if (bl !== tl) cr.push(L);
            if (cr.length === 2) segs.push([cr[0], cr[1]]);
          }
        }
      }
      if (!segs.length) return;
      // chain unit segments into closed loops via shared endpoints (all degree 2)
      var adj = {}, pts = {};
      segs.forEach(function (s) {
        var ka = keyOf(s[0]), kb = keyOf(s[1]);
        pts[ka] = s[0]; pts[kb] = s[1];
        (adj[ka] = adj[ka] || []).push(kb);
        (adj[kb] = adj[kb] || []).push(ka);
      });
      var used = {}, loops = [];
      Object.keys(adj).forEach(function (startK) {
        adj[startK].forEach(function (nb0) {
          if (used[edgeId(startK, nb0)]) return;
          used[edgeId(startK, nb0)] = true;
          var loop = [pts[startK], pts[nb0]], prev = startK, cur = nb0, guard = 0;
          while (cur !== startK && guard++ < 200000) {
            var nbrs = adj[cur], nxt = null;
            for (var i = 0; i < nbrs.length; i++) {
              if (nbrs[i] === prev) continue;
              if (!used[edgeId(cur, nbrs[i])]) { nxt = nbrs[i]; used[edgeId(cur, nbrs[i])] = true; break; }
            }
            if (nxt == null) break;
            prev = cur; cur = nxt;
            if (cur !== startK) loop.push(pts[cur]);
          }
          if (cur === startK && loop.length >= 3) {
            var sl = simplifyLoop(loop);                       // closed loops only,
            if (loopArea(sl) >= step * step * 2.5) loops.push(sl); // minus junction slivers
          }
        });
      });
      if (!loops.length) return;
      var d = loops.map(smoothClosed).join(" ");
      g.appendChild(el("path", {
        d: d, "fill-rule": "evenodd", fill: info.color, "fill-opacity": "0.13",
        stroke: info.color, "stroke-opacity": "0.5", "stroke-width": "2", "stroke-linejoin": "round",
      }));
    });
    return g;
  }

  // ===============================================================
  //  Build the board once
  // ===============================================================
  var SVGNS = "http://www.w3.org/2000/svg";
  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function buildBoard() {
    svg.innerHTML = "";
    // defs: soft glow filter
    var defs = el("defs");
    defs.innerHTML =
      '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    svg.appendChild(defs);

    // continent region backdrops (behind everything)
    var M = E.currentMap;
    svg.appendChild(buildRegions(E.T, E.CONTINENTS, M.width, M.height, M.terrRadius || 38));

    // adjacency edges (under territories)
    var wrapKeys = {};
    (M.wrapEdges || []).forEach(function (e) {
      wrapKeys[e[0] < e[1] ? e[0] + "|" + e[1] : e[1] + "|" + e[0]] = true;
    });
    var gEdges = el("g");
    var drawn = {};
    E.TERRITORY_IDS.forEach(function (id) {
      E.T[id].adj.forEach(function (nb) {
        var key = id < nb ? id + "|" + nb : nb + "|" + id;
        if (drawn[key]) return; drawn[key] = true;
        var a = E.T[id], b = E.T[nb];
        var sea = a.cont !== b.cont;
        // wrap-around routes (e.g. Alaska↔Kamchatka) are drawn up over the top edge.
        if (wrapKeys[key]) {
          var poly = el("polyline", { points: a.x + "," + a.y + " " + a.x + ",18 " + b.x + ",18 " + b.x + "," + b.y, class: "edge sea" });
          gEdges.appendChild(poly); return;
        }
        gEdges.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "edge" + (sea ? " sea" : "") }));
      });
    });
    svg.appendChild(gEdges);

    // continent labels (rough centroids)
    var gC = el("g");
    E.CONTINENT_IDS.forEach(function (c) {
      var mem = E.CONT_MEMBERS[c], cx = 0, cy = 0;
      mem.forEach(function (id) { cx += E.T[id].x; cy += E.T[id].y; });
      cx /= mem.length; cy /= mem.length;
      var lab = el("text", { x: cx.toFixed(0), y: (cy).toFixed(0), class: "clabel", "text-anchor": "middle" });
      lab.textContent = E.CONTINENTS[c].name + "  +" + E.CONTINENTS[c].bonus;
      // per-map label nudges (off busy centres, single-tile continents, etc.)
      var nudge = (M.labelNudge || {})[c];
      if (nudge) {
        if (nudge.x != null) lab.setAttribute("x", nudge.x);
        if (nudge.y != null) lab.setAttribute("y", nudge.y);
      }
      gC.appendChild(lab);
    });
    svg.appendChild(gC);

    // territories + badges
    var gT = el("g"), gLab = el("g"), gBadge = el("g");
    E.TERRITORY_IDS.forEach(function (id) {
      var poly = el("polygon", { points: polyPoints(id), class: "terr", "data-id": id });
      poly.addEventListener("click", function () { onTerritory(id); });
      gT.appendChild(poly); polyEls[id] = poly;

      var t = E.T[id];
      var tl = el("text", { x: t.x, y: t.y - 14, class: "tlabel" });
      tl.textContent = t.name; gLab.appendChild(tl);

      var bg = el("circle", { cx: t.x, cy: t.y, r: 10.5, class: "badge-bg" });
      var bt = el("text", { x: t.x, y: t.y + 0.5, class: "badge" });
      gBadge.appendChild(bg); gBadge.appendChild(bt);
      badgeBg[id] = bg; badgeText[id] = bt;
    });
    svg.appendChild(gT); svg.appendChild(gLab); svg.appendChild(gBadge);
  }

  // ===============================================================
  //  Paint — reflect state + selection onto the board & rail
  // ===============================================================
  function ownerColor(pid) { return pid == null ? "#3b4150" : state.players[pid].color; }
  function darken(hex, f) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return "rgb(" + Math.round(r * f) + "," + Math.round(g * f) + "," + Math.round(b * f) + ")";
  }

  function paint() {
    if (!state) return;
    var legalTargets = {}, reach = {};
    if (sel != null) {
      if (state.phase === "attack") E.T[sel].adj.forEach(function (nb) { if (state.terr[nb].owner !== state.turn) legalTargets[nb] = true; });
      if (state.phase === "fortify") E.connectedOwn(state, sel).forEach(function (id) { reach[id] = true; });
    }
    var human = meActing();
    // During the setup draft, the board is still being CLAIMED until every
    // territory has an owner; after that, players stack onto their own land.
    var anyUnclaimed = state.phase === "setup" &&
      E.TERRITORY_IDS.some(function (tid) { return state.terr[tid].owner == null; });

    E.TERRITORY_IDS.forEach(function (id) {
      var cell = state.terr[id], poly = polyEls[id], unowned = cell.owner == null, col = ownerColor(cell.owner);
      poly.setAttribute("fill", col);
      poly.setAttribute("fill-opacity", unowned ? "0.30" : (cell.owner === state.turn ? "0.92" : "0.62"));
      poly.setAttribute("stroke", darken(col, 0.55));
      poly.className.baseVal = "terr";
      // badge — hidden while a territory is still unclaimed (no armies on it yet)
      if (unowned) {
        badgeBg[id].setAttribute("display", "none");
        badgeText[id].setAttribute("display", "none");
      } else {
        badgeBg[id].removeAttribute("display");
        badgeText[id].removeAttribute("display");
        badgeBg[id].setAttribute("fill", darken(col, 0.4));
        badgeBg[id].setAttribute("stroke", col);
        badgeBg[id].setAttribute("stroke-width", "1.4");
        badgeText[id].textContent = cell.armies;
      }

      // selection / highlight states (only meaningful on a human turn)
      if (id === sel) poly.classList.add("sel");
      if (human && !busy) {
        if (state.phase === "attack" && legalTargets[id]) poly.classList.add("target");
        if (state.phase === "fortify" && reach[id]) poly.classList.add("reach");
        if (state.phase === "reinforce" && cell.owner === state.turn) poly.classList.add("pulse");
        // setup: pulse the cells the current player can click — empties while
        // claiming, then their own territories while stacking.
        if (state.phase === "setup" && (anyUnclaimed ? unowned : cell.owner === state.turn)) poly.classList.add("pulse");
        if (state.phase === "attack" && sel == null && cell.owner === state.turn && cell.armies >= 2) poly.classList.add("pulse");
      }
    });
    paintRail();
  }

  function paintRail() {
    var p = E.currentPlayer(state);
    $("turnChip").style.color = p.color; $("turnChip").style.background = p.color;
    $("turnName").textContent = p.name;
    $("turnGen").textContent = p.general ? (p.general.emoji + " " + p.general.name) : (p.isHuman ? "Human commander" : "AI");

    document.querySelectorAll(".pstep").forEach(function (s) {
      s.classList.toggle("on", s.dataset.p === state.phase);
    });

    // reinforcement line / phase hint / action button
    var reinf = $("reinfLine"), hint = $("phaseHint"), btn = $("actionBtn"), blitzRow = $("blitzRow");
    blitzRow.style.display = (state.phase === "attack" && meActing()) ? "flex" : "none";
    var human = meActing();

    if (state.winner != null) {
      reinf.innerHTML = ""; hint.textContent = ""; btn.style.display = "none";
    } else if (state.phase === "setup") {
      btn.style.display = "none";
      var mine = state.setupRemaining[state.turn];
      var claiming = E.TERRITORY_IDS.some(function (id) { return state.terr[id].owner == null; });
      reinf.innerHTML = "Place <b>" + mine + "</b> — <span style='color:var(--muted);font-size:11px'>" + E.setupArmiesLeft(state) + " left to place</span>";
      hint.innerHTML = human
        ? (claiming
            ? "Claiming the map: click any <b>empty</b> territory to plant one army, then play passes on."
            : "Reinforcing: click one of <b>your</b> territories to drop a single army, then play passes on.")
        : "<span style='color:var(--muted)'>" + p.name + " is placing armies…</span>";
    } else if (!human) {
      reinf.innerHTML = "<span style='color:var(--muted)'>" + p.name + " is commanding…</span>";
      hint.textContent = ""; btn.style.display = "none";
    } else {
      btn.style.display = "block";
      if (state.phase === "reinforce") {
        reinf.innerHTML = "Deploy <b>" + state.reinforcements + "</b> " + (state.reinforcements === 1 ? "army" : "armies");
        var must = E.mustTrade(state, state.turn);
        hint.innerHTML = must
          ? "<b>You hold 5+ cards — trade a set first.</b>"
          : "Click your territories to deploy. <span style='opacity:.7'>Shift-click = +5.</span>";
        btn.textContent = "End Reinforcement";
        btn.disabled = state.reinforcements > 0 || must;
      } else if (state.phase === "attack") {
        reinf.innerHTML = "";
        hint.innerHTML = sel == null
          ? "Pick one of <b>your</b> territories (2+ armies) to attack from."
          : "Now click an adjacent <b>enemy</b> (dashed). Or pick a different source.";
        btn.textContent = "End Attack →"; btn.disabled = !!state.lastConquest;
      } else if (state.phase === "fortify") {
        reinf.innerHTML = "";
        hint.innerHTML = sel == null
          ? "Optional: click a source territory to move armies <b>from</b>."
          : "Click a connected territory to move armies <b>to</b>.";
        btn.textContent = "End Turn"; btn.disabled = false;
      }
    }

    paintCards(); paintRoster(); paintLog();
  }

  // ---- cards (only the local human player's hand is shown) ----
  var cardSel = [];
  var SYM_ICON = { infantry: "I", cavalry: "C", artillery: "A", wild: "★" };
  function viewedPlayer() {
    if (net.online) return net.mySeat;   // online: always my own hand
    // show the hand of the human whose turn it is, else the first human
    if (currentIsHuman()) return state.turn;
    var h = state.players.filter(function (p) { return p.isHuman && p.alive; })[0];
    return h ? h.id : state.turn;
  }
  function paintCards() {
    var pid = viewedPlayer(), p = state.players[pid], tray = $("cardTray");
    $("cardCount").textContent = "(" + p.cards.length + ")";
    tray.innerHTML = "";
    if (!p.cards.length) { tray.innerHTML = "<span class='cards-empty'>No cards yet — conquer a territory to earn one.</span>"; }
    p.cards.forEach(function (c, i) {
      var d = document.createElement("div");
      d.className = "pcard" + (cardSel.indexOf(i) >= 0 ? " sel" : "");
      d.innerHTML = SYM_ICON[c.sym] + "<small>" + (c.terr ? E.T[c.terr].name : "WILD") + "</small>";
      d.addEventListener("click", function () { toggleCard(i); });
      tray.appendChild(d);
    });
    // trade button: live only on the viewing human's own reinforce turn
    var canTrade = meActing() && state.turn === pid && state.phase === "reinforce";
    var tb = $("tradeBtn");
    tb.style.display = canTrade && p.cards.length >= 3 ? "block" : "none";
    var valid = cardSel.length === 3 && E.isSet(cardSel.map(function (i) { return p.cards[i]; }));
    tb.disabled = !valid;
    tb.textContent = valid ? ("Trade set for " + E.setValue(state.setsTraded) + " armies ▸") : "Select 3 matching cards";
  }
  function toggleCard(i) {
    if (!(meActing() && state.phase === "reinforce")) return;
    var k = cardSel.indexOf(i);
    if (k >= 0) cardSel.splice(k, 1); else { if (cardSel.length >= 3) cardSel.shift(); cardSel.push(i); }
    paintCards();
  }

  function paintRoster() {
    var r = $("roster"); r.innerHTML = "";
    state.players.forEach(function (p) {
      var lands = E.ownedBy(state, p.id).length, armies = E.armyTotal(state, p.id);
      var conts = E.ownedContinents(state, p.id).length;
      var row = document.createElement("div");
      var dropped = net.online && p.isHuman && p.connected === false && p.alive;
      row.className = "rrow" + (p.id === state.turn ? " active" : "") + (p.alive ? "" : " dead") + (dropped ? " dropped" : "");
      row.innerHTML =
        '<span class="chip" style="color:' + p.color + ';background:' + p.color + '"></span>' +
        '<span class="who">' + (p.general ? p.general.emoji + " " : (p.isHuman ? "" : "")) + esc(p.name) +
          (dropped ? ' <span class="drop-tag" title="Disconnected — can rejoin with the room code">⚠ reconnecting…</span>' : '') + '</span>' +
        '<span class="nums"><b>' + lands + '</b>⬡ <b>' + armies + '</b>◆' + (conts ? ' <b>' + conts + '</b>★' : '') + '</span>';
      r.appendChild(row);
    });
  }

  function paintLog() {
    var l = $("log"); l.innerHTML = "";
    state.log.slice(-30).reverse().forEach(function (m) { var d = document.createElement("div"); d.textContent = m; l.appendChild(d); });
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  // ===============================================================
  //  Helpers
  // ===============================================================
  function currentIsHuman() { return state && state.winner == null && E.currentPlayer(state).isHuman; }
  // "Can I act right now?" — offline: the current seat is a local human.
  // Online: it's the current seat AND that seat is mine.
  function meActing() {
    if (net.online) return !!state && state.winner == null && state.turn === net.mySeat;
    return currentIsHuman();
  }

  function svgPxToContainer(x, y) {
    // map viewBox coords to boardWrap percentage (viewBox = current map size)
    var M = E.currentMap;
    return { left: (x / M.width * 100) + "%", top: (y / M.height * 100) + "%" };
  }

  // ===============================================================
  //  Human interaction
  // ===============================================================
  function onTerritory(id) {
    if (net.online) { onTerritoryOnline(id); return; }
    if (!state || busy || !currentIsHuman() || state.winner != null) return;
    var cell = state.terr[id];

    if (state.phase === "setup") {
      if (!(state.setupRemaining[state.turn] > 0)) return;
      var res = E.placeSetupArmy(state, id); // claims an empty tile, else stacks onto own land
      if (!res || !res.ok) return;           // illegal click (e.g. own tile while empties remain)
      paint();
      if (state.phase !== "setup") { postSetup(); return; }   // last army placed → start play
      if (!currentIsHuman()) runSetupBots();                   // hand the draft to the AI
      // else: another human (pass & play) — board stays open for their click
      return;
    }

    if (state.phase === "reinforce") {
      if (cell.owner !== state.turn || state.reinforcements <= 0) return;
      var amt = window.event && window.event.shiftKey ? 5 : 1;
      E.placeArmies(state, id, amt);
      paint();
      if (state.reinforcements === 0 && !E.mustTrade(state, state.turn)) { /* leave it to the button or auto */ }
      return;
    }

    if (state.phase === "attack") {
      if (cell.owner === state.turn) { sel = cell.armies >= 2 ? id : null; paint(); return; }
      // clicking an enemy: must have a valid source adjacent
      if (sel != null && E.canAttack(state, sel, id)) { humanAttack(sel, id); }
      return;
    }

    if (state.phase === "fortify") {
      if (sel == null) { if (cell.owner === state.turn && cell.armies >= 2) { sel = id; paint(); } return; }
      if (id === sel) { sel = null; paint(); return; }
      if (cell.owner === state.turn && E.canFortify(state, sel, id)) { openMoveModal("fortify", sel, id); return; }
      if (cell.owner === state.turn && cell.armies >= 2) { sel = id; paint(); }
      return;
    }
  }

  function humanAttack(from, to) {
    var blitz = $("blitzChk").checked;
    busy = true; paint();
    var rounds = 0;
    (function step() {
      if (!E.canAttack(state, from, to)) { finishHumanAssault(from, to); return; }
      var res = E.rollAttack(state, from, to);
      showDice(to, res);
      paintBadgesOnly();
      rounds++;
      if (res.conquered) {
        setTimeout(function () { hideDice(); afterConquest(from, to, true); }, 700);
        return;
      }
      if (blitz && E.canAttack(state, from, to) && rounds < 60) { setTimeout(step, 480); }
      else { setTimeout(function () { hideDice(); finishHumanAssault(from, to); }, 700); }
    })();
  }

  function finishHumanAssault(from, to) {
    busy = false;
    // keep the source selected if it can still attack something
    if (state.terr[from] && state.terr[from].owner === state.turn && state.terr[from].armies >= 2) sel = from; else sel = null;
    checkGameEnd(); paint();
  }

  // human conquest → ask how many armies to advance
  function afterConquest(from, to, isHuman) {
    if (!state.lastConquest) { finishHumanAssault(from, to); return; }
    var c = state.lastConquest;
    if (c.minMove === c.maxMove) { E.moveAfterConquest(state, c.maxMove); finishHumanAssault(from, to); return; }
    openMoveModal("advance", from, to);
  }

  // ===============================================================
  //  Move / fortify modal
  // ===============================================================
  var modalCtx = null;
  function openMoveModal(kind, from, to) {
    busy = true;
    var range = $("mmRange"), val = $("mmVal");
    var min, max, title, sub;
    if (kind === "advance") {
      var c = state.lastConquest; min = c.minMove; max = c.maxMove;
      title = "Advance into " + E.T[to].name;
      sub = "Move at least " + min + " (you attacked with that many dice). Leave the rest to defend " + E.T[from].name + ".";
    } else { // fortify
      max = state.terr[from].armies - 1; min = 1;
      title = "Fortify " + E.T[to].name;
      sub = "Move armies from " + E.T[from].name + ". This ends your turn.";
    }
    modalCtx = { kind: kind, from: from, to: to, min: min, max: max };
    range.min = min; range.max = max; range.value = max; val.textContent = max;
    $("mmTitle").textContent = title; $("mmSub").textContent = sub;
    moveModal.style.display = "flex";
  }
  $("mmRange").addEventListener("input", function () { $("mmVal").textContent = this.value; });
  $("mmMin").addEventListener("click", function () { $("mmRange").value = modalCtx.min; $("mmVal").textContent = modalCtx.min; });
  $("mmOk").addEventListener("click", function () {
    var n = +$("mmRange").value, ctx = modalCtx;
    moveModal.style.display = "none"; modalCtx = null; busy = false;
    if (net.online) {
      if (ctx.kind === "advance") sendIntent("advance", { count: n });
      else { sendIntent("fortify", { from: ctx.from, to: ctx.to, count: n }); sel = null; }
      return;
    }
    if (ctx.kind === "advance") {
      E.moveAfterConquest(state, n);
      finishHumanAssault(ctx.from, ctx.to);
    } else {
      E.fortify(state, ctx.from, ctx.to, n);
      sel = null; checkGameEnd(); paint();
      afterTurnHandoff();
    }
  });

  // ===============================================================
  //  Dice overlay
  // ===============================================================
  function showDice(to, res) {
    var pos = svgPxToContainer(E.T[to].x, E.T[to].y);
    diceEl.style.left = pos.left; diceEl.style.top = pos.top;
    diceEl.style.transform = "translate(-50%,-135%)";
    diceEl.style.display = "flex";
    function col(label, rolls, loseFlags, color) {
      var dice = rolls.map(function (r, i) { return '<div class="die' + (loseFlags[i] ? ' lose' : '') + '">' + r + '</div>'; }).join("");
      return '<div class="col"><div class="lab" style="color:' + color + '">' + label + '</div><div class="row">' + dice + '</div></div>';
    }
    // figure which dice "lost" (the compared pairs) for colour
    var aS = res.aRolls.slice().sort(function (a, b) { return b - a; });
    var dS = res.dRolls.slice().sort(function (a, b) { return b - a; });
    var aLose = res.aRolls.map(function () { return false; });
    var dLose = res.dRolls.map(function () { return false; });
    // mark by sorted comparison (visual approximation)
    var pairs = Math.min(aS.length, dS.length);
    var aIdx = res.aRolls.map(function (v, i) { return i; }).sort(function (i, j) { return res.aRolls[j] - res.aRolls[i]; });
    var dIdx = res.dRolls.map(function (v, i) { return i; }).sort(function (i, j) { return res.dRolls[j] - res.dRolls[i]; });
    for (var k = 0; k < pairs; k++) { if (aS[k] > dS[k]) dLose[dIdx[k]] = true; else aLose[aIdx[k]] = true; }
    diceEl.innerHTML = col("Attack", res.aRolls, aLose, "#cf5a52") + col("Defend", res.dRolls, dLose, "#6f9bd1");
  }
  function hideDice() { diceEl.style.display = "none"; }

  function paintBadgesOnly() {
    E.TERRITORY_IDS.forEach(function (id) {
      var cell = state.terr[id], col = ownerColor(cell.owner);
      polyEls[id].setAttribute("fill", col);
      badgeBg[id].setAttribute("fill", darken(col, 0.4));
      badgeBg[id].setAttribute("stroke", col);
      badgeText[id].textContent = cell.armies;
    });
    paintRoster();
  }

  // ===============================================================
  //  Phase buttons
  // ===============================================================
  $("actionBtn").addEventListener("click", function () {
    if (net.online) {
      if (!meActing()) return;
      sel = null;
      sendIntent(state.phase === "fortify" ? "skipFortify" : "endPhase");
      return;
    }
    if (!currentIsHuman() || busy) return;
    if (state.phase === "fortify") { E.skipFortify(state); sel = null; checkGameEnd(); paint(); afterTurnHandoff(); return; }
    var ok = E.endPhase(state);
    if (ok) { sel = null; cardSel = []; paint(); }
  });

  $("tradeBtn").addEventListener("click", function () {
    if (net.online) {
      if (!(meActing() && state.phase === "reinforce") || cardSel.length !== 3) return;
      sendIntent("trade", { idxs: cardSel.slice().sort(function (a, b) { return a - b; }) });
      cardSel = [];
      return;
    }
    var pid = viewedPlayer();
    if (!(currentIsHuman() && state.turn === pid)) return;
    var res = E.tradeCards(state, cardSel.slice().sort(function (a, b) { return a - b; }));
    cardSel = [];
    if (res.ok) paint();
  });

  // ===============================================================
  //  Turn handoff + bot driver
  // ===============================================================
  function afterTurnHandoff() {
    cardSel = [];
    if (state.winner != null) { checkGameEnd(); return; }
    if (!currentIsHuman()) setTimeout(runBotTurn, 500);
    else paint();
  }

  // --- manual-setup draft: AI players drop their armies one at a time (always
  //     heuristic, even when a model is set to play — a per-army model call
  //     would be far too slow), pausing whenever it's a human's turn. ---
  function runSetupBots() {
    var myGen = ++turnGen;
    busy = true; paint();
    (function step() {
      if (myGen !== turnGen) return;
      if (state.phase !== "setup") { busy = false; postSetup(); return; }
      if (currentIsHuman()) { busy = false; paint(); return; } // wait for the human
      var p = E.currentPlayer(state);
      var id = B.planSetupPlacement(state, weightsOf(p));
      E.placeSetupArmy(state, id);
      paint();
      setTimeout(step, 130);
    })();
  }

  // The draft finished → hand off to the first player's normal turn.
  function postSetup() {
    busy = false; sel = null; paint();
    if (state.winner != null) { checkGameEnd(); return; }
    if (!currentIsHuman()) setTimeout(runBotTurn, 500);
    else paint();
  }

  function checkGameEnd() {
    if (state.winner == null) return false;
    var w = state.players[state.winner];
    var banner = $("winner");
    banner.style.display = "block";
    banner.style.color = w.color;
    banner.textContent = w.name + " conquers the world!";
    E.log(state, w.name + " has achieved global domination.");
    paint();
    return true;
  }

  // --- a full bot turn. If a local model is connected & "plays", the MODEL
  //     makes every decision (picking from engine-supplied legal options, with
  //     a heuristic fallback on any unreadable reply). Otherwise the built-in
  //     heuristic plays and the general just gets a canned taunt. ---
  function runBotTurn() {
    if (!state || state.winner != null) { checkGameEnd(); return; }
    var p = E.currentPlayer(state);
    if (p.isHuman) { paint(); return; }
    if (useModel()) { runModelTurn(p); return; }
    busy = true; sel = null;
    var myGen = ++turnGen;
    var w = p.general ? p.general.weights : { aggression: 0.6, bravado: 0.5, expansion: 0.6, continent: 0.6, vengeance: 0.4, targetCont: null };
    var conquests = [];

    // 1) reinforce
    B.planReinforcements(state, w);
    E.endPhase(state); // → attack
    paint();

    // 2) attack loop (paced)
    var attacks = 0;
    function attackStep() {
      if (myGen !== turnGen) return;
      if (state.winner != null) { busy = false; checkGameEnd(); return; }
      var m = attacks < 40 ? B.planAttack(state, w) : null;
      if (!m) { hideDice(); goFortify(); return; }
      attacks++;
      var before = state.terr[m.to].owner;
      var res = E.rollAttack(state, m.from, m.to);
      showDice(m.to, res);
      paintBadgesOnly();
      if (res.conquered) {
        conquests.push({ to: m.to, from: before });
        E.moveAfterConquest(state, B.advanceCount(state, w));
        if (state.winner != null) { setTimeout(function () { hideDice(); busy = false; checkGameEnd(); }, 700); return; }
      }
      setTimeout(function () { hideDice(); setTimeout(attackStep, 180); }, res.conquered ? 620 : 460);
    }

    function goFortify() {
      if (myGen !== turnGen) return;
      E.endPhase(state); // attack → fortify
      paint();
      var f = B.planFortify(state, w);
      setTimeout(function () {
        if (myGen !== turnGen) return;
        if (f && E.canFortify(state, f.from, f.to)) E.fortify(state, f.from, f.to, f.count);
        else E.skipFortify(state);
        busy = false;
        voiceTurn(p, conquests); // best-effort, non-blocking
        paint();
        if (state.winner != null) { checkGameEnd(); return; }
        if (!E.currentPlayer(state).isHuman) setTimeout(runBotTurn, 650);
        else paint();
      }, 520);
    }

    setTimeout(attackStep, 520);
  }

  // ===============================================================
  //  MODEL-DRIVEN TURN — the local model actually plays the seat.
  //  Contract (same as chess/backgammon): the engine hands the model a
  //  NUMBERED list of legal options for each phase; the model replies with a
  //  number; an unreadable reply falls back to the heuristic planner. So the
  //  model can never make an illegal move and a flaky model can't wedge the game.
  // ===============================================================
  function useModel() { return ai.on && !!ai.model && BYOM.isLocal(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isReasoningModel(m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss/i.test(m || ""); }
  function weightsOf(p) {
    return p.general ? p.general.weights : { aggression: 0.6, bravado: 0.5, expansion: 0.6, continent: 0.6, vengeance: 0.4, targetCont: null };
  }

  async function runModelTurn(p) {
    busy = true; sel = null;
    var myGen = ++turnGen, w = weightsOf(p), g = p.general;
    setVoice((g ? g.emoji + " " + g.name : "AI") + " surveys the map…", p.color);
    paint();
    try {
      await modelDeploy(p, w, g, myGen);            if (myGen !== turnGen) return;
      if (!E.endPhase(state)) { B.planReinforcements(state, w); E.endPhase(state); } // safety
      paint(); await sleep(250);
      await modelAttacks(p, w, g, myGen);           if (myGen !== turnGen) return;
      if (state.winner != null) { busy = false; checkGameEnd(); return; }
      E.endPhase(state); paint(); await sleep(250);
      await modelFortify(p, w, g, myGen);           if (myGen !== turnGen) return;
    } catch (e) {
      // total model failure → finish the turn with heuristics so play continues
      if (myGen !== turnGen) return;
      if (state.phase === "reinforce") { B.planReinforcements(state, w); E.endPhase(state); }
      if (state.phase === "attack") { if (state.lastConquest) E.moveAfterConquest(state, state.lastConquest.minMove); E.endPhase(state); }
      if (state.phase === "fortify") E.skipFortify(state);
      setAIStatus("Model error — heuristics finished the turn.", "err");
    }
    busy = false; paint();
    if (state.winner != null) { checkGameEnd(); return; }
    if (!E.currentPlayer(state).isHuman) setTimeout(runBotTurn, 600); else paint();
  }

  // ---- one streamed model call; returns the full text ("" on failure) ----
  async function askModel(p, situation, userMsg, phaseLabel, myGen) {
    var g = p.general;
    if (ai.controller) { try { ai.controller.abort(); } catch (e) {} }
    ai.controller = new AbortController();
    var head = (g ? g.emoji + " " + g.name : "AI") + " — " + phaseLabel + "…\n\n";
    setVoice(head, p.color);
    var sys = (g ? "You are " + g.name + ", a Risk general — " + g.voice + "." : "You are a Risk AI commander.") +
      " " + situation + " Reason briefly, then give your decision in the EXACT format requested. Keep any in-character remark to one short sentence.";
    var acc = "";
    var onTok = function (d) { if (myGen === turnGen) { acc += d; var v = $("aiVoice"); v.textContent = head + acc; v.scrollTop = v.scrollHeight; } };
    try {
      var full = await BYOM.chat({
        endpoint: ai.endpoint, model: ai.model,
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.7, maxTokens: isReasoningModel(ai.model) ? 2048 : 420,
        signal: ai.controller.signal, onToken: onTok, onThinking: onTok,
      });
      return full || acc;
    } catch (e) { return ""; }
  }

  // ---- prompt helpers ----
  function enemyAdjStr(id) {
    var pid = state.terr[id].owner;
    var es = E.T[id].adj.filter(function (nb) { return state.terr[nb].owner !== pid; });
    if (!es.length) return "interior/safe";
    return "vs " + es.slice(0, 3).map(function (nb) { return E.T[nb].name + ":" + state.terr[nb].armies; }).join(", ");
  }
  var parseIndex = P.parseIndex;

  // ---- PHASE 1: deploy (with mandatory/greedy card trades) ----
  async function modelDeploy(p, w, g, myGen) {
    var guard = 0;
    while (E.findSet(p.cards) && guard++ < 6) {
      if (!E.mustTrade(state, p.id) && p.cards.length < 4) break; // hold small hands
      E.tradeCards(state, E.findSet(p.cards));
    }
    paint();
    var R = state.reinforcements; if (R <= 0) return;
    var own = E.ownedBy(state, p.id);
    var borders = own.filter(function (id) { return B.isBorder(state, id); });
    var list = (borders.length ? borders : own).slice()
      .sort(function (a, b) { return B.enemyPressure(state, b) - B.enemyPressure(state, a); })
      .slice(0, 16);
    var lines = list.map(function (id, i) { return (i + 1) + ". " + E.T[id].name + " — " + state.terr[id].armies + " armies (" + enemyAdjStr(id) + ")"; });
    var usr = "REINFORCE PHASE. You have " + R + " new armies to deploy onto your front-line territories:\n" +
      lines.join("\n") +
      "\n\nStack armies where you intend to break through or must defend. Reply with one line PER territory you reinforce, e.g.:\nDEPLOY 1 " + Math.ceil(R / 2) + "\nDEPLOY 3 " + Math.floor(R / 2) +
      "\nThe army counts must total exactly " + R + ".";
    var reply = await askModel(p, "It is your reinforcement phase.", usr, "deploying", myGen);
    if (myGen !== turnGen) return;
    var alloc = P.parseDeploy(reply, list.length);
    var entries = alloc && P.reconcileDeploy(alloc, R);
    if (!entries) { B.planReinforcements(state, w); paint(); return; } // fallback
    entries.forEach(function (e) { E.placeArmies(state, list[e.i], e.c); });
    while (state.reinforcements > 0) E.placeArmies(state, list[0], state.reinforcements);
    paint();
  }

  // ---- PHASE 2: attacks (loop: model picks an assault or stops) ----
  async function modelAttacks(p, w, g, myGen) {
    for (var decision = 0; decision < 12; decision++) {
      if (myGen !== turnGen || state.winner != null) return;
      var atks = E.listAttacks(state);
      if (!atks.length) return;
      var ranked = atks.map(function (m) {
        return { m: m, edge: B.attackEdge(state.terr[m.from].armies, state.terr[m.to].armies) };
      }).sort(function (a, b) { return b.edge - a.edge; }).slice(0, 12);
      var lines = ranked.map(function (e, i) {
        var m = e.m, owner = state.players[state.terr[m.to].owner];
        return (i + 1) + ". " + E.T[m.from].name + " (" + state.terr[m.from].armies + ") → " +
          E.T[m.to].name + " (" + state.terr[m.to].armies + ", " + owner.name + ")";
      });
      var usr = "ATTACK PHASE (decision " + (decision + 1) + "). Your available assaults — attacker armies → defender armies:\n" +
        lines.join("\n") + "\n0. Stop attacking and keep your armies\n\nReply `ATTACK: <number>` for the assault you choose, or `ATTACK: 0` to stop. You'll press the chosen attack until you take the territory or can't.";
      var reply = await askModel(p, "It is your attack phase.", usr, decision === 0 ? "planning the assault" : "pressing on", myGen);
      if (myGen !== turnGen) return;
      var idx = parseIndex(reply, "attack");
      if (idx === 0) return;
      var choice;
      if (idx == null || idx < 1 || idx > ranked.length) {
        var hm = B.planAttack(state, w); if (!hm) return; choice = hm; // heuristic fallback (may say stop)
      } else choice = ranked[idx - 1].m;
      await runAssault(choice.from, choice.to, w, myGen);
      if (myGen !== turnGen) return;
    }
  }
  // press one assault as a blitz, animating each roll
  async function runAssault(from, to, w, myGen) {
    var rounds = 0;
    while (E.canAttack(state, from, to) && rounds++ < 40) {
      if (myGen !== turnGen) return;
      var res = E.rollAttack(state, from, to);
      showDice(to, res); paintBadgesOnly();
      await sleep(res.conquered ? 520 : 360);
      hideDice();
      if (res.conquered) { E.moveAfterConquest(state, B.advanceCount(state, w)); break; }
    }
    paint();
  }

  // ---- PHASE 3: fortify (model picks one move or skips) ----
  async function modelFortify(p, w, g, myGen) {
    var cands = fortifyCandidates();
    if (!cands.length) { E.skipFortify(state); paint(); return; }
    var shown = cands.slice(0, 8);
    var lines = shown.map(function (c, i) {
      return (i + 1) + ". move " + c.count + " from " + E.T[c.from].name + " (" + state.terr[c.from].armies + ") → " +
        E.T[c.to].name + " (" + state.terr[c.to].armies + ", " + enemyAdjStr(c.to) + ")";
    });
    var usr = "FORTIFY PHASE — you may make ONE army move through connected territory, then your turn ends:\n" +
      lines.join("\n") + "\n0. Don't fortify\n\nReply `FORTIFY: <number>` (or `FORTIFY: 0`).";
    var reply = await askModel(p, "It is your fortify phase.", usr, "repositioning", myGen);
    if (myGen !== turnGen) return;
    var idx = parseIndex(reply, "fortify");
    if (idx === 0) { E.skipFortify(state); paint(); return; }
    if (idx == null || idx < 1 || idx > shown.length) {
      var hf = B.planFortify(state, w);
      if (hf && E.canFortify(state, hf.from, hf.to)) E.fortify(state, hf.from, hf.to, hf.count); else E.skipFortify(state);
      paint(); return;
    }
    var c = shown[idx - 1];
    if (E.canFortify(state, c.from, c.to)) E.fortify(state, c.from, c.to, c.count); else E.skipFortify(state);
    paint();
  }
  // candidate fortifies: from each stack, push spare armies to its most-pressured reachable border
  function fortifyCandidates() {
    var pid = state.turn, out = [], seen = {};
    E.ownedBy(state, pid).forEach(function (from) {
      if (state.terr[from].armies < 2 || seen[from]) return;
      var best = null;
      E.connectedOwn(state, from).forEach(function (to) {
        if (state.terr[to].owner !== pid || !B.isBorder(state, to)) return;
        var pr = B.enemyPressure(state, to);
        if (!best || pr > best.pr) best = { to: to, pr: pr };
      });
      if (!best) return;
      var spare = state.terr[from].armies - 1;
      var keep = B.isBorder(state, from) ? Math.ceil(spare * 0.3) : 0;
      seen[from] = true;
      out.push({ from: from, to: best.to, count: Math.max(1, spare - keep), score: best.pr - B.enemyPressure(state, from) });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  // ===============================================================
  //  Bring-Your-Own-Model layer (optional, local only). When OFF (or no
  //  model), the heuristic plays and the general gets a canned taunt below.
  // ===============================================================
  var ai = { on: false, model: "", endpoint: "http://localhost:11434", controller: null };
  function buildAIPanel() {
    var mount = $("aiPanel");
    mount.innerHTML =
      '<div class="ai-row"><span class="ai-label">Plays</span>' +
        '<label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);flex:1">' +
        '<input type="checkbox" id="aiOn" style="accent-color:var(--ai-on);width:15px;height:15px"> let a local model make the AI generals\' moves</label></div>' +
      '<div class="ai-row"><span class="ai-label">Model</span>' +
        '<select class="ai-model" id="aiModel"><option>loading…</option></select>' +
        '<button class="ai-refresh" id="aiRefresh" title="Re-scan models">↻</button></div>' +
      '<div class="ai-row"><span class="ai-label">Endpoint</span>' +
        '<input type="text" id="aiEndpoint" value="http://localhost:11434"></div>' +
      '<div class="ai-statusline"><span class="ai-dot" id="aiDot"></span><span class="ai-status" id="aiStatus">Generals use built-in heuristics.</span></div>' +
      '<div class="ai-think" id="aiVoice">Tick the box and a connected model picks every move (deploy, attack, fortify) from the engine\'s legal options — its reasoning streams here. Unreadable replies fall back to the heuristic, so it can never play illegally.</div>' +
      '<div class="ai-hint">Need setup? <a href="../../ai-setup.html">Connect a model ▸</a></div>';

    $("aiEndpoint").value = (BYOM.loadConfig().endpoint) || ai.endpoint;
    $("aiOn").addEventListener("change", function () { ai.on = this.checked; if (ai.on) loadAIModels(); });
    $("aiRefresh").addEventListener("click", loadAIModels);
    $("aiEndpoint").addEventListener("change", loadAIModels);
    $("aiModel").addEventListener("change", function () { ai.model = this.value; BYOM.saveConfig({ model: this.value }); });
  }
  function setAIStatus(t, s) { var d = $("aiDot"); $("aiStatus").textContent = t; d.className = "ai-dot" + (s ? " " + s : ""); }
  async function loadAIModels() {
    ai.endpoint = ($("aiEndpoint").value || "http://localhost:11434").replace(/\/$/, "");
    BYOM.saveConfig({ endpoint: ai.endpoint });
    var sel = $("aiModel"); sel.disabled = true; sel.innerHTML = "<option>loading…</option>";
    var res = await BYOM.test({ endpoint: ai.endpoint });
    if (!res.ok) { sel.innerHTML = '<option value="">— not reachable —</option>'; setAIStatus(res.error.message + " — see setup page.", "err"); return; }
    var saved = BYOM.loadConfig().model;
    sel.innerHTML = res.models.map(function (n) { return '<option value="' + n + '">' + n + "</option>"; }).join("");
    sel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved : (res.models.find(function (n) { return /3b|7b|8b|mini|small|qwen|llama/i.test(n); }) || res.models[0]);
    sel.value = fav; ai.model = fav; BYOM.saveConfig({ model: fav });
    setAIStatus("Ready — " + ai.model + " will command the AI generals.", "on");
  }

  // Heuristic-turn flavour: a canned in-character taunt. (When a model is set
  // to PLAY, runModelTurn streams the model's own reasoning instead and this
  // path isn't taken.)
  function voiceTurn(p, conquests) {
    if (!p.general) return;
    var g = p.general, taunt = g.taunts[Math.floor(Math.random() * g.taunts.length)];
    setVoice(g.emoji + " " + g.name + ": " + taunt, p.color);
  }
  function setVoice(text, color) { var v = $("aiVoice"); v.textContent = text; v.style.color = color || "var(--text)"; }

  // ===============================================================
  //  Map picker
  // ===============================================================
  var MAPS = (window.RiskMaps && RiskMaps.list()) || [E.CLASSIC_MAP];
  function chosenMap() {
    var id = $("mapPick").value;
    return (window.RiskMaps && RiskMaps.get(id)) || E.CLASSIC_MAP;
  }
  function populateMaps() {
    var pick = $("mapPick");
    pick.innerHTML = "";
    MAPS.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.name + " · " + Object.keys(m.territories).length + " territories";
      pick.appendChild(o);
    });
    onMapChange();
  }
  function onMapChange() {
    var m = chosenMap(), box = $("mapBlurb");
    if (box) box.textContent = m.blurb || "";
    renderPreview(m);
  }
  // Draw a static thumbnail of a board straight from its definition (no game
  // state needed): continent-tinted territories over the adjacency graph.
  function renderPreview(mapDef) {
    var pv = $("mapPreview");
    if (!pv || !mapDef) return;
    pv.setAttribute("viewBox", "0 0 " + mapDef.width + " " + mapDef.height);
    pv.innerHTML = "";
    var TT = mapDef.territories, CC = mapDef.continents;
    pv.appendChild(buildRegions(TT, CC, mapDef.width, mapDef.height, mapDef.terrRadius || 38));
    var wrap = {};
    (mapDef.wrapEdges || []).forEach(function (e) {
      wrap[e[0] < e[1] ? e[0] + "|" + e[1] : e[1] + "|" + e[0]] = true;
    });
    var gE = el("g"), drawn = {};
    Object.keys(TT).forEach(function (id) {
      TT[id].adj.forEach(function (nb) {
        var key = id < nb ? id + "|" + nb : nb + "|" + id;
        if (drawn[key]) return; drawn[key] = true;
        var a = TT[id], b = TT[nb], sea = a.cont !== b.cont;
        if (wrap[key]) { gE.appendChild(el("polyline", { points: a.x + "," + a.y + " " + a.x + ",18 " + b.x + ",18 " + b.x + "," + b.y, class: "edge sea" })); return; }
        gE.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "edge" + (sea ? " sea" : "") }));
      });
    });
    pv.appendChild(gE);
    var gT = el("g"), r = (mapDef.terrRadius || 38) * 0.78;
    Object.keys(TT).forEach(function (id) {
      var t = TT[id], col = (CC[t.cont] && CC[t.cont].color) || "#5a6b7a";
      gT.appendChild(el("polygon", { points: polyPoints(id, t, r), fill: col, "fill-opacity": "0.82", stroke: darken(col, 0.55), "stroke-width": "1.2" }));
    });
    pv.appendChild(gT);
  }
  $("mapPick").addEventListener("change", onMapChange);

  // ===============================================================
  //  New game / setup
  // ===============================================================
  function startGame() {
    var humans = +$("humanCount").value, bots = +$("botCount").value;
    var total = humans + bots;
    if (total < 2) { bots = 2 - humans; }
    if (total > 6) { bots = 6 - humans; }
    var defs = [];
    for (var i = 0; i < humans; i++) defs.push({ name: humans === 1 ? "You" : "Player " + (i + 1), isHuman: true });
    var gens = G.pick(bots);
    for (var j = 0; j < bots; j++) defs.push({ name: gens[j].name, isHuman: false, general: gens[j] });

    var mapDef = chosenMap();
    var manualSetup = $("manualSetup") && $("manualSetup").checked;
    state = E.newGame({ players: defs, map: mapDef, manualSetup: manualSetup });
    sel = null; cardSel = []; busy = false; turnGen++;
    svg.setAttribute("viewBox", "0 0 " + mapDef.width + " " + mapDef.height);
    svg.setAttribute("aria-label", "Risk map — " + mapDef.name);
    buildBoard();
    $("winner").style.display = "none";
    setupEl.style.display = "none"; gameEl.style.display = "grid";
    $("mapPreviewWrap").style.display = "none"; $("mapBlurb").style.display = "none";
    paint();
    if (state.phase === "setup") { if (!currentIsHuman()) runSetupBots(); }
    // if player 1 is a bot (humans>=1 so P0 is human here) — but spectate-safe:
    else if (!currentIsHuman()) setTimeout(runBotTurn, 600);
  }

  $("newGame").addEventListener("click", startGame);

  // keep human/bot counts within 2–6 total
  function clampCounts() {
    var humans = +$("humanCount").value, botSel = $("botCount");
    var maxBots = 6 - humans, minBots = Math.max(1, 2 - humans);
    Array.prototype.forEach.call(botSel.options, function (o) {
      o.disabled = (+o.value > maxBots) || (+o.value < minBots);
    });
    if (+botSel.value > maxBots) botSel.value = maxBots;
    if (+botSel.value < minBots) botSel.value = minBots;
  }
  $("humanCount").addEventListener("change", clampCounts);

  // ===============================================================
  //  Online multiplayer — create/join a room on the match-server, send
  //  intents, render redacted snapshots. (Slice 1: humans only.)
  // ===============================================================
  function sendIntent(action, extra) {
    if (net.conn) net.conn.send(Object.assign({ t: "intent", action: action }, extra || {}));
  }

  // mirror of onTerritory, but every move is sent to the authority as an intent
  function onTerritoryOnline(id) {
    if (!state || state.winner != null || !meActing()) return;
    var cell = state.terr[id];
    if (state.phase === "setup") {
      if (cell.owner !== state.turn || !(state.setupRemaining[state.turn] > 0)) return;
      sendIntent("setup", { id: id }); return;
    }
    if (state.phase === "reinforce") {
      if (cell.owner !== state.turn || state.reinforcements <= 0) return;
      var amt = (window.event && window.event.shiftKey) ? 5 : 1;
      sendIntent("deploy", { id: id, count: Math.min(amt, state.reinforcements) }); return;
    }
    if (state.phase === "attack") {
      if (cell.owner === state.turn) { sel = cell.armies >= 2 ? id : null; paint(); return; }
      if (sel != null && E.canAttack(state, sel, id)) sendIntent("attack", { from: sel, to: id, blitz: $("blitzChk").checked });
      return;
    }
    if (state.phase === "fortify") {
      if (sel == null) { if (cell.owner === state.turn && cell.armies >= 2) { sel = id; paint(); } return; }
      if (id === sel) { sel = null; paint(); return; }
      if (cell.owner === state.turn && E.canFortify(state, sel, id)) { openMoveModal("fortify", sel, id); return; }
      if (cell.owner === state.turn && cell.armies >= 2) { sel = id; paint(); }
      return;
    }
  }

  function applySnapshot(snap) {
    state = snap;
    // I just conquered → resolve the advance (auto if forced, else the slider)
    if (state.lastConquest && meActing() && moveModal.style.display !== "flex") {
      var c = state.lastConquest;
      if (c.minMove === c.maxMove) sendIntent("advance", { count: c.maxMove });
      else openMoveModal("advance", c.from, c.to);
    }
    paint();
    if (state.winner != null) { clearSession(); checkGameEnd(); }
  }

  function applyEvent(m) {
    if (m.kind === "dice") {
      showDice(m.to, { aRolls: m.aRolls, dRolls: m.dRolls });
      clearTimeout(net._diceT); net._diceT = setTimeout(hideDice, 950);
    }
  }

  function enterOnlineGame(mySeat, mapId) {
    net.online = true; net.mySeat = mySeat;
    var mapDef = (window.RiskMaps && RiskMaps.get(mapId)) || E.CLASSIC_MAP;
    E.installMap(mapDef);                 // set geometry for rendering snapshots
    sel = null; cardSel = []; busy = false;
    svg.setAttribute("viewBox", "0 0 " + mapDef.width + " " + mapDef.height);
    svg.setAttribute("aria-label", "Risk map — " + mapDef.name);
    buildBoard();
    $("winner").style.display = "none";
    setupEl.style.display = "none"; gameEl.style.display = "grid";
    if ($("mapPreviewWrap")) $("mapPreviewWrap").style.display = "none";
    if ($("mapBlurb")) $("mapBlurb").style.display = "none";
  }

  function netStatus(t, cls) {
    var e = $("netStatus"); if (!e) return;
    e.textContent = t;
    e.style.color = cls === "err" ? "var(--ai-err)" : cls === "on" ? "var(--ai-on)" : "var(--muted)";
  }
  function nameVal() { return ((($("netName") && $("netName").value) || "").trim().slice(0, 16)) || "Player"; }

  var NET_URL_KEY = "xeno.risk.neturl";
  // restore the last server address the user actually used (falls back to the
  // hosted default baked into the HTML).
  (function () {
    try {
      var saved = localStorage.getItem(NET_URL_KEY);
      if (saved && $("netUrl")) $("netUrl").value = saved;
    } catch (e) {}
  })();

  function netConnect(then) {
    var url = ((($("netUrl") && $("netUrl").value) || "ws://localhost:8790").trim());
    try { localStorage.setItem(NET_URL_KEY, url); } catch (e) {}
    if (net.conn && net.conn.connected) { then(); return; }
    netStatus("Connecting to " + url + "…");
    net.url = url;
    net.conn = RiskNet.connect(url);
    net.conn.on("@open", function () { netStatus("Connected.", "on"); then(); });
    net.conn.on("@close", function () { onNetClose(); });
    net.conn.on("@error", function () { netStatus("Can't reach " + url + " — is the match-server running? (cd net && node server.js)", "err"); });
    net.conn.on("created", function (m) { net.you = m.you; net.code = m.code; });
    net.conn.on("joined", function (m) { net.you = m.you; net.code = m.code; net.spectator = !!m.spectator; });
    net.conn.on("lobby", onLobby);
    net.conn.on("start", function (m) {
      net.code = m.code; net.reconnectTries = 0;
      if (m.spectator) {
        net.spectator = true; net.token = null;
        enterOnlineGame(-1, m.mapId);
        if ($("specBanner")) $("specBanner").style.display = "block";
        netStatus("Spectating room " + m.code + ".", "on");
        return;
      }
      net.spectator = false; net.token = m.token;
      saveSession();                       // remember enough to rejoin after a drop
      enterOnlineGame(m.mySeat, m.mapId);
      netStatus(m.resumed ? "Reconnected — you're back in the game." : "Game on.", "on");
    });
    net.conn.on("state", function (m) { applySnapshot(m.snapshot); });
    net.conn.on("event", applyEvent);
    net.conn.on("error", function (m) {
      netStatus(m.msg, "err");
      // a failed rejoin (game ended / token expired) → stop retrying, clear stale session
      if (net.reconnecting) { net.reconnecting = false; clearSession(); hideReconnectBar(); }
    });
  }

  // ---- session persistence + reconnection ----
  var SESSION_KEY = "xeno.risk.session";
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ url: net.url, code: net.code, token: net.token, name: nameVal(), ts: Date.now() })); } catch (e) {}
  }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } }
  function hideReconnectBar() { if ($("netReconnectBar")) $("netReconnectBar").style.display = "none"; }

  // socket dropped: if we're mid-game and didn't leave on purpose, auto-reconnect.
  function onNetClose() {
    if (net.leaving || !net.token || !net.online || (state && state.winner != null)) { netStatus("Disconnected from server.", "err"); return; }
    scheduleReconnect();
  }
  function scheduleReconnect() {
    net.reconnecting = true;
    net.reconnectTries = (net.reconnectTries || 0) + 1;
    if (net.reconnectTries > 12) { net.reconnecting = false; netStatus("Lost connection. Use “Reconnect” to try again.", "err"); showReconnectBar(); return; }
    netStatus("Connection lost — reconnecting… (" + net.reconnectTries + ")", "err");
    setTimeout(function () {
      netConnect(function () { net.conn.send({ t: "rejoin", code: net.code, token: net.token }); });
    }, Math.min(1000 * net.reconnectTries, 5000));
  }
  function showReconnectBar() {
    var s = loadSession(); if (!s || !s.token) return;
    if ($("netReconnectCode")) $("netReconnectCode").textContent = s.code;
    if ($("netReconnectBar")) $("netReconnectBar").style.display = "block";
  }
  function doManualReconnect() {
    var s = loadSession(); if (!s || !s.token) { hideReconnectBar(); return; }
    if ($("netUrl") && s.url) $("netUrl").value = s.url;
    net.code = s.code; net.token = s.token; net.reconnectTries = 0; net.reconnecting = true;
    hideReconnectBar();
    netConnect(function () { net.conn.send({ t: "rejoin", code: s.code, token: s.token }); });
  }

  function onLobby(m) {
    net.members = m.members; net.host = (m.hostId === net.you); net.code = m.code;
    if ($("netLobby")) $("netLobby").style.display = "block";
    if ($("netRoomCode")) $("netRoomCode").textContent = m.code;
    var bots = m.bots || [];
    if ($("netMembers")) $("netMembers").innerHTML = m.members.map(function (mm, i) {
      var col = E.PLAYER_COLORS[i] || "#888";
      return '<div class="rrow"><span class="chip" style="color:' + col + ';background:' + col + '"></span><span class="who">' +
        esc(mm.name) + (mm.id === m.hostId ? ' <span style="color:var(--muted)">· host</span>' : '') +
        (mm.id === net.you ? ' <span style="color:var(--accent)">· you</span>' : '') + '</span></div>';
    }).concat(bots.map(function (b, j) {
      var col = E.PLAYER_COLORS[m.members.length + j] || "#888";
      return '<div class="rrow"><span class="chip" style="color:' + col + ';background:' + col + '"></span><span class="who">' +
        (b.emoji ? b.emoji + " " : "") + esc(b.name) + ' <span style="color:var(--muted)">· AI</span></span></div>';
    })).join("");
    var total = m.members.length + bots.length;
    if ($("netConfigLine")) $("netConfigLine").textContent = "Map: " + m.config.mapId + " · Manual draft: " + (m.config.manualSetup ? "on" : "off") +
      " · " + total + "/6 players" + (m.spectators ? " · 👁 " + m.spectators + " watching" : "");
    // host-only AI seat controls
    if ($("netAIRow")) $("netAIRow").style.display = (net.host && !net.spectator) ? "flex" : "none";
    if ($("netAddAI")) $("netAddAI").disabled = total >= 6;
    if ($("netRemoveAI")) $("netRemoveAI").disabled = bots.length === 0;
    // spectators can't start; only the host (a seated member) sees the button
    var canStart = net.host && !net.spectator && total >= 2;
    if ($("netStart")) { $("netStart").style.display = (net.host && !net.spectator) ? "block" : "none"; $("netStart").disabled = !canStart; }
    if ($("netWaiting")) $("netWaiting").style.display = (net.spectator || !net.host) ? "block" : "none";
    if ($("netWaiting")) $("netWaiting").textContent = net.spectator ? "Watching — waiting for the host to start…" : "Waiting for the host to start…";
  }

  function netPass() { return (($("netPassword") && $("netPassword").value) || ""); }
  if ($("netCreate")) $("netCreate").addEventListener("click", function () {
    netConnect(function () { net.conn.send({ t: "create", name: nameVal(), map: $("mapPick").value, manualSetup: !!($("manualSetup") && $("manualSetup").checked), password: netPass() }); });
  });
  if ($("netJoin")) $("netJoin").addEventListener("click", function () {
    var code = ((($("netCode") && $("netCode").value) || "").trim().toUpperCase());
    if (code.length !== 4) { netStatus("Enter the 4-letter room code.", "err"); return; }
    netConnect(function () { net.conn.send({ t: "join", code: code, name: nameVal(), password: netPass() }); });
  });
  if ($("netStart")) $("netStart").addEventListener("click", function () { if (net.conn) net.conn.send({ t: "start" }); });
  if ($("netAddAI")) $("netAddAI").addEventListener("click", function () { if (net.conn) net.conn.send({ t: "addAI" }); });
  if ($("netRemoveAI")) $("netRemoveAI").addEventListener("click", function () { if (net.conn) net.conn.send({ t: "removeAI" }); });
  if ($("netWatch")) $("netWatch").addEventListener("click", function () {
    var code = ((($("netCode") && $("netCode").value) || "").trim().toUpperCase());
    if (code.length !== 4) { netStatus("Enter the 4-letter room code to watch.", "err"); return; }
    netConnect(function () { net.conn.send({ t: "join", code: code, name: nameVal(), password: netPass(), spectate: true }); });
  });
  if ($("netCopy")) $("netCopy").addEventListener("click", function () {
    var code = net.code || ($("netRoomCode") && $("netRoomCode").textContent) || "";
    var done = function () { var b = $("netCopy"); if (!b) return; var o = b.textContent; b.textContent = "✓ copied"; setTimeout(function () { b.textContent = o; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, done); else done();
  });
  if ($("netReconnect")) $("netReconnect").addEventListener("click", doManualReconnect);

  // ===============================================================
  //  Boot
  // ===============================================================
  buildAIPanel();
  clampCounts();
  populateMaps();
  // offer to rejoin a game that was interrupted (e.g. a refresh / crash)
  showReconnectBar();
  if (BYOM && BYOM.isLocal()) { /* models load when the user ticks the box */ }
  // Esc closes the modal (cancel = min advance)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && moveModal.style.display === "flex" && modalCtx) {
      if (net.online) {
        if (modalCtx.kind === "advance") sendIntent("advance", { count: modalCtx.min });
        moveModal.style.display = "none"; modalCtx = null; busy = false; return;
      }
      if (modalCtx.kind === "advance") { E.moveAfterConquest(state, modalCtx.min); var c = modalCtx; moveModal.style.display = "none"; modalCtx = null; busy = false; finishHumanAssault(c.from, c.to); }
    }
  });
})();
