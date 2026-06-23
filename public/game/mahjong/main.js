/* ============================================================================
 *  XenoXanadu — Mahjong Solitaire — board + solver + BYOM narration
 *  ----------------------------------------------------------------------------
 *  Classic tile-matching solitaire on the "turtle" layout (144 tiles). A tile is
 *  FREE when nothing is stacked on top of it AND at least one of its left/right
 *  long edges is open; you remove identical tiles in PAIRS (flowers match any
 *  flower, seasons match any season). Clear the board to win.
 *
 *  Two things make this trustworthy and always-fair:
 *    • Every layout is GENERATED SOLVABLE. We don't sprinkle tiles randomly; we
 *      lay the (empty) layout, then repeatedly take a pair of currently-free
 *      slots and assign them a matching tile-type — recording that as the
 *      solution. A board built by *undoing* a clear is, by construction, clearable.
 *    • A built-in SOLVER does the real reasoning, fully offline: it finds the next
 *      safe pair to remove, detects a stuck board (no free matching pair), and
 *      rates difficulty. The Hint button uses it.
 *
 *  A connected local model (via the shared BYOM pipeline) is a pure ENHANCEMENT:
 *  it NEVER chooses tiles. The solver picks the pair; the model only narrates the
 *  deduction in plain English, streamed to a panel — the same "engine decides,
 *  model narrates" contract minesweeper uses.
 * ========================================================================== */
(function () {
  'use strict';
  var BYOM = window.XenoBYOM;
  var $ = function (id) { return document.getElementById(id); };

  /* ============================ TILE SET ============================
   * 144 tiles: suits (dots/bamboo/characters) 1-9 ×4, winds ×4, dragons ×4,
   * flowers ×1, seasons ×1. matchKey() decides what matches: flowers all match
   * each other, seasons all match each other, everything else matches exact. */
  var GLYPH = {
    // characters (wan) 1-9
    c1:'🀇',c2:'🀈',c3:'🀉',c4:'🀊',c5:'🀋',c6:'🀌',c7:'🀍',c8:'🀎',c9:'🀏',
    // bamboo (sou) 1-9
    b1:'🀐',b2:'🀑',b3:'🀒',b4:'🀓',b5:'🀔',b6:'🀕',b7:'🀖',b8:'🀗',b9:'🀘',
    // dots (pin/circles) 1-9
    d1:'🀙',d2:'🀚',d3:'🀛',d4:'🀜',d5:'🀝',d6:'🀞',d7:'🀟',d8:'🀠',d9:'🀡',
    // winds E S W N
    we:'🀀',ws:'🀁',ww:'🀂',wn:'🀃',
    // dragons red green white
    dr:'🀄',dg:'🀅',dw:'🀆',
    // flowers
    f1:'🀢',f2:'🀣',f3:'🀤',f4:'🀥',
    // seasons
    s1:'🀦',s2:'🀧',s3:'🀨',s4:'🀩'
  };
  // Build the bag of 144 tile types (each appears the right number of times).
  function buildBag() {
    var bag = [];
    var suits = ['c','b','d'];
    suits.forEach(function (s) { for (var n = 1; n <= 9; n++) for (var k = 0; k < 4; k++) bag.push(s + n); });
    ['we','ws','ww','wn','dr','dg','dw'].forEach(function (t) { for (var k = 0; k < 4; k++) bag.push(t); });
    ['f1','f2','f3','f4'].forEach(function (t) { bag.push(t); });   // flowers: one each
    ['s1','s2','s3','s4'].forEach(function (t) { bag.push(t); });   // seasons: one each
    return bag;   // length 36*3 + 28 + 4 + 4 = 144
  }
  // What "group" a type matches by: flowers all share, seasons all share, rest exact.
  function matchKey(t) {
    if (t.charAt(0) === 'f') return 'FLOWER';
    if (t.charAt(0) === 's') return 'SEASON';
    return t;
  }
  function tileLabel(t) {
    var names = { we:'East Wind', ws:'South Wind', ww:'West Wind', wn:'North Wind',
      dr:'Red Dragon', dg:'Green Dragon', dw:'White Dragon' };
    if (names[t]) return names[t];
    if (t.charAt(0) === 'f') return 'Flower';
    if (t.charAt(0) === 's') return 'Season';
    var suit = { c:'Characters', b:'Bamboo', d:'Dots' }[t.charAt(0)];
    return t.charAt(1) + ' of ' + suit;
  }

  /* ============================ TURTLE LAYOUT ============================
   * Slot coordinates use a HALF-CELL grid: x,y are in half-tile units, so a tile
   * occupies a 2×2 footprint (x..x+1, y..y+1). Layer is the stacking height
   * (0 = table). This is the classic "turtle"/"dragon" shape, 144 slots.
   * Built procedurally row-by-row to keep it readable & exactly 144. */
  function buildTurtle() {
    var slots = [];
    var add = function (layer, x, y) { slots.push({ layer: layer, x: x * 2, y: y }); };
    // ---- Layer 0 (base): 87 tiles — eight horizontal rows + 3 side "ears" ----
    // row(yHalfUnits, firstTileCol, lastTileCol); cols are converted to half-units.
    var row = function (y, xs, xe) { for (var x = xs; x <= xe; x++) add(0, x, y); };
    row(0, 1, 12);    // 12
    row(2, 3, 10);    //  8
    row(4, 2, 11);    // 10
    row(6, 1, 12);    // 12
    row(8, 1, 12);    // 12
    row(10, 2, 11);   // 10
    row(12, 3, 10);   //  8
    row(14, 1, 12);   // 12   (= 84 so far)
    add(0, 0, 7); add(0, 13, 7); add(0, 15, 7);   // 3 ears → 87 base
    // ---- Layer 1: centred 6×6 block (36) ----
    for (var ry = 2; ry <= 12; ry += 2) for (var rx = 4; rx <= 9; rx++) add(1, rx, ry);
    // ---- Layer 2: centred 4×4 block (16) ----
    for (var ry2 = 4; ry2 <= 10; ry2 += 2) for (var rx2 = 5; rx2 <= 8; rx2++) add(2, rx2, ry2);
    // ---- Layer 3: centred 2×2 block (4) ----
    for (var ry3 = 6; ry3 <= 8; ry3 += 2) for (var rx3 = 6; rx3 <= 7; rx3++) add(3, rx3, ry3);
    // ---- Layer 4: single cap (1) → 87+36+16+4+1 = 144 ----
    add(4, 6.5, 7);
    return slots;
  }

  /* ============================ GEOMETRY HELPERS ============================ */
  // Two slots overlap in the X/Y plane if their 2×2 footprints intersect.
  function planeOverlap(a, b) {
    return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
  }
  // Same horizontal band (so left/right adjacency is meaningful).
  function sameBand(a, b) { return a.layer === b.layer && Math.abs(a.y - b.y) < 2; }

  // Precompute, for each slot: which slots sit directly on top, and which are
  // immediate left / right neighbours on the same layer. Index by slot id.
  function indexLayout(slots) {
    slots.forEach(function (s, i) { s.id = i; s.tile = null; s.removed = false; });
    slots.forEach(function (s) {
      s.above = []; s.left = []; s.right = [];
      slots.forEach(function (o) {
        if (o === s) return;
        if (o.layer === s.layer + 1 && planeOverlap(s, o)) s.above.push(o.id);
        if (sameBand(s, o)) {
          if (o.x === s.x - 2) s.left.push(o.id);
          else if (o.x === s.x + 2) s.right.push(o.id);
        }
      });
    });
    return slots;
  }

  // A live (non-removed) slot is FREE when nothing live sits on top AND at least
  // one of its left / right edges has no live neighbour.
  function isFree(slots, s) {
    if (s.removed) return false;
    for (var i = 0; i < s.above.length; i++) if (!slots[s.above[i]].removed) return false;
    var leftBlocked = s.left.some(function (id) { return !slots[id].removed; });
    var rightBlocked = s.right.some(function (id) { return !slots[id].removed; });
    return !(leftBlocked && rightBlocked);
  }
  function freeSlots(slots) { return slots.filter(function (s) { return !s.removed && isFree(slots, s); }); }

  /* ============================ SOLVABLE DEAL ============================
   * Lay the layout's solution down in removable pairs. Working on a copy where
   * every slot is "removed", we repeatedly: un-remove two slots that are free in
   * the *partially rebuilt* board and give them a matching tile-type drawn from
   * the bag. Rebuilding from the empty board upward guarantees the finished board
   * can be cleared by reversing the construction. Falls back to a retry if the
   * bag pairing ever dead-ends (rare). */
  function dealSolvable(slots) {
    var n = slots.length;
    for (var attempt = 0; attempt < 60; attempt++) {
      // reset
      slots.forEach(function (s) { s.tile = null; s.placed = false; });
      // bag of matchKeys → we need pairs that match; pre-pair the bag by matchKey.
      var bag = buildBag();
      // group identical-matchKey tiles into matchable pairs
      var byKey = {};
      bag.forEach(function (t) { (byKey[matchKey(t)] = byKey[matchKey(t)] || []).push(t); });
      var pairs = [];   // each: [typeA, typeB] that legitimately match
      Object.keys(byKey).forEach(function (k) {
        var arr = byKey[k];
        shuffle(arr);
        for (var i = 0; i + 1 < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
      });
      shuffle(pairs);
      var solution = [];   // ordered list of [idA,idB] = construction order

      // helper: among un-placed slots, which are "free to place" — i.e. would be
      // free if the not-yet-placed slots above/beside were absent. Since we build
      // bottom-up, a slot is placeable when every slot ABOVE it is still unplaced
      // (so it ends up underneath) … but the cleanest correctness comes from
      // building the *clear order* directly: place into slots that are FREE in the
      // current (placed-so-far treated as present) board, processed as removals.
      // We instead simulate the CLEAR: start full board with all slots "present
      // but untyped"; pick free pairs and assign matching types, marking them done.
      slots.forEach(function (s) { s.placed = false; });
      var done = 0;
      var ok = true;
      while (done < n) {
        // free = not-yet-done slots that are free treating done slots as removed
        var free = slots.filter(function (s) {
          if (s.placed) return false;
          // above must be all placed (cleared first) to be free now
          for (var i = 0; i < s.above.length; i++) if (!slots[s.above[i]].placed) return false;
          var leftBlk = s.left.some(function (id) { return !slots[id].placed; });
          var rightBlk = s.right.some(function (id) { return !slots[id].placed; });
          return !(leftBlk && rightBlk);
        });
        if (free.length < 2) { ok = false; break; }
        // pick two free slots and the next pair of matching types
        if (!pairs.length) { ok = false; break; }
        shuffle(free);
        var a = free[0], b = free[1];
        var pr = pairs.pop();
        a.tile = pr[0]; b.tile = pr[1];
        a.placed = b.placed = true;
        solution.push([a.id, b.id]);
        done += 2;
      }
      if (ok && done === n) {
        // reverse construction → the clear order is solution reversed
        var clearOrder = solution.slice().reverse();
        slots.forEach(function (s) { s.removed = false; });
        return { ok: true, solution: clearOrder };
      }
    }
    return { ok: false };
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ============================ SOLVER ============================
   * The honest engine, used to (a) find a SAFE next pair for a hint, (b) detect
   * stuck (no free matching pair at all), (c) rate difficulty.
   *
   * Full game-tree proof of mahjong-solitaire solvability is exponential, so we
   * use a fast RANDOMISED GREEDY oracle instead: try to clear the current board
   * many times, each time removing a free matching pair chosen with a sensible
   * heuristic plus a little randomness. If any run empties the board, the board
   * is solvable (a found clear is a real proof). Runs are cheap (one linear sweep
   * per removal), so we can afford hundreds. It can occasionally fail to find a
   * line that exists (a false "couldn't verify"), which we report honestly rather
   * than as a hard "unsolvable". */

  // All free matching pairs right now (ignoring whether they keep the board solvable).
  function freeMatchingPairs(slots) {
    var free = freeSlots(slots), out = [];
    for (var i = 0; i < free.length; i++) for (var j = i + 1; j < free.length; j++) {
      if (matchKey(free[i].tile) === matchKey(free[j].tile)) out.push([free[i], free[j]]);
    }
    return out;
  }

  // Snapshot just the removed-flags so we can try lines and roll back.
  function snapshot(slots) { return slots.map(function (s) { return s.removed; }); }
  function restore(slots, snap) { for (var i = 0; i < slots.length; i++) slots[i].removed = snap[i]; }

  // One greedy attempt to clear from the CURRENT removed-state. `greedy` true =
  // deterministic best-first (prefer removing whole quartets / safe pairs);
  // false = add randomness for variety across restarts. Returns the ordered list
  // of removed [idA,idB] pairs if it fully clears, else null. Mutates+restores.
  function greedyClear(slots, greedy) {
    var snap = snapshot(slots);
    var seq = [];
    var safe = true;
    while (true) {
      var remaining = 0;
      for (var i = 0; i < slots.length; i++) if (!slots[i].removed) remaining++;
      if (remaining === 0) break;
      var pairs = freeMatchingPairs(slots);
      if (!pairs.length) { safe = false; break; }
      var pick;
      if (greedy) {
        // heuristic score: prefer pairs whose matchKey has all 4 free now (clears a
        // full group, never strands a partner), then ones touching higher layers.
        var byKey = {};
        freeSlots(slots).forEach(function (s) { var k = matchKey(s.tile); byKey[k] = (byKey[k] || 0) + 1; });
        pick = pairs.slice().sort(function (p, q) {
          var pk = byKey[matchKey(p[0].tile)] || 0, qk = byKey[matchKey(q[0].tile)] || 0;
          var pq = (pk >= 4 ? 1 : 0) - (qk >= 4 ? 1 : 0);
          if (pq) return -pq;
          return (q[0].layer + q[1].layer) - (p[0].layer + p[1].layer);
        })[0];
      } else {
        pick = pairs[Math.floor(Math.random() * pairs.length)];
      }
      pick[0].removed = pick[1].removed = true;
      seq.push([pick[0].id, pick[1].id]);
    }
    restore(slots, snap);
    return safe ? seq : null;
  }

  // Can the CURRENT board be cleared? Try the greedy line once, then a budget of
  // randomised restarts. Returns { solvable, firstPair, restarts }. `firstPair`
  // is the first move on a found winning line (handy for hints).
  function searchSolvable(slots, budget) {
    budget = budget || { tries: 0, cap: 300 };
    var seq = greedyClear(slots, true);
    if (seq) return { solvable: true, firstPair: seq[0] || null, restarts: 0 };
    while (budget.tries++ < budget.cap) {
      seq = greedyClear(slots, false);
      if (seq) return { solvable: true, firstPair: seq[0] || null, restarts: budget.tries };
    }
    // couldn't find a clearing line within budget — report as "unverified",
    // not a hard unsolvable (the greedy oracle is incomplete).
    return { solvable: false, firstPair: null, timedOut: true, restarts: budget.tries };
  }

  /* ============================ GAME STATE ============================ */
  var slots = [];          // current layout (indexLayout'd)
  var diff = 'medium';
  var selected = null;     // currently selected slot
  var history = [];        // stack of removed pairs for undo: [{a,b}]
  var initialSnapshot = null;   // tiles+positions for Restart
  var over = false, won = false;
  var gen = 0;             // bumps on new game to cancel async loops
  var TW = 46, TH = 62;    // tile pixel size (set responsively)

  // ---- DOM ----
  var boardEl = $('board'), assistMsg = $('assistMsg'), banner = $('banner'),
      tilesLeftEl = $('tilesLeft'), movesLeftEl = $('movesLeft'), difficultyEl = $('difficulty'),
      hintBtn = $('hintBtn'), shuffleBtn = $('shuffleBtn'), undoBtn = $('undoBtn'), restartBtn = $('restartBtn'),
      modelSel = $('modelSel'), endpointEl = $('endpoint'), explainChk = $('explainChk'), thinkEl = $('aiThink');

  // ---- AI state ----
  var defaultModel = '', modelReady = false, aiController = null;
  function endpoint() { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); }
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var aiUsable = function () { return BYOM.isLocal() && modelReady && defaultModel; };

  /* ============================ NEW GAME ============================ */
  function newGame() {
    gen++;
    if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; }
    selected = null; history = []; over = false; won = false;
    banner.textContent = ''; banner.className = 'winner-banner';

    // Deal a solvable board, biased toward the chosen difficulty: we deal a few
    // candidates and keep the first whose solver-rated tier matches (or the
    // closest), so "Easy/Medium/Hard" actually feels different. All are solvable.
    var want = { easy: 1, medium: 2, hard: 3 }[diff] || 2;
    var best = null, bestGap = 99;
    for (var attempt = 0; attempt < 12; attempt++) {
      slots = indexLayout(buildTurtle());
      var res = dealSolvable(slots);
      if (!res.ok) continue;
      var tier = boardTier();
      var gap = Math.abs(tier - want);
      var snapTiles = slots.map(function (s) { return s.tile; });
      if (gap < bestGap) { bestGap = gap; best = snapTiles; }
      if (gap === 0) break;
    }
    if (!best) { slots = indexLayout(buildTurtle()); dealSolvable(slots); best = slots.map(function (s) { return s.tile; }); }
    slots.forEach(function (s, i) { s.removed = false; s.tile = best[i]; });
    // record the initial deal for Restart (id → tile)
    initialSnapshot = slots.map(function (s) { return s.tile; });

    layoutBoard();
    render();
    rateDifficulty();
    setMsg('Click a free tile, then its twin. Flowers match any flower; seasons match any season.', '');
  }

  // Restart: same tiles, same positions, all back on the board.
  function restart() {
    if (!initialSnapshot) return;
    gen++;
    if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; }
    selected = null; history = []; over = false; won = false;
    banner.textContent = ''; banner.className = 'winner-banner';
    slots.forEach(function (s, i) { s.removed = false; s.tile = initialSnapshot[i]; });
    render(); rateDifficulty();
    setMsg('Layout reset. Same tiles, fresh start.', '');
  }

  /* ============================ RENDER ============================ */
  // Which suit-tint class the stylesheet wants for a tile type.
  function suitClass(t) {
    var c = t.charAt(0);
    if (c === 'c') return 'suit-char';
    if (c === 'b') return 'suit-bamboo';
    if (c === 'd') return 'suit-circle';
    if (c === 'f') return 'suit-flower';
    if (c === 's') return 'suit-season';
    if (t === 'we' || t === 'ws' || t === 'ww' || t === 'wn') return 'suit-wind';
    return 'suit-dragon';   // dr/dg/dw
  }

  // Compute board pixel size & responsive tile size, then place tiles. We drive
  // the stylesheet's --tw/--th (face size) and --dx/--dy (per-layer 3-D offset)
  // from JS so the board scales smoothly to the viewport.
  function layoutBoard() {
    var maxX = 0, maxY = 0, minX = 999, maxLayer = 0;
    slots.forEach(function (s) {
      if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y; if (s.layer > maxLayer) maxLayer = s.layer;
    });
    var avail = Math.min(window.innerWidth - 40, 980);
    var cols = (maxX - minX) / 2 + 2;     // tile columns (each tile spans 2 half-units)
    TW = Math.max(24, Math.min(50, Math.floor(avail / (cols + 1))));
    TH = Math.round(TW * 1.36);
    var dx = Math.max(3, Math.round(TW * 0.13));   // 3-D extrusion / per-layer stack offset
    var dy = Math.max(3, Math.round(TW * 0.15));
    boardEl.style.setProperty('--tw', TW + 'px');
    boardEl.style.setProperty('--th', TH + 'px');
    boardEl.style.setProperty('--dx', dx + 'px');
    boardEl.style.setProperty('--dy', dy + 'px');
    // overall board box (pad for the extrusion + layer stacking). Upper layers
    // shift UP by layer*dy, so reserve that headroom at the top via _dyTop.
    var pad = 10;
    var bw = (maxX - minX) / 2 * TW + TW + maxLayer * dx + dx + pad * 2;
    var bh = maxY / 2 * TH + TH + maxLayer * dy + dy + pad * 2;
    boardEl.style.width = Math.round(bw) + 'px';
    boardEl.style.height = Math.round(bh) + 'px';
    boardEl._minX = minX; boardEl._dx = dx; boardEl._dy = dy; boardEl._pad = pad;
    boardEl._dyTop = maxLayer * dy;   // push everything down so the top cap doesn't clip
  }

  function render() {
    var minX = boardEl._minX, dx = boardEl._dx, dy = boardEl._dy, pad = boardEl._pad;
    boardEl.innerHTML = '';
    // draw bottom layers first so upper layers overlap correctly
    var order = slots.slice().filter(function (s) { return !s.removed; });
    order.sort(function (a, b) { return a.layer - b.layer || a.y - b.y || a.x - b.x; });
    var frag = document.createDocumentFragment();
    order.forEach(function (s) {
      var el = document.createElement('div');
      var free = isFree(slots, s);
      var cls = 'tile ' + suitClass(s.tile) + (free ? ' free' : ' blocked');
      if (selected && selected.id === s.id) cls += ' selected';
      el.className = cls;
      el.dataset.id = s.id;
      // upper layers shift up-left by (dx,dy) per layer to read as a stack
      var px = pad + (s.x - minX) / 2 * TW + s.layer * dx;
      var py = pad + s.y / 2 * TH - s.layer * dy + (boardEl._dyTop || 0);
      el.style.left = px + 'px';
      el.style.top = py + 'px';
      el.style.zIndex = String(s.layer * 1000 + s.y * 10 + s.x + 50);
      el.innerHTML = '<span class="glyph">' + GLYPH[s.tile] + '</span>';
      frag.appendChild(el);
    });
    boardEl.appendChild(frag);
    renderHud();
  }

  function renderHud() {
    var left = slots.filter(function (s) { return !s.removed; }).length;
    tilesLeftEl.textContent = left;
    var moves = countDistinctMoves();
    movesLeftEl.textContent = moves;
  }
  // count how many *distinct* matchable groups currently have a free pair
  function countDistinctMoves() {
    var pairs = freeMatchingPairs(slots), keys = {};
    pairs.forEach(function (p) { keys[matchKey(p[0].tile)] = true; });
    return Object.keys(keys).length;
  }

  /* ============================ DIFFICULTY ============================
   * Rate the current board: how easily the greedy oracle clears it (0 restarts =
   * a naive greedy line works → breezy; many restarts → you must play carefully),
   * tempered by how many matchable groups are open right now. Cheap & honest. */
  // Solver-derived tier for the CURRENT board: 1 breezy / 2 fair / 3 tricky,
  // plus the supporting numbers. Restores the board before returning.
  function boardStats() {
    var snap = snapshot(slots);
    var budget = { tries: 0, cap: 300 };
    var r = searchSolvable(slots, budget);
    restore(slots, snap);
    var moves = countDistinctMoves();
    var restarts = r.restarts || 0;
    var tier;
    if (r.timedOut) tier = 3;
    else if (restarts === 0 && moves >= 5) tier = 1;
    else if (restarts <= 8) tier = 2;
    else tier = 3;
    return { tier: tier, restarts: restarts, moves: moves, timedOut: r.timedOut };
  }
  function boardTier() { return boardStats().tier; }

  function rateDifficulty() {
    var st = boardStats();
    var stars = ['', '★', '★★', '★★★'][st.tier];
    var label = ['', 'breezy', 'fair', 'tricky'][st.tier];
    difficultyEl.textContent = stars + ' ' + label;
    difficultyEl.title = "Solver's read: " + st.restarts + (st.timedOut ? '+' : '') + ' restart(s) to find a clearing line, ' + st.moves + ' open groups.';
  }

  /* ============================ INPUT / MATCHING ============================ */
  boardEl.addEventListener('click', function (e) {
    var t = e.target.closest('.tile'); if (!t || over) return;
    var s = slots[+t.dataset.id];
    if (!isFree(slots, s)) {
      setMsg('That tile is blocked — it needs a free left or right edge and nothing on top.', 'warn');
      return;
    }
    clearHints();
    if (selected && selected.id === s.id) { selected = null; render(); return; }
    if (!selected) { selected = s; render(); return; }
    // attempt a match
    if (matchKey(selected.tile) === matchKey(s.tile)) {
      removePair(selected, s);
      selected = null;
    } else {
      setMsg('No match — ' + tileLabel(selected.tile) + ' doesn\'t pair with ' + tileLabel(s.tile) + '. Pick its twin.', 'warn');
      selected = s;   // switch selection to the new tile
      render();
    }
  });

  function removePair(a, b) {
    a.removed = true; b.removed = true;
    history.push({ a: a.id, b: b.id });
    render();
    setMsg('Matched ' + tileLabel(a.tile) + '. ' + history.length + ' pair(s) cleared.', 'good');
    checkEnd();
  }

  function checkEnd() {
    var left = slots.filter(function (s) { return !s.removed; }).length;
    if (left === 0) {
      over = true; won = true;
      boardEl.classList.add('won');
      banner.textContent = 'Board cleared!';
      banner.className = 'winner-banner win';
      setMsg('You cleared the whole turtle. Beautifully done.', 'win');
      return;
    }
    // stuck? no free matching pair available
    if (!freeMatchingPairs(slots).length) {
      banner.textContent = 'Stuck — no free pair';
      banner.className = 'winner-banner dead';
      setMsg('No free matching pair left — the board is <b>stuck</b>. Try <b>Undo</b> or <b>Shuffle</b> to keep going.', 'dead');
      if (explainChk.checked && aiUsable()) narrateStuck();
    }
  }

  /* ============================ UNDO ============================ */
  function undo() {
    if (over && won) return;
    if (!history.length) { setMsg('Nothing to undo yet.', ''); return; }
    var last = history.pop();
    slots[last.a].removed = false; slots[last.b].removed = false;
    over = false; boardEl.classList.remove('won'); banner.textContent = ''; banner.className = 'winner-banner';
    selected = null; clearHints(); render();
    setMsg('Took back the last pair.', '');
  }

  /* ============================ SHUFFLE ============================
   * Re-deal the REMAINING tiles into the remaining slots so the board is solvable
   * again. We collect the live tiles, then reuse the solvable-deal routine over
   * just the live slots (treating removed slots as gone). */
  function shuffleBoard() {
    if (over && won) return;
    var live = slots.filter(function (s) { return !s.removed; });
    if (live.length < 2) return;
    gen++;   // cancel any narration
    var g = gen;
    // Try to deal the live tiles into the live slots solvably.
    for (var attempt = 0; attempt < 80; attempt++) {
      // gather the multiset of live tiles, re-paired by matchKey
      var byKey = {};
      live.forEach(function (s) { (byKey[matchKey(s.tile)] = byKey[matchKey(s.tile)] || []).push(s.tile); });
      var pairs = [];
      var leftover = [];   // odd ones out (shouldn't happen — pairs are always even)
      Object.keys(byKey).forEach(function (k) {
        var arr = byKey[k]; shuffle(arr);
        for (var i = 0; i + 1 < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
        if (arr.length % 2) leftover.push(arr[arr.length - 1]);
      });
      shuffle(pairs);
      // simulate the clear over the live slots only
      live.forEach(function (s) { s.placed = false; s.tile = null; });
      var done = 0, n = live.length, ok = true;
      var leftoverQueue = leftover.slice();
      while (done < n) {
        var free = live.filter(function (s) {
          if (s.placed) return false;
          for (var i = 0; i < s.above.length; i++) {
            var up = slots[s.above[i]];
            if (!up.removed && !up.placed) return false;
          }
          var leftBlk = s.left.some(function (id) { var o = slots[id]; return !o.removed && !o.placed; });
          var rightBlk = s.right.some(function (id) { var o = slots[id]; return !o.removed && !o.placed; });
          return !(leftBlk && rightBlk);
        });
        if (free.length >= 2 && pairs.length) {
          shuffle(free);
          var pr = pairs.pop();
          free[0].tile = pr[0]; free[1].tile = pr[1];
          free[0].placed = free[1].placed = true; done += 2;
        } else if (free.length >= 1 && leftoverQueue.length) {
          // place a leftover singleton (rare); it can't be matched but keeps deal valid
          shuffle(free); free[0].tile = leftoverQueue.pop(); free[0].placed = true; done += 1;
        } else { ok = false; break; }
      }
      if (ok && done === n && !pairs.length) {
        if (g !== gen) return;
        selected = null; history = []; over = false; won = false;
        boardEl.classList.remove('won'); banner.textContent = ''; banner.className = 'winner-banner';
        clearHints(); render(); rateDifficulty();
        setMsg('Shuffled the remaining tiles into a fresh solvable arrangement.', 'good');
        return;
      }
    }
    // give live tiles back something valid even if solvable-deal failed
    var tiles = live.map(function (s) { return s.tile; }); shuffle(tiles);
    live.forEach(function (s, i) { s.tile = tiles[i]; s.placed = true; });
    render(); rateDifficulty();
    setMsg('Shuffled (best effort).', 'good');
  }

  /* ============================ HINT ============================ */
  function clearHints() { boardEl.querySelectorAll('.tile.hint').forEach(function (el) { el.classList.remove('hint'); }); }

  function hint() {
    if (over) { setMsg('Game over — start a <b>New game</b> first.', ''); return; }
    clearHints();
    // Prefer a SAFE pair: one that keeps the board solvable. Fall back to any free
    // matching pair if the solver times out; warn if truly stuck.
    var pairs = freeMatchingPairs(slots);
    if (!pairs.length) {
      setMsg('No free matching pair — the board is <b>stuck</b>. Try <b>Shuffle</b> or <b>Undo</b>.', 'dead');
      if (explainChk.checked && aiUsable()) narrateStuck();
      return;
    }
    var snap = snapshot(slots);
    var safe = null, timedOut = false;
    for (var i = 0; i < pairs.length && !safe; i++) {
      var a = pairs[i][0], b = pairs[i][1];
      a.removed = b.removed = true;
      var budget = { tries: 0, cap: 120 };
      var r = searchSolvable(slots, budget);
      a.removed = b.removed = false;
      if (r.timedOut) timedOut = true;
      if (r.solvable) safe = pairs[i];
    }
    restore(slots, snap);
    var chosen = safe || pairs[0];
    highlightPair(chosen);
    var safeWord = safe ? 'keeps the board solvable' : (timedOut ? 'is a sound move (deep lines uncertain)' : 'is your only line');
    setMsg('Match the two <b>' + tileLabel(chosen[0].tile) + '</b> tiles — that ' + safeWord + '.', 'good');
    if (explainChk.checked && aiUsable()) narrateHint(chosen, !!safe);
  }

  function highlightPair(pair) {
    [pair[0], pair[1]].forEach(function (s) {
      var el = boardEl.querySelector('.tile[data-id="' + s.id + '"]');
      if (el) { el.classList.add('hint'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    });
  }

  /* ============================ MODEL NARRATION ============================
   * The model NEVER picks the pair — the solver already did. It only retells the
   * deduction conversationally, streamed into the think panel. Bad/failed reply
   * is harmless: the written reason above already stands. */
  function liveBoardPicture() {
    var free = freeSlots(slots);
    var counts = {};
    slots.filter(function (s) { return !s.removed; }).forEach(function (s) { var k = matchKey(s.tile); counts[k] = (counts[k] || 0) + 1; });
    var freeDesc = free.map(function (s) { return tileLabel(s.tile); }).slice(0, 16).join(', ');
    var left = slots.filter(function (s) { return !s.removed; }).length;
    return left + ' tiles remain. Currently free tiles: ' + (freeDesc || 'none') + '.';
  }

  async function narrateHint(pair, isSafe) {
    var g = gen;
    if (aiController) { try { aiController.abort(); } catch (e) {} }
    aiController = new AbortController();
    thinkEl.textContent = '';
    var sys = 'You are a friendly Mahjong Solitaire coach. A solver has ALREADY chosen the next pair to remove and verified it. ' +
      'In 1-3 short sentences, explain to a learner why removing this matching pair now is a good, safe move — mention that a tile is "free" when nothing sits on top and a left or right edge is open. Do NOT suggest a different pair and do NOT add doubt; the choice is made.';
    var user = 'Recommended pair: two ' + tileLabel(pair[0].tile) + ' tiles, both currently free. ' +
      (isSafe ? 'The solver confirmed this keeps the whole board clearable. ' : 'This is the available line forward. ') +
      liveBoardPicture() + '\nExplain why matching these now is the right call.';
    await streamNarration(g, sys, user);
  }

  async function narrateStuck() {
    var g = gen;
    if (aiController) { try { aiController.abort(); } catch (e) {} }
    aiController = new AbortController();
    thinkEl.textContent = '';
    var sys = 'You are a friendly Mahjong Solitaire coach. The board is STUCK: there is no free matching pair right now. ' +
      'In 1-2 short sentences, reassure the learner this happens, explain that no two matchable free tiles are exposed, and suggest using Shuffle (re-deal remaining tiles) or Undo.';
    var user = 'The board is stuck — no free matching pair. ' + liveBoardPicture() + '\nExplain the situation and the way out.';
    await streamNarration(g, sys, user);
  }

  async function streamNarration(g, sys, user) {
    try {
      await BYOM.chat({
        endpoint: endpoint(), model: defaultModel, temperature: 0.45,
        maxTokens: aiIsReasoning(defaultModel) ? 1400 : 220,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        onToken: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        onThinking: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
        signal: aiController.signal
      });
    } catch (e) {
      if (g !== gen) return;
      thinkEl.textContent += (thinkEl.textContent ? '\n' : '') + '[model unavailable — the written advice above still stands.]';
    }
    if (g === gen) aiController = null;
  }

  /* ============================ MESSAGES ============================ */
  function setMsg(html, cls) { assistMsg.className = 'assist-msg' + (cls ? ' ' + cls : ''); assistMsg.innerHTML = html; }

  /* ============================ CONTROL WIRING ============================ */
  $('newGame').addEventListener('click', newGame);
  hintBtn.addEventListener('click', hint);
  shuffleBtn.addEventListener('click', shuffleBoard);
  undoBtn.addEventListener('click', undo);
  restartBtn.addEventListener('click', restart);
  $('diffSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    $('diffSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    diff = b.dataset.diff; newGame();
  });
  var resizeT = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (slots.length) { layoutBoard(); render(); } }, 150);
  });

  /* ============================ AI CONNECTION ============================ */
  function setAiStatus(text, state) { $('aiStatus').textContent = text; $('aiDot').className = 'ai-dot' + (state ? ' ' + state : ''); }

  async function loadModels() {
    if (!BYOM.isLocal()) return;
    BYOM.saveConfig({ endpoint: endpoint() });
    modelSel.disabled = true; modelSel.innerHTML = '<option>loading…</option>'; modelReady = false;
    var saved = BYOM.loadConfig().model;
    var res = await BYOM.test({ endpoint: endpoint() });
    if (!res.ok) {
      modelSel.innerHTML = '<option value="">— not reachable —</option>';
      setAiStatus(res.error.message + ' — hints & shuffle still work (pure logic).', 'err');
      return;
    }
    modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    modelSel.disabled = false;
    var fav = res.models.indexOf(saved) >= 0 ? saved
      : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
    modelSel.value = fav; defaultModel = fav; modelReady = true;
    BYOM.saveConfig({ model: fav });
    setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. Tick the box to narrate hints.', 'on');
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  /* ============================ BOOT ============================ */
  newGame();
  if (BYOM.isLocal()) { endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT; loadModels(); }
  else setAiStatus('Public site — hints, shuffle & undo run offline (pure logic). Run locally to add model narration.', '');
})();
