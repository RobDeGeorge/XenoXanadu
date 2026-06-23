/* XenoXanadu — Risk: Global Domination
 * ------------------------------------------------------------------
 * maps.js — the BOARD REGISTRY (global `window.RiskMaps`).
 *
 * engine.js owns the rules and ships one built-in board (CLASSIC_MAP).
 * This file is the catalogue the UI picks from: it registers the classic
 * world plus a handful of hand-designed "fun" boards that are NOT replicas
 * of real continents — small/fast, symmetric arenas, choke-point islands,
 * and a themed star. Each board is a plain data object in the exact shape
 * engine.installMap() expects, so the picker just hands one to newGame.
 *
 * Authoring format: instead of writing each territory's adjacency list by
 * hand (and risking an asymmetric edge), a board is declared as { nodes,
 * edges }. `build()` turns the edge list into symmetric per-territory adj
 * arrays — list each connection once, both directions are created.
 *
 * Runs in the browser (after engine.js) and under Node: `node maps.js`
 * validates every registered board with the engine's own validateMap().
 */
(function (root, factory) {
  var eng = (typeof module === "object" && module.exports)
    ? require("./engine.js")
    : root.RiskEngine;
  var mod = factory(eng);
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.RiskMaps = mod;
})(typeof self !== "undefined" ? self : this, function (RiskEngine) {
  "use strict";

  // ---------------------------------------------------------------
  //  Registry
  // ---------------------------------------------------------------
  var _maps = {}, _order = [];
  function register(def) {
    if (RiskEngine && RiskEngine.validateMap) {
      var problems = RiskEngine.validateMap(def);
      if (problems.length && typeof console !== "undefined") {
        console.warn("RiskMaps: '" + def.id + "' has issues:\n  " + problems.join("\n  "));
      }
    }
    _maps[def.id] = def;
    if (_order.indexOf(def.id) < 0) _order.push(def.id);
    return def;
  }
  function get(id) { return _maps[id]; }
  function list() { return _order.map(function (id) { return _maps[id]; }); }

  // ---------------------------------------------------------------
  //  Builders
  // ---------------------------------------------------------------
  // Polar → screen point (y grows downward; deg 0 = east, -90 = north).
  function P(cx, cy, r, deg) {
    var a = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  // Assemble a board from { nodes:[{id,name,cont,x,y}], edges:[[a,b]...] }.
  // Adjacency is built symmetrically and de-duplicated.
  function build(spec) {
    var territories = {};
    spec.nodes.forEach(function (nd) {
      territories[nd.id] = { name: nd.name, cont: nd.cont, x: Math.round(nd.x), y: Math.round(nd.y), adj: [] };
    });
    spec.edges.forEach(function (e) {
      var a = e[0], b = e[1];
      if (!territories[a] || !territories[b]) throw new Error(spec.id + ": edge to missing node " + a + "–" + b);
      if (territories[a].adj.indexOf(b) < 0) territories[a].adj.push(b);
      if (territories[b].adj.indexOf(a) < 0) territories[b].adj.push(a);
    });
    return {
      id: spec.id, name: spec.name, blurb: spec.blurb,
      width: spec.width, height: spec.height, terrRadius: spec.terrRadius || 36,
      startArmies: spec.startArmies, wrapEdges: spec.wrapEdges || [], labelNudge: spec.labelNudge || {},
      continents: spec.continents, territories: territories,
    };
  }

  // Shift a node set so its bounding box sits at `margin` from the top-left,
  // and report the canvas size it needs. Lets generators work in any coords.
  function normalize(nodes, margin) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    });
    nodes.forEach(function (n) { n.x = n.x - minX + margin; n.y = n.y - minY + margin; });
    return { width: Math.round(maxX - minX + 2 * margin), height: Math.round(maxY - minY + 2 * margin) };
  }

  // The closest pair of nodes between two groups — used to drop a bridge
  // between two landmasses at their nearest coastlines.
  function nearestPair(a, b) {
    var best = null, bd = Infinity;
    a.forEach(function (p) {
      b.forEach(function (q) {
        var d = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
        if (d < bd) { bd = d; best = [p.id, q.id]; }
      });
    });
    return best;
  }

  // ===============================================================
  //  CLASSIC — the built-in world map (defined in engine.js)
  // ===============================================================
  if (RiskEngine && RiskEngine.CLASSIC_MAP) register(RiskEngine.CLASSIC_MAP);

  // ===============================================================
  //  CLASH — small & fast. A 4×4 grid of 16 territories carved into
  //  four 2×2 "realms". Quick 10-minute games; every realm bonus is
  //  contestable because each one borders the whole rest of the board.
  // ===============================================================
  (function () {
    var COLS = [140, 330, 520, 710], ROWS = [130, 280, 430, 580];
    var REALM = [["frost", "ember"], ["moss", "dusk"]]; // [rowBand][colBand]
    var NAMES = [
      ["Tundra", "Glacier", "Cinder", "Magmar"],
      ["Pinehold", "Frostgate", "Emberkeep", "Ashfall"],
      ["Fenmoor", "Mossgate", "Duskgate", "Umbra"],
      ["Thornwood", "Boghaven", "Gloamfen", "Twilight"],
    ];
    var nodes = [], edges = [], idAt = {};
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var id = "cl-" + r + "-" + c;
        idAt[r + "," + c] = id;
        nodes.push({ id: id, name: NAMES[r][c], cont: REALM[r < 2 ? 0 : 1][c < 2 ? 0 : 1], x: COLS[c], y: ROWS[r] });
        if (c > 0) edges.push([idAt[r + "," + (c - 1)], id]); // link left
        if (r > 0) edges.push([idAt[(r - 1) + "," + c], id]); // link up
      }
    }
    register(build({
      id: "clash", name: "Clash", blurb: "16 territories, four realms — a fast, punchy skirmish board.",
      width: 850, height: 700, terrRadius: 33,
      startArmies: { 2: 20, 3: 18, 4: 16, 5: 14, 6: 12 },
      continents: {
        frost: { name: "Frost", bonus: 3, color: "#6f9bd1" },
        ember: { name: "Ember", bonus: 3, color: "#cf8a52" },
        moss:  { name: "Moss",  bonus: 3, color: "#a6c46a" },
        dusk:  { name: "Dusk",  bonus: 3, color: "#a594cc" },
      },
      nodes: nodes, edges: edges,
    }));
  })();

  // ===============================================================
  //  ARENA — symmetric. A 6-spoke wheel: a central Citadel, an inner
  //  ring of courts and an outer ring of marches, 6-fold rotationally
  //  symmetric so no seat starts with a positional edge. The 1-tile
  //  Crown bonus in the middle is the whole game.
  // ===============================================================
  (function () {
    var CX = 380, CY = 380, RIN = 135, ROUT = 285;
    var WEDGES = [
      { key: "ruby",  col: "#cf5a52" }, { key: "amber", col: "#c7a24a" },
      { key: "jade",  col: "#9ec27a" }, { key: "teal",  col: "#5fa8b8" },
      { key: "iris",  col: "#9b86c4" }, { key: "rose",  col: "#c06a9b" },
    ];
    var TITLE = { ruby: "Ruby", amber: "Amber", jade: "Jade", teal: "Teal", iris: "Iris", rose: "Rose" };
    var nodes = [{ id: "citadel", name: "Citadel", cont: "crown", x: CX, y: CY }];
    var edges = [];
    var continents = { crown: { name: "The Crown", bonus: 3, color: "#d4b25c" } };
    WEDGES.forEach(function (w, i) {
      var deg = -90 + i * 60;
      var pin = P(CX, CY, RIN, deg), pout = P(CX, CY, ROUT, deg);
      var inId = w.key + "-court", outId = w.key + "-march";
      nodes.push({ id: inId,  name: TITLE[w.key] + " Court",  cont: w.key, x: pin.x,  y: pin.y });
      nodes.push({ id: outId, name: TITLE[w.key] + " March",  cont: w.key, x: pout.x, y: pout.y });
      continents[w.key] = { name: TITLE[w.key], bonus: 2, color: w.col };
      edges.push(["citadel", inId]); // hub to each court
      edges.push([inId, outId]);     // court to its march (radial spoke)
    });
    // inner & outer rings (each wedge to its clockwise neighbour)
    for (var i = 0; i < WEDGES.length; i++) {
      var a = WEDGES[i].key, b = WEDGES[(i + 1) % WEDGES.length].key;
      edges.push([a + "-court", b + "-court"]);
      edges.push([a + "-march", b + "-march"]);
    }
    register(build({
      id: "arena", name: "The Arena", blurb: "A symmetric 6-spoke wheel — balanced seats, and one Crown to rush.",
      width: 760, height: 760, terrRadius: 36,
      startArmies: { 2: 20, 3: 18, 4: 16, 5: 14, 6: 12 },
      labelNudge: { crown: { y: 338 } },
      continents: continents, nodes: nodes, edges: edges,
    }));
  })();

  // ===============================================================
  //  BRIDGES — choke points. Five islands (four corners + a central
  //  hub) of four territories each, joined only by single bridges, so
  //  borders are narrow and every crossing is a fight. Holding the
  //  central Aurum hub controls movement — high bonus, hard to keep.
  // ===============================================================
  (function () {
    // each island is a diamond: four sub-territories at the corners
    // (ne/se/sw/nw), so each one faces a different neighbour.
    var CORNERS = [["ne", -45], ["se", 45], ["sw", 135], ["nw", 225]];
    var ROLE = { ne: "Spire", se: "Port", sw: "Vale", nw: "Gate" };
    var RISL = 60;
    var ISLES = [
      { key: "vael",  name: "Vael",  cx: 180, cy: 200 },
      { key: "korr",  name: "Korr",  cx: 640, cy: 200 },
      { key: "myr",   name: "Myr",   cx: 640, cy: 520 },
      { key: "zhan",  name: "Zhan",  cx: 180, cy: 520 },
      { key: "aurum", name: "Aurum", cx: 410, cy: 360 },
    ];
    var nodes = [], edges = [], continents = {};
    var ISLE_COL = { vael: "#5fa8b8", korr: "#cf8a52", myr: "#9ec27a", zhan: "#9b86c4", aurum: "#d4b25c" };
    ISLES.forEach(function (isle) {
      continents[isle.key] = { name: isle.name, bonus: isle.key === "aurum" ? 4 : 2, color: ISLE_COL[isle.key] };
      CORNERS.forEach(function (cn) {
        var p = P(isle.cx, isle.cy, RISL, cn[1]);
        nodes.push({ id: isle.key + "-" + cn[0], name: isle.name + " " + ROLE[cn[0]], cont: isle.key, x: p.x, y: p.y });
      });
      // internal ring ne-se-sw-nw-ne
      edges.push([isle.key + "-ne", isle.key + "-se"]);
      edges.push([isle.key + "-se", isle.key + "-sw"]);
      edges.push([isle.key + "-sw", isle.key + "-nw"]);
      edges.push([isle.key + "-nw", isle.key + "-ne"]);
    });
    // bridges: central hub to each corner island (facing corners)
    edges.push(["aurum-nw", "vael-se"]);
    edges.push(["aurum-ne", "korr-sw"]);
    edges.push(["aurum-se", "myr-nw"]);
    edges.push(["aurum-sw", "zhan-ne"]);
    // bridges: ring of corner islands (top, right, bottom, left edges)
    edges.push(["vael-ne", "korr-nw"]);
    edges.push(["korr-se", "myr-ne"]);
    edges.push(["myr-sw", "zhan-se"]);
    edges.push(["zhan-nw", "vael-sw"]);
    register(build({
      id: "bridges", name: "Bridges", blurb: "Five island-realms joined by single spans — defensible borders, brutal crossings.",
      width: 820, height: 700, terrRadius: 32,
      startArmies: { 2: 24, 3: 21, 4: 18, 5: 16, 6: 14 },
      continents: continents, nodes: nodes, edges: edges,
    }));
  })();

  // ===============================================================
  //  STARFALL — themed picture. The board IS a five-pointed star: a
  //  central Nova with five arms (root → reach → star tip). Tips are
  //  dead-ends — easy to hold, slow to break out of. Visual flair over
  //  perfect balance.
  // ===============================================================
  (function () {
    var CX = 380, CY = 380, R = { root: 110, reach: 200, tip: 290 };
    var ARMS = [
      { key: "pyre",  name: "Pyre",  col: "#cf7a52" },
      { key: "frost", name: "Frost", col: "#5fa8b8" },
      { key: "storm", name: "Storm", col: "#d4b25c" },
      { key: "bloom", name: "Bloom", col: "#9ec27a" },
      { key: "void",  name: "Void",  col: "#9b86c4" },
    ];
    var nodes = [{ id: "nova", name: "The Nova", cont: "nova", x: CX, y: CY }];
    var edges = [];
    var continents = { nova: { name: "Nova", bonus: 3, color: "#c06a9b" } };
    ARMS.forEach(function (arm, i) {
      var deg = -90 + i * 72;
      var root = P(CX, CY, R.root, deg), reach = P(CX, CY, R.reach, deg), tip = P(CX, CY, R.tip, deg);
      var rootId = arm.key + "-root", reachId = arm.key + "-reach", tipId = arm.key + "-star";
      nodes.push({ id: rootId,  name: arm.name + " Root",  cont: arm.key, x: root.x,  y: root.y });
      nodes.push({ id: reachId, name: arm.name + " Reach", cont: arm.key, x: reach.x, y: reach.y });
      nodes.push({ id: tipId,   name: arm.name + " Star",  cont: arm.key, x: tip.x,   y: tip.y });
      continents[arm.key] = { name: arm.name, bonus: 2, color: arm.col };
      edges.push(["nova", rootId]);     // core to each arm
      edges.push([rootId, reachId]);    // up the arm
      edges.push([reachId, tipId]);     // to the dead-end tip
    });
    // pentagon: link adjacent arm roots (gives the star its inner body)
    for (var i = 0; i < ARMS.length; i++) {
      edges.push([ARMS[i].key + "-root", ARMS[(i + 1) % ARMS.length].key + "-root"]);
    }
    register(build({
      id: "starfall", name: "Starfall", blurb: "A five-pointed star — five arms off a contested Nova core. Tips are forts.",
      width: 760, height: 760, terrRadius: 33,
      startArmies: { 2: 20, 3: 18, 4: 16, 5: 14, 6: 12 },
      labelNudge: { nova: { y: 338 } },
      continents: continents, nodes: nodes, edges: edges,
    }));
  })();

  // ===============================================================
  //  HEX DOMINION — large & symmetric. A 61-cell hex honeycomb (a
  //  radius-4 hexagon) split into six angular sectors around a single
  //  high-value Core. Dense six-way adjacency means fronts everywhere.
  // ===============================================================
  (function () {
    var N = 4, size = 46, SQRT3 = Math.sqrt(3);
    var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    var SECT = [
      { key: "ember", name: "Ember",   col: "#cf5a52" }, { key: "rose",  name: "Vermil",  col: "#c06a9b" },
      { key: "iris",  name: "Wraith",  col: "#9b86c4" }, { key: "tidal", name: "Tidal",   col: "#5fa8b8" },
      { key: "jade",  name: "Verdant", col: "#9ec27a" }, { key: "amber", name: "Aurelia", col: "#c7a24a" },
    ];
    var continents = { core: { name: "The Core", bonus: 5, color: "#d4b25c" } };
    SECT.forEach(function (s) { continents[s.key] = { name: s.name, bonus: 4, color: s.col }; });
    function sectorOf(x, y, q, r) {
      if (q === 0 && r === 0) return "core";
      var ang = Math.atan2(y, x); if (ang < 0) ang += 2 * Math.PI;
      return SECT[Math.floor(ang / (Math.PI / 3)) % 6].key;
    }
    var cells = [];
    for (var q = -N; q <= N; q++) {
      for (var r = -N; r <= N; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) > N) continue;
        cells.push({ q: q, r: r, x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r });
      }
    }
    var has = {}, counts = {}, nodes = [], edges = [];
    cells.forEach(function (c) {
      c.id = "hx_" + (c.q < 0 ? "m" + -c.q : c.q) + "_" + (c.r < 0 ? "m" + -c.r : c.r);
      c.cont = sectorOf(c.x, c.y, c.q, c.r);
      has[c.q + "," + c.r] = c.id;
      var nm = c.cont === "core" ? "The Core" : (continents[c.cont].name + " " + (counts[c.cont] = (counts[c.cont] || 0) + 1));
      nodes.push({ id: c.id, name: nm, cont: c.cont, x: c.x, y: c.y });
    });
    cells.forEach(function (c) {
      DIRS.forEach(function (d) {
        var nb = has[(c.q + d[0]) + "," + (c.r + d[1])];
        if (nb) edges.push([c.id, nb]); // build() de-dupes the reverse
      });
    });
    var dim = normalize(nodes, 52);
    register(build({
      id: "hexdominion", name: "Hex Dominion", blurb: "61 hexes, six sectors, one Core — a big, dense, every-border-is-a-front war.",
      width: dim.width, height: dim.height, terrRadius: 33,
      startArmies: { 2: 54, 3: 48, 4: 42, 5: 36, 6: 32 },
      labelNudge: { core: { y: dim.height / 2 - 44 } },
      continents: continents, nodes: nodes, edges: edges,
    }));
  })();

  // ===============================================================
  //  REALMS — large with continents & choke points. Six 3×3 provinces
  //  arranged in a ring, each an internal grid, joined to its two
  //  neighbours by a single bridge. 54 territories; big continent
  //  bonuses but long, pinchable borders.
  // ===============================================================
  (function () {
    var PROV = 6, G = 3, CELL = 78, RING = 300, CX = 430, CY = 400;
    var INFO = [
      { name: "Sable",   col: "#cf5a52" }, { name: "Cobalt",  col: "#5fa8b8" },
      { name: "Verda",   col: "#9ec27a" }, { name: "Amberon", col: "#c7a24a" },
      { name: "Violetia",col: "#9b86c4" }, { name: "Rosalin", col: "#c06a9b" },
    ];
    var continents = {}, nodes = [], edges = [], groups = [];
    for (var p = 0; p < PROV; p++) {
      continents["prov" + p] = { name: INFO[p].name, bonus: 5, color: INFO[p].col };
      var center = P(CX, CY, RING, -90 + p * (360 / PROV));
      var at = {}, group = [];
      for (var gy = 0; gy < G; gy++) {
        for (var gx = 0; gx < G; gx++) {
          var id = "rl" + p + "_" + gx + gy;
          var nd = { id: id, name: INFO[p].name + " " + (gy * G + gx + 1), cont: "prov" + p, x: center.x + (gx - 1) * CELL, y: center.y + (gy - 1) * CELL };
          nodes.push(nd); group.push(nd); at[gx + "," + gy] = id;
          if (gx > 0) edges.push([at[(gx - 1) + "," + gy], id]);
          if (gy > 0) edges.push([at[gx + "," + (gy - 1)], id]);
        }
      }
      groups.push(group);
    }
    for (var i = 0; i < PROV; i++) edges.push(nearestPair(groups[i], groups[(i + 1) % PROV])); // ring bridges
    var dim2 = normalize(nodes, 50);
    register(build({
      id: "realms", name: "Realms", blurb: "Six grid-provinces in a ring, joined only by single bridges — 54 territories of pinch-point warfare.",
      width: dim2.width, height: dim2.height, terrRadius: 30,
      startArmies: { 2: 50, 3: 44, 4: 38, 5: 33, 6: 28 },
      continents: continents, nodes: nodes, edges: edges,
    }));
  })();

  // ===============================================================
  //  AETHERIA — a hand-crafted FANTASY continent. Six warring kingdoms
  //  with lore names and organic, irregular borders (not a grid or a
  //  wheel): the icy Frostmark across the north, woodland Thornwood in
  //  the west, the golden high kingdom of Sunspire in the heart, the
  //  burning Emberwastes east, the Shadowfen swamps south, and the
  //  Drowned Isles off the south-east coast. 40 lands.
  // ===============================================================
  (function () {
    var C = {
      frost: { name: "Frostmark",     bonus: 5, color: "#80a8cc" },
      wood:  { name: "Thornwood",     bonus: 5, color: "#6dbf95" },
      sun:   { name: "Sunspire",      bonus: 6, color: "#d4b25c" },
      ember: { name: "Emberwastes",   bonus: 5, color: "#cf8a52" },
      fen:   { name: "Shadowfen",     bonus: 4, color: "#a594cc" },
      isle:  { name: "Drowned Isles", bonus: 3, color: "#5fa8b8" },
    };
    var nodes = [
      // Frostmark — northern ice
      { id: "fr1", name: "Hoarfrost",   cont: "frost", x: 150, y: 95 },
      { id: "fr2", name: "Rimegate",    cont: "frost", x: 305, y: 80 },
      { id: "fr3", name: "Pale Reach",  cont: "frost", x: 460, y: 92 },
      { id: "fr4", name: "Wintermoot",  cont: "frost", x: 615, y: 80 },
      { id: "fr5", name: "Glacius",     cont: "frost", x: 770, y: 100 },
      { id: "fr6", name: "Frostspire",  cont: "frost", x: 905, y: 140 },
      { id: "fr7", name: "Iceveil",     cont: "frost", x: 690, y: 165 },
      // Thornwood — western forest
      { id: "wd1", name: "Greenmarch",  cont: "wood",  x: 110, y: 220 },
      { id: "wd2", name: "Oakenhold",   cont: "wood",  x: 215, y: 300 },
      { id: "wd3", name: "Tanglewood",  cont: "wood",  x: 110, y: 395 },
      { id: "wd4", name: "Briar Hollow",cont: "wood",  x: 220, y: 480 },
      { id: "wd5", name: "Elderoak",    cont: "wood",  x: 120, y: 575 },
      { id: "wd6", name: "Mossgarde",   cont: "wood",  x: 225, y: 638 },
      { id: "wd7", name: "Thorngate",   cont: "wood",  x: 320, y: 410 },
      // Sunspire — central high kingdom
      { id: "sn1", name: "Sunspire",    cont: "sun",   x: 530, y: 305 },
      { id: "sn2", name: "Goldhaven",   cont: "sun",   x: 435, y: 375 },
      { id: "sn3", name: "Kingsroad",   cont: "sun",   x: 565, y: 405 },
      { id: "sn4", name: "Dawnfield",   cont: "sun",   x: 470, y: 470 },
      { id: "sn5", name: "Highgarden",  cont: "sun",   x: 635, y: 330 },
      { id: "sn6", name: "Rivermeet",   cont: "sun",   x: 520, y: 210 },
      { id: "sn7", name: "Embercourt",  cont: "sun",   x: 628, y: 478 },
      // Emberwastes — eastern volcanic
      { id: "em1", name: "Cinderhold",  cont: "ember", x: 850, y: 280 },
      { id: "em2", name: "Ashmoor",     cont: "ember", x: 930, y: 300 },
      { id: "em3", name: "Smoulder",    cont: "ember", x: 805, y: 360 },
      { id: "em4", name: "Magmar",      cont: "ember", x: 915, y: 440 },
      { id: "em5", name: "Emberfall",   cont: "ember", x: 800, y: 510 },
      { id: "em6", name: "Pyrewatch",   cont: "ember", x: 920, y: 555 },
      { id: "em7", name: "Scoria",      cont: "ember", x: 730, y: 290 },
      // Shadowfen — southern swamp
      { id: "sf1", name: "Mirefen",     cont: "fen",   x: 360, y: 575 },
      { id: "sf2", name: "Black Marsh", cont: "fen",   x: 470, y: 635 },
      { id: "sf3", name: "Gloomwater",  cont: "fen",   x: 585, y: 600 },
      { id: "sf4", name: "Witchmoor",   cont: "fen",   x: 670, y: 665 },
      { id: "sf5", name: "Sablebog",    cont: "fen",   x: 415, y: 700 },
      { id: "sf6", name: "Quagmire",    cont: "fen",   x: 545, y: 695 },
      { id: "sf7", name: "Bog Haven",   cont: "fen",   x: 320, y: 660 },
      // Drowned Isles — south-east sea
      { id: "is1", name: "Saltspire",   cont: "isle",  x: 805, y: 680 },
      { id: "is2", name: "Tidewreck",   cont: "isle",  x: 905, y: 725 },
      { id: "is3", name: "Maelstrom",   cont: "isle",  x: 1000, y: 690 },
      { id: "is4", name: "Coral Throne",cont: "isle",  x: 915, y: 645 },
      { id: "is5", name: "Stormcove",   cont: "isle",  x: 1000, y: 600 },
    ];
    var edges = [
      // Frostmark
      ["fr1", "fr2"], ["fr2", "fr3"], ["fr3", "fr4"], ["fr4", "fr5"], ["fr5", "fr6"], ["fr3", "fr7"], ["fr4", "fr7"], ["fr5", "fr7"],
      // Thornwood
      ["wd1", "wd2"], ["wd2", "wd3"], ["wd3", "wd4"], ["wd4", "wd5"], ["wd5", "wd6"], ["wd1", "wd3"], ["wd2", "wd7"], ["wd3", "wd7"], ["wd4", "wd7"], ["wd4", "wd6"],
      // Sunspire
      ["sn1", "sn2"], ["sn1", "sn3"], ["sn1", "sn5"], ["sn1", "sn6"], ["sn2", "sn3"], ["sn2", "sn4"], ["sn3", "sn4"], ["sn3", "sn5"], ["sn3", "sn7"], ["sn4", "sn7"], ["sn5", "sn7"],
      // Emberwastes
      ["em1", "em2"], ["em1", "em3"], ["em2", "em3"], ["em3", "em4"], ["em2", "em4"], ["em4", "em5"], ["em4", "em6"], ["em5", "em6"], ["em3", "em5"], ["em1", "em7"], ["em3", "em7"],
      // Shadowfen
      ["sf1", "sf2"], ["sf2", "sf3"], ["sf3", "sf4"], ["sf1", "sf5"], ["sf2", "sf5"], ["sf2", "sf6"], ["sf3", "sf6"], ["sf5", "sf6"], ["sf1", "sf7"], ["sf5", "sf7"],
      // Drowned Isles
      ["is1", "is2"], ["is2", "is3"], ["is3", "is4"], ["is1", "is4"], ["is2", "is4"], ["is3", "is5"], ["is4", "is5"],
      // cross-kingdom borders (render as dashed sea routes)
      ["fr1", "wd1"], ["fr3", "sn6"], ["fr4", "sn6"], ["fr7", "sn5"], ["fr5", "em1"], ["fr6", "em1"], ["fr7", "em7"],
      ["wd7", "sn2"], ["wd6", "sf7"], ["wd6", "sf1"], ["sn4", "sf2"], ["sn7", "sf3"], ["sn5", "em7"],
      ["em5", "sf4"], ["sf4", "is1"], ["em6", "is4"], ["em5", "is1"],
    ];
    register(build({
      id: "aetheria", name: "Aetheria",
      blurb: "A fantasy continent — six warring kingdoms from the icy Frostmark to the burning Emberwastes, with the Drowned Isles off the coast. 40 lands.",
      width: 1055, height: 790, terrRadius: 34,
      startArmies: { 2: 42, 3: 37, 4: 32, 5: 28, 6: 24 },
      continents: C, nodes: nodes, edges: edges,
    }));
  })();

  // ===============================================================
  //  ORBITS — concentric. A central Sun ringed by three orbital bands
  //  (inner reach → middle span → outer verge). The CONTINENTS are the
  //  rings themselves, so the regions form concentric coloured bands:
  //  the Sun is a lone high-ground hub, the Outer Verge a brutal 12-tile
  //  perimeter. You fight inward to the core or outward for the big bonus.
  // ===============================================================
  (function () {
    var CX = 410, CY = 410;
    var RINGS = [
      { key: "inner",  name: "Inner Reach", r: 120, n: 6,  bonus: 4, col: "#9ec27a" },
      { key: "middle", name: "Middle Span", r: 245, n: 10, bonus: 6, col: "#5fa8b8" },
      { key: "outer",  name: "Outer Verge", r: 365, n: 12, bonus: 8, col: "#c06a9b" },
    ];
    var continents = { core: { name: "Solar Core", bonus: 3, color: "#d4b25c" } };
    var nodes = [{ id: "sun", name: "The Sun", cont: "core", x: CX, y: CY }];
    var edges = [];
    var ringIds = []; // per ring: ordered [{id, deg}] for radial spoke wiring
    RINGS.forEach(function (ring) {
      continents[ring.key] = { name: ring.name, bonus: ring.bonus, color: ring.col };
      var ids = [];
      for (var i = 0; i < ring.n; i++) {
        var deg = -90 + i * (360 / ring.n);
        var p = P(CX, CY, ring.r, deg), id = ring.key + "-" + i;
        nodes.push({ id: id, name: ring.name + " " + (i + 1), cont: ring.key, x: p.x, y: p.y });
        ids.push({ id: id, deg: deg });
        if (i > 0) edges.push([ids[i - 1].id, id]);
      }
      edges.push([ids[ring.n - 1].id, ids[0].id]); // close the ring loop
      ringIds.push(ids);
    });
    // angularly-nearest node of a ring to a given bearing
    function nearestId(list, deg) {
      var best = list[0].id, bd = 1e9;
      for (var i = 0; i < list.length; i++) {
        var diff = (((list[i].deg - deg) % 360) + 360) % 360;
        var ad = Math.min(diff, 360 - diff);
        if (ad < bd) { bd = ad; best = list[i].id; }
      }
      return best;
    }
    ringIds[0].forEach(function (n) { edges.push(["sun", n.id]); });                 // Sun → inner hub
    ringIds[0].forEach(function (n) { edges.push([n.id, nearestId(ringIds[1], n.deg)]); }); // inner → middle
    ringIds[1].forEach(function (n) { edges.push([n.id, nearestId(ringIds[2], n.deg)]); }); // middle → outer
    // Every ring's centroid is the board centre, so the continent labels would
    // pile up in the middle. Drop each band's label into the open gap between
    // its first two nodes (and the core's just above the Sun).
    var labelNudge = { core: { x: CX, y: CY - 60 } };
    RINGS.forEach(function (ring) {
      var p = P(CX, CY, ring.r, -90 + 180 / ring.n);
      labelNudge[ring.key] = { x: Math.round(p.x), y: Math.round(p.y) };
    });
    register(build({
      id: "orbits", name: "Orbits",
      blurb: "A central Sun ringed by three orbital bands — concentric continents, with a lone core hub and a brutal outer perimeter.",
      width: 820, height: 820, terrRadius: 30,
      startArmies: { 2: 32, 3: 28, 4: 24, 5: 20, 6: 17 },
      labelNudge: labelNudge,
      continents: continents, nodes: nodes, edges: edges,
    }));
  })();

  // ---------------------------------------------------------------
  //  Public surface
  // ---------------------------------------------------------------
  var api = { register: register, get: get, list: list, build: build };

  // `node maps.js` — validate every registered board.
  if (typeof module === "object" && module.exports && require.main === module) {
    var bad = 0;
    list().forEach(function (m) {
      var problems = RiskEngine.validateMap(m);
      if (problems.length) {
        bad++;
        console.error("✗ " + m.id + ":\n  " + problems.join("\n  "));
      } else {
        var nt = Object.keys(m.territories).length, nc = Object.keys(m.continents).length;
        console.log("✓ " + m.id.padEnd(9) + " " + nt + " territories, " + nc + " continents — " + m.name);
      }
    });
    if (bad) { console.error("\n" + bad + " board(s) failed validation."); process.exit(1); }
    console.log("\nAll " + list().length + " boards valid.");
  }

  return api;
});
