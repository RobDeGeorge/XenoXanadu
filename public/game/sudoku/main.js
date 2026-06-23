/* ============================================================================
 *  XenoXanadu — Sudoku — board + generator + detective solver + BYOM narration
 *  ----------------------------------------------------------------------------
 *  A complete 9x9 Sudoku: enter digits, pencil/candidate marks, erase, optional
 *  conflict highlighting, check-against-solution, full solve, New Game, timer.
 *
 *  Two engines do the real work and both run COMPLETELY OFFLINE:
 *    • The GENERATOR builds a full solved grid (randomised backtracking), then
 *      digs clues out while a uniqueness check guarantees exactly ONE solution.
 *      Difficulty = how many clues remain AND which logic techniques the puzzle
 *      requires (Easy/Medium solvable by singles; Hard/Expert need pairs etc.).
 *    • The DETECTIVE is a human-style logical solver. Given the current board it
 *      finds the NEXT provable deduction — naked single, hidden single, naked
 *      pair, hidden pair, pointing pair/box-line — names the target cell(s) and
 *      the house it lives in, and writes the reason. It powers the "Hint" button.
 *
 *  A connected local model (via the shared BYOM pipeline) is a pure ENHANCEMENT:
 *  it never chooses a cell or a digit. The detective picks the deduction; the
 *  model only retells it in plain English, streamed to a panel — the same
 *  "engine decides, model narrates" contract the other AI games use.
 * ========================================================================== */
(function () {
  'use strict';
  var BYOM = window.XenoBYOM;
  var $ = function (id) { return document.getElementById(id); };

  // Clue budgets + the technique ceiling that defines each difficulty.
  // 'maxTech' is the hardest technique the dug puzzle is allowed to REQUIRE.
  var LEVELS = {
    easy:   { clues: 40, maxTech: 1, label: 'EASY' },     // naked/hidden singles only
    medium: { clues: 33, maxTech: 2, label: 'MEDIUM' },   // + locked candidates (pointing/box-line)
    hard:   { clues: 28, maxTech: 3, label: 'HARD' },      // + naked pairs
    expert: { clues: 24, maxTech: 4, label: 'EXPERT' }     // + hidden pairs (and beyond → may need a guess)
  };

  // ---- DOM ----
  var boardEl = $('board'), padEl = $('pad'), assistMsg = $('assistMsg'),
      diffReadout = $('diffReadout'), timerEl = $('timer'),
      pencilToggle = $('pencilToggle'), conflictToggle = $('conflictToggle'),
      hintBtn = $('hintBtn'), checkBtn = $('checkBtn'), solveBtn = $('solveBtn'),
      modelSel = $('modelSel'), endpointEl = $('endpoint'), explainChk = $('explainChk'),
      thinkEl = $('aiThink');

  // ---- game state ----
  var level = 'easy';
  var given = [];            // 81 ints: the puzzle clues (0 = blank)
  var solution = [];         // 81 ints: the unique solution
  var grid = [];             // 81 ints: the player's current digits (0 = blank)
  var notes = [];            // 81 arrays of booleans[10] for pencil marks
  var els = [];              // 81 DOM nodes
  var sel = -1;              // selected cell index, or -1
  var pencilMode = false;
  var showConflicts = true;
  var won = false;
  var startTime = 0, timerId = null, elapsed = 0;

  // ---- AI / detective state ----
  var defaultModel = '', modelReady = false;
  var gen = 0;               // bumps on new game to cancel async loops
  var aiController = null;

  function endpoint() { return (endpointEl.value || BYOM.DEFAULT_ENDPOINT).replace(/\/$/, ''); }
  var aiIsReasoning = function (m) { return /r1\b|deepseek-r1|qwq|reason|think|gpt-oss|o1|o3/i.test(m || ''); };
  var aiUsable = function () { return BYOM.isLocal() && modelReady && defaultModel; };

  // ---- coordinate helpers ----
  var rc = function (i) { return { r: Math.floor(i / 9), c: i % 9 }; };
  var idx = function (r, c) { return r * 9 + c; };
  var boxOf = function (i) { var p = rc(i); return Math.floor(p.r / 3) * 3 + Math.floor(p.c / 3); };
  var name = function (i) { var p = rc(i); return 'R' + (p.r + 1) + 'C' + (p.c + 1); };

  // Pre-compute the three houses (row, col, box) and the 20 peers of each cell.
  var ROWS = [], COLS = [], BOXES = [], PEERS = [];
  (function buildHouses() {
    for (var r = 0; r < 9; r++) { ROWS[r] = []; for (var c = 0; c < 9; c++) ROWS[r].push(idx(r, c)); }
    for (var c2 = 0; c2 < 9; c2++) { COLS[c2] = []; for (var r2 = 0; r2 < 9; r2++) COLS[c2].push(idx(r2, c2)); }
    for (var b = 0; b < 9; b++) {
      BOXES[b] = [];
      var br = Math.floor(b / 3) * 3, bc = (b % 3) * 3;
      for (var dr = 0; dr < 3; dr++) for (var dc = 0; dc < 3; dc++) BOXES[b].push(idx(br + dr, bc + dc));
    }
    for (var i = 0; i < 81; i++) {
      var p = rc(i), set = {};
      ROWS[p.r].concat(COLS[p.c], BOXES[boxOf(i)]).forEach(function (j) { if (j !== i) set[j] = true; });
      PEERS[i] = Object.keys(set).map(Number);
    }
  })();

  /* ============================ GENERATOR ============================ */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Fill an empty 81-array with a random complete valid solution via backtracking.
  function fillFull(g) {
    var i = g.indexOf(0);
    if (i < 0) return true;
    var opts = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (var k = 0; k < opts.length; k++) {
      var d = opts[k];
      if (canPlace(g, i, d)) { g[i] = d; if (fillFull(g)) return true; g[i] = 0; }
    }
    return false;
  }
  function canPlace(g, i, d) {
    var peers = PEERS[i];
    for (var k = 0; k < peers.length; k++) if (g[peers[k]] === d) return false;
    return true;
  }

  // Count solutions up to a cap (2 is enough to test uniqueness).
  function countSolutions(g, cap) {
    var work = g.slice(), count = 0;
    (function rec() {
      if (count >= cap) return;
      var best = -1, bestCnt = 10, bestCands = null;
      for (var i = 0; i < 81; i++) {
        if (work[i]) continue;
        var cands = [];
        for (var d = 1; d <= 9; d++) if (canPlace(work, i, d)) cands.push(d);
        if (cands.length === 0) return;            // dead end
        if (cands.length < bestCnt) { bestCnt = cands.length; best = i; bestCands = cands; if (bestCnt === 1) break; }
      }
      if (best < 0) { count++; return; }           // filled → one solution
      for (var j = 0; j < bestCands.length; j++) {
        work[best] = bestCands[j];
        rec();
        work[best] = 0;
        if (count >= cap) return;
      }
    })();
    return count;
  }

  // Build a puzzle: full solution, then dig holes (symmetric-ish, random order)
  // keeping uniqueness, until we hit the clue budget AND the technique grade
  // matches the requested difficulty. Retries a few times to land in band.
  function generate(lvl) {
    var L = LEVELS[lvl];
    for (var attempt = 0; attempt < 14; attempt++) {
      var full = new Array(81).fill(0);
      fillFull(full);
      var puzzle = full.slice();
      var order = shuffle(Array.from({ length: 81 }, function (_, i) { return i; }));
      var clues = 81;
      for (var o = 0; o < order.length && clues > L.clues; o++) {
        var cell = order[o];
        if (puzzle[cell] === 0) continue;
        var backup = puzzle[cell];
        puzzle[cell] = 0;
        if (countSolutions(puzzle, 2) !== 1) { puzzle[cell] = backup; }   // would break uniqueness
        else clues--;
      }
      var tech = gradePuzzle(puzzle);                 // hardest technique the logic solver needed
      // Easy/Medium must be exactly within band; Hard/Expert accept their ceiling or just under.
      if (tech <= L.maxTech && (lvl === 'easy' || lvl === 'medium' ? tech >= 1 : tech >= L.maxTech - 1)) {
        return { given: puzzle, solution: full };
      }
      // Expert: even if it needs a guess (tech === 99) that's acceptable as the hardest tier.
      if (lvl === 'expert' && attempt >= 8) return { given: puzzle, solution: full };
    }
    // Fallback: just return whatever the last attempt produced (still unique).
    var f2 = new Array(81).fill(0); fillFull(f2);
    var p2 = f2.slice(), ord2 = shuffle(Array.from({ length: 81 }, function (_, i) { return i; })), cl = 81;
    for (var o2 = 0; o2 < ord2.length && cl > L.clues; o2++) {
      if (p2[ord2[o2]] === 0) continue;
      var bk = p2[ord2[o2]]; p2[ord2[o2]] = 0;
      if (countSolutions(p2, 2) !== 1) p2[ord2[o2]] = bk; else cl--;
    }
    return { given: p2, solution: f2 };
  }

  // Run the human-technique solver on a puzzle and return the HARDEST technique
  // rank it required to finish (1 singles … 4 hidden pairs; 99 = unsolved by logic).
  function gradePuzzle(puzzle) {
    var g = puzzle.slice(), hardest = 0;
    while (true) {
      if (g.indexOf(0) < 0) return hardest;
      var step = findStep(g);
      if (!step) return 99;                 // logic stuck → needs guessing
      hardest = Math.max(hardest, step.rank);
      if (step.place) g[step.place.cell] = step.place.digit;
      else if (step.eliminate) {
        // eliminations don't fill a cell on their own; re-derive candidates next loop.
        // To make progress we apply them by recomputing — handled inside findStep via cands.
        // For grading we just continue; if only eliminations exist with no follow-up single,
        // the next findStep call will surface the resulting single. Guard against a stall:
        if (!applyEliminations(g, step)) return hardest >= 4 ? hardest : 4;
      } else return hardest;
    }
  }

  /* ============================ DETECTIVE SOLVER ============================ */
  // Candidate set for every empty cell of grid `g` (array[81] of {1..9} arrays).
  function candidates(g) {
    var cand = new Array(81);
    for (var i = 0; i < 81; i++) {
      if (g[i]) { cand[i] = null; continue; }
      var list = [];
      for (var d = 1; d <= 9; d++) if (canPlace(g, i, d)) list.push(d);
      cand[i] = list;
    }
    return cand;
  }

  var HOUSES = null;   // [{kind, cells}] for all 27 houses
  function houseList() {
    if (HOUSES) return HOUSES;
    HOUSES = [];
    for (var r = 0; r < 9; r++) HOUSES.push({ kind: 'row', n: r + 1, cells: ROWS[r] });
    for (var c = 0; c < 9; c++) HOUSES.push({ kind: 'column', n: c + 1, cells: COLS[c] });
    for (var b = 0; b < 9; b++) HOUSES.push({ kind: 'box', n: b + 1, cells: BOXES[b] });
    return HOUSES;
  }
  function houseLabel(h) { return h.kind + ' ' + h.n; }

  // Find the NEXT logical step on grid `g`. Returns the easiest available, tagged
  // with a technique rank, the target cell(s)/house, and a written reason. Or null
  // if nothing logical is available (the board needs a guess, or is full/broken).
  function findStep(g) {
    var cand = candidates(g);

    // --- rank 1a: naked single (a cell with exactly one candidate) ---
    for (var i = 0; i < 81; i++) {
      if (cand[i] && cand[i].length === 1) {
        var d = cand[i][0];
        return { rank: 1, tech: 'Naked single', place: { cell: i, digit: d },
          targets: [i], houses: [],
          reason: name(i) + ' can only be a ' + d + ' — every other digit already appears in its row, column or box.' };
      }
    }

    // --- rank 1b: hidden single (a digit that fits only one cell in some house) ---
    var houses = houseList();
    for (var hI = 0; hI < houses.length; hI++) {
      var h = houses[hI];
      for (var dd = 1; dd <= 9; dd++) {
        var spots = [];
        for (var k = 0; k < h.cells.length; k++) {
          var cc = h.cells[k];
          if (!g[cc] && cand[cc].indexOf(dd) >= 0) spots.push(cc);
        }
        // only "hidden" if the digit isn't already placed in this house
        var placed = h.cells.some(function (cc) { return g[cc] === dd; });
        if (!placed && spots.length === 1) {
          var cell = spots[0];
          return { rank: 1, tech: 'Hidden single', place: { cell: cell, digit: dd },
            targets: [cell], houses: [h],
            reason: 'In ' + houseLabel(h) + ', the digit ' + dd + ' fits in only one cell — ' + name(cell) + ' — so it must go there.' };
        }
      }
    }

    // --- rank 2: pointing pair / box-line (locked candidates) ---
    var lc = findLockedCandidate(g, cand);
    if (lc) return lc;

    // --- rank 3: naked pair ---
    var np = findNakedPair(g, cand);
    if (np) return np;

    // --- rank 4: hidden pair ---
    var hp = findHiddenPair(g, cand);
    if (hp) return hp;

    return null;
  }

  // Locked candidates: a digit confined to one box-line intersection. Two flavours,
  // both eliminate the digit from cells OUTSIDE the intersection (which can later
  // expose a single). We only report it when it actually removes a candidate.
  function findLockedCandidate(g, cand) {
    for (var b = 0; b < 9; b++) {
      var box = BOXES[b];
      for (var d = 1; d <= 9; d++) {
        var cells = box.filter(function (c) { return !g[c] && cand[c].indexOf(d) >= 0; });
        if (cells.length < 2) continue;
        var rows = uniq(cells.map(function (c) { return rc(c).r; }));
        var cols = uniq(cells.map(function (c) { return rc(c).c; }));
        // Pointing: all in one row/col of the box → remove d elsewhere on that line.
        if (rows.length === 1) {
          var line = ROWS[rows[0]].filter(function (c) { return boxOf(c) !== b && !g[c] && cand[c].indexOf(d) >= 0; });
          if (line.length) return lockedStep(d, cells, line, 'row ' + (rows[0] + 1), 'box ' + (b + 1), b);
        }
        if (cols.length === 1) {
          var lineC = COLS[cols[0]].filter(function (c) { return boxOf(c) !== b && !g[c] && cand[c].indexOf(d) >= 0; });
          if (lineC.length) return lockedStep(d, cells, lineC, 'column ' + (cols[0] + 1), 'box ' + (b + 1), b);
        }
      }
    }
    // Box-line reduction: a digit in a row/col confined to one box → remove from rest of box.
    var lines = ROWS.map(function (cells, n) { return { cells: cells, lbl: 'row ' + (n + 1) }; })
      .concat(COLS.map(function (cells, n) { return { cells: cells, lbl: 'column ' + (n + 1) }; }));
    for (var li = 0; li < lines.length; li++) {
      var L = lines[li];
      for (var d2 = 1; d2 <= 9; d2++) {
        var cs = L.cells.filter(function (c) { return !g[c] && cand[c].indexOf(d2) >= 0; });
        if (cs.length < 2) continue;
        var boxes = uniq(cs.map(boxOf));
        if (boxes.length === 1) {
          var rest = BOXES[boxes[0]].filter(function (c) { return L.cells.indexOf(c) < 0 && !g[c] && cand[c].indexOf(d2) >= 0; });
          if (rest.length) return lockedStep(d2, cs, rest, L.lbl, 'box ' + (boxes[0] + 1), boxes[0]);
        }
      }
    }
    return null;
  }
  function lockedStep(d, lockedCells, elimCells, lineLbl, boxLbl, boxN) {
    return {
      rank: 2, tech: 'Locked candidates',
      eliminate: elimCells.map(function (c) { return { cell: c, digit: d }; }),
      targets: lockedCells, houses: [{ kind: 'box', n: boxN + 1, cells: BOXES[boxN] }],
      elimCells: elimCells, digit: d,
      reason: 'Within ' + boxLbl + ', the only spots for ' + d + ' lie along ' + lineLbl +
        '. Wherever that ' + d + ' lands it claims ' + lineLbl + ', so ' + d + ' can be erased from the other cells of ' +
        (lineLbl.indexOf('row') === 0 || lineLbl.indexOf('column') === 0 ? lineLbl : boxLbl) +
        ' (' + elimCells.map(name).join(', ') + ').'
    };
  }

  // Naked pair: two cells in a house sharing the same two candidates → those two
  // digits are removed from the rest of that house.
  function findNakedPair(g, cand) {
    var houses = houseList();
    for (var hI = 0; hI < houses.length; hI++) {
      var cells = houses[hI].cells.filter(function (c) { return !g[c] && cand[c].length === 2; });
      for (var a = 0; a < cells.length; a++) for (var bb = a + 1; bb < cells.length; bb++) {
        var A = cand[cells[a]], B = cand[cells[bb]];
        if (A[0] === B[0] && A[1] === B[1]) {
          var pair = A.slice();
          var elim = houses[hI].cells.filter(function (c) {
            return c !== cells[a] && c !== cells[bb] && !g[c] && (cand[c].indexOf(pair[0]) >= 0 || cand[c].indexOf(pair[1]) >= 0);
          });
          if (elim.length) {
            var elimList = [];
            elim.forEach(function (c) { pair.forEach(function (d) { if (cand[c].indexOf(d) >= 0) elimList.push({ cell: c, digit: d }); }); });
            return { rank: 3, tech: 'Naked pair', eliminate: elimList, elimCells: elim,
              targets: [cells[a], cells[bb]], houses: [houses[hI]], digit: null, pair: pair,
              reason: name(cells[a]) + ' and ' + name(cells[bb]) + ' in ' + houseLabel(houses[hI]) +
                ' both hold only {' + pair.join(',') + '}. Between them they use up both digits, so ' +
                pair.join(' and ') + ' can be erased from the rest of that ' + houses[hI].kind +
                ' (' + elim.map(name).join(', ') + ').' };
          }
        }
      }
    }
    return null;
  }

  // Hidden pair: two digits that appear only in the same two cells of a house →
  // those cells are reduced to exactly that pair (other candidates removed).
  function findHiddenPair(g, cand) {
    var houses = houseList();
    for (var hI = 0; hI < houses.length; hI++) {
      var h = houses[hI];
      var spots = {};   // digit -> [cells]
      for (var d = 1; d <= 9; d++) {
        spots[d] = h.cells.filter(function (c) { return !g[c] && cand[c].indexOf(d) >= 0; });
      }
      for (var d1 = 1; d1 <= 9; d1++) for (var d2 = d1 + 1; d2 <= 9; d2++) {
        if (spots[d1].length !== 2 || spots[d2].length !== 2) continue;
        if (spots[d1][0] !== spots[d2][0] || spots[d1][1] !== spots[d2][1]) continue;
        var cellsHP = spots[d1];
        var elimList = [];
        cellsHP.forEach(function (c) {
          cand[c].forEach(function (x) { if (x !== d1 && x !== d2) elimList.push({ cell: c, digit: x }); });
        });
        if (elimList.length) {
          return { rank: 4, tech: 'Hidden pair', eliminate: elimList, elimCells: cellsHP,
            targets: cellsHP, houses: [h], digit: null, pair: [d1, d2],
            reason: 'In ' + houseLabel(h) + ', the digits ' + d1 + ' and ' + d2 + ' can only go in ' +
              name(cellsHP[0]) + ' and ' + name(cellsHP[1]) + '. Those two cells are therefore exactly {' +
              d1 + ',' + d2 + '} — every other candidate in them can be erased.' };
        }
      }
    }
    return null;
  }

  // Apply a step's eliminations to a raw grid by trimming candidates and, where
  // that exposes a single, placing it — used only by gradePuzzle to keep moving.
  function applyEliminations(g, step) {
    // Recompute and look for any newly-forced single after the elimination.
    var cand = candidates(g);
    step.eliminate.forEach(function (e) {
      var arr = cand[e.cell]; if (!arr) return;
      var k = arr.indexOf(e.digit); if (k >= 0) arr.splice(k, 1);
    });
    var moved = false;
    for (var i = 0; i < 81; i++) if (cand[i] && cand[i].length === 1) { g[i] = cand[i][0]; moved = true; }
    return moved;
  }

  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

  /* ============================ NEW GAME ============================ */
  function newGame() {
    gen++;
    abortAi();
    var L = LEVELS[level];
    diffReadout.textContent = L.label;
    setMsg('Generating a unique ' + L.label.toLowerCase() + ' puzzle…', '');
    // Let the "generating" message paint before the (synchronous) crunch.
    setTimeout(function () {
      var startGen = gen;
      var puz = generate(level);
      if (startGen !== gen) return;   // a newer New Game superseded us
      given = puz.given.slice();
      solution = puz.solution.slice();
      grid = given.slice();
      notes = []; for (var i = 0; i < 81; i++) notes.push(new Array(10).fill(false));
      sel = -1; won = false;
      clearHints();
      buildBoard();
      renderAll();
      stopTimer(); elapsed = 0; renderTimer(); startTimer();
      var nClues = given.filter(function (v) { return v; }).length;
      setMsg('New ' + L.label.toLowerCase() + ' puzzle — <b>' + nClues + '</b> clues. Click a cell and enter 1–9.', '');
    }, 20);
  }

  function buildBoard() {
    boardEl.className = 'board';
    boardEl.innerHTML = '';
    els = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 81; i++) {
      var p = rc(i);
      var d = document.createElement('div');
      var cls = 'cell';
      if ((Math.floor(p.r / 3) + Math.floor(p.c / 3)) % 2 === 1) cls += ' box-alt';
      if (p.r % 3 === 0) cls += ' bt';
      if (p.c % 3 === 0) cls += ' bl';
      if (p.c === 8) cls += ' br';
      if (p.r === 8) cls += ' bb';
      d.className = cls; d.dataset.i = i;
      els.push(d); frag.appendChild(d);
    }
    boardEl.appendChild(frag);
  }

  /* ============================ RENDER ============================ */
  function renderAll() {
    for (var i = 0; i < 81; i++) paintCell(i);
    renderHighlights();
    renderPad();
  }

  function paintCell(i) {
    var el = els[i]; if (!el) return;
    var v = grid[i];
    el.classList.toggle('given', given[i] !== 0);
    if (v) {
      el.textContent = v;
    } else if (notes[i].some(Boolean)) {
      el.innerHTML = '';
      var box = document.createElement('div'); box.className = 'notes';
      for (var d = 1; d <= 9; d++) {
        var s = document.createElement('span');
        s.textContent = notes[i][d] ? d : '';
        box.appendChild(s);
      }
      el.appendChild(box);
    } else {
      el.textContent = '';
    }
  }

  // Selection / peer / same-value tint + conflict marks. Recomputed wholesale.
  function renderHighlights() {
    var conflicts = showConflicts ? findConflicts() : {};
    var selVal = sel >= 0 ? grid[sel] : 0;
    for (var i = 0; i < 81; i++) {
      var el = els[i];
      el.classList.remove('sel', 'peer', 'same', 'conflict');
      if (sel >= 0) {
        if (i === sel) el.classList.add('sel');
        else if (PEERS[sel].indexOf(i) >= 0) el.classList.add('peer');
        if (selVal && grid[i] === selVal && i !== sel) el.classList.add('same');
      }
      if (conflicts[i]) el.classList.add('conflict');
    }
  }

  // A cell conflicts if its digit repeats among its peers.
  function findConflicts() {
    var bad = {};
    for (var i = 0; i < 81; i++) {
      if (!grid[i]) continue;
      var peers = PEERS[i];
      for (var k = 0; k < peers.length; k++) {
        if (grid[peers[k]] === grid[i]) { bad[i] = true; bad[peers[k]] = true; }
      }
    }
    return bad;
  }

  function renderPad() {
    var counts = new Array(10).fill(0);
    for (var i = 0; i < 81; i++) if (grid[i]) counts[grid[i]]++;
    padEl.querySelectorAll('.pad-btn').forEach(function (b) {
      var d = +b.dataset.d;
      if (d >= 1 && d <= 9) b.classList.toggle('done', counts[d] >= 9);
    });
  }

  /* ============================ INPUT ============================ */
  function selectCell(i) { sel = i; renderHighlights(); }

  function enterDigit(i, d) {
    if (won || i < 0) return;
    if (given[i] !== 0) return;          // can't overwrite a clue
    clearHints();
    if (pencilMode && d !== 0) {
      // pencil toggles a note (and never on a cell that already holds a value)
      if (grid[i]) return;
      notes[i][d] = !notes[i][d];
      paintCell(i);
      return;
    }
    if (d === 0) { grid[i] = 0; }
    else {
      grid[i] = d;
      for (var n = 1; n <= 9; n++) notes[i][n] = false;   // committing a digit clears its notes
    }
    paintCell(i);
    renderHighlights();
    renderPad();
    checkWin();
  }

  boardEl.addEventListener('click', function (e) {
    var t = e.target.closest('.cell'); if (!t) return;
    selectCell(+t.dataset.i);
  });

  padEl.addEventListener('click', function (e) {
    var b = e.target.closest('.pad-btn'); if (!b) return;
    if (sel < 0) { setMsg('Pick a cell first, then tap a number.', ''); return; }
    enterDigit(sel, +b.dataset.d);
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    if (sel < 0 && !/^Arrow/.test(e.key)) return;
    if (e.key >= '1' && e.key <= '9') { enterDigit(sel, +e.key); e.preventDefault(); }
    else if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') { enterDigit(sel, 0); e.preventDefault(); }
    else if (e.key === 'ArrowUp')    { moveSel(-9); e.preventDefault(); }
    else if (e.key === 'ArrowDown')  { moveSel(9);  e.preventDefault(); }
    else if (e.key === 'ArrowLeft')  { moveSel(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { moveSel(1);  e.preventDefault(); }
  });
  function moveSel(delta) {
    if (sel < 0) { selectCell(40); return; }
    var p = rc(sel), nr = p.r, nc = p.c;
    if (delta === -9) nr = (nr + 8) % 9;
    else if (delta === 9) nr = (nr + 1) % 9;
    else if (delta === -1) nc = (nc + 8) % 9;
    else if (delta === 1) nc = (nc + 1) % 9;
    selectCell(idx(nr, nc));
  }

  /* ============================ WIN ============================ */
  function checkWin() {
    if (won) return;
    for (var i = 0; i < 81; i++) if (grid[i] !== solution[i]) return;
    won = true; stopTimer();
    boardEl.classList.add('won');
    setMsg('<b>Solved!</b> ' + LEVELS[level].label.toLowerCase() + ' puzzle cleared in <b>' + fmtTime(elapsed) + '</b>. Nicely reasoned.', 'good');
  }

  /* ============================ TIMER ============================ */
  function startTimer() { if (timerId) return; startTime = Date.now() - elapsed * 1000; timerId = setInterval(tick, 250); }
  function tick() { elapsed = Math.min(5999, Math.floor((Date.now() - startTime) / 1000)); renderTimer(); }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function renderTimer() { timerEl.textContent = fmtTime(elapsed); }
  function fmtTime(s) { var m = Math.floor(s / 60), ss = s % 60; return ('0' + m).slice(-2) + ':' + ('0' + ss).slice(-2); }

  function setMsg(html, cls) { assistMsg.className = 'assist-msg' + (cls ? ' ' + cls : ''); assistMsg.innerHTML = html; }

  /* ============================ TOOLBAR ============================ */
  pencilToggle.addEventListener('click', function () {
    pencilMode = !pencilMode;
    pencilToggle.classList.toggle('on', pencilMode);
    pencilToggle.textContent = 'Pencil: ' + (pencilMode ? 'on' : 'off');
  });
  conflictToggle.addEventListener('click', function () {
    showConflicts = !showConflicts;
    conflictToggle.classList.toggle('on', showConflicts);
    conflictToggle.textContent = 'Conflicts: ' + (showConflicts ? 'on' : 'off');
    renderHighlights();
  });
  conflictToggle.classList.add('on');   // default on

  // Check: flash every filled, non-clue cell that disagrees with the solution.
  checkBtn.addEventListener('click', function () {
    if (won) { setMsg('Already solved! Start a <b>New game</b>.', 'good'); return; }
    var wrong = 0, filled = 0;
    boardEl.querySelectorAll('.wrong').forEach(function (e) { e.classList.remove('wrong'); });
    for (var i = 0; i < 81; i++) {
      if (given[i] !== 0 || !grid[i]) { if (grid[i]) filled++; continue; }
      filled++;
      if (grid[i] !== solution[i]) { els[i].classList.add('wrong'); wrong++; }
    }
    setTimeout(function () { boardEl.querySelectorAll('.wrong').forEach(function (e) { e.classList.remove('wrong'); }); renderHighlights(); }, 1400);
    if (wrong) setMsg('<b>' + wrong + '</b> cell(s) disagree with the solution — flashed in red.', 'bad');
    else if (filled === 81) setMsg('Every cell checks out — finish line!', 'good');
    else setMsg('No mistakes so far — keep going.', 'good');
  });

  // Solve: fill the whole grid with the unique solution.
  solveBtn.addEventListener('click', function () {
    if (won) return;
    abortAi(); clearHints();
    for (var i = 0; i < 81; i++) { grid[i] = solution[i]; for (var n = 1; n <= 9; n++) notes[i][n] = false; }
    renderAll();
    stopTimer();
    won = true; boardEl.classList.add('won');
    setMsg('Solution filled in. Hit <b>New game</b> for a fresh puzzle.', '');
  });

  /* ============================ HINT (DETECTIVE) ============================ */
  function clearHints() {
    if (!boardEl) return;
    boardEl.querySelectorAll('.hint-target,.hint-house,.hint-elim').forEach(function (el) {
      el.classList.remove('hint-target', 'hint-house', 'hint-elim');
    });
  }

  function hint() {
    if (won) { setMsg('Puzzle already solved — start a <b>New game</b>.', 'good'); return; }
    clearHints();
    // If the player has filled something wrong, the candidate logic is meaningless.
    for (var i = 0; i < 81; i++) {
      if (grid[i] && grid[i] !== solution[i]) {
        els[i].classList.add('hint-elim');
        els[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setMsg('Before deducing further: <b>' + name(i) + '</b> is wrong — it should be ' + solution[i] + '. Fix it (or <b>Check</b>) and ask again.', 'bad');
        return;
      }
    }
    var step = findStep(grid);
    if (!step) {
      setMsg('No single/pair/locked-candidate deduction is available right now — this position needs a deeper technique or a careful guess.', '');
      return;
    }
    announce(step);
  }

  function announce(step) {
    // light up the houses, then the target cell(s), then any eliminations
    (step.houses || []).forEach(function (h) { h.cells.forEach(function (c) { els[c].classList.add('hint-house'); }); });
    (step.targets || []).forEach(function (c) { els[c].classList.add('hint-target'); });
    (step.elimCells || []).forEach(function (c) { els[c].classList.add('hint-elim'); });
    if (step.targets && step.targets.length) els[step.targets[0]].scrollIntoView({ block: 'nearest', inline: 'nearest' });

    var head = '<code>' + step.tech + '</code> — ';
    if (step.place) {
      // auto-select the target so the player can just press the digit
      sel = step.place.cell; renderHighlights();
      // re-apply the target ring (renderHighlights cleared nothing of ours, but keep order safe)
      els[step.place.cell].classList.add('hint-target');
      setMsg(head + step.reason + ' <b>(Enter ' + step.place.digit + ' at ' + name(step.place.cell) + '.)</b>', 'good');
    } else {
      setMsg(head + step.reason, '');
    }
    if (explainChk.checked && aiUsable()) narrate(step);
  }

  hintBtn.addEventListener('click', hint);

  /* ============================ MODEL NARRATION ============================ */
  // The model NEVER picks the cell or the digit — the detective already did. It
  // only retells the proven deduction conversationally, streamed into the panel.
  function abortAi() { if (aiController) { try { aiController.abort(); } catch (e) {} aiController = null; } }

  function narrate(step) {
    var g = gen;
    abortAi();
    aiController = new AbortController();
    thinkEl.textContent = '';
    var sys = 'You are a sharp, friendly Sudoku detective. You are handed a deduction that a solver has ' +
      'ALREADY proven correct. In 1-3 short sentences, explain the reasoning to a learner in your own words, ' +
      'like cracking a case. Do NOT contradict the deduction, do not suggest a different cell or digit, and do ' +
      'not add doubt — it is certain. Refer to cells by their RxCy labels.';
    var fact = 'Technique: ' + step.tech + '.\nProven fact: ' + step.reason;
    if (step.place) fact += '\nConclusion: place ' + step.place.digit + ' in ' + name(step.place.cell) + '.';
    else if (step.eliminate && step.eliminate.length) {
      fact += '\nConclusion: candidate(s) eliminated — ' +
        step.eliminate.map(function (e) { return e.digit + ' from ' + name(e.cell); }).join(', ') + '.';
    }
    fact += '\nExplain why this is certain.';
    BYOM.chat({
      endpoint: endpoint(), model: defaultModel, temperature: 0.45,
      maxTokens: aiIsReasoning(defaultModel) ? 1400 : 240,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: fact }],
      onToken: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
      onThinking: function (d) { if (g === gen) { thinkEl.textContent += d; thinkEl.scrollTop = thinkEl.scrollHeight; } },
      signal: aiController.signal
    }).catch(function () {
      if (g !== gen) return;
      thinkEl.textContent += (thinkEl.textContent ? '\n' : '') + '[model unavailable — the written deduction above still stands.]';
    }).then(function () { aiController = null; });
  }

  /* ============================ AI CONNECTION ============================ */
  function setAiStatus(text, state) { $('aiStatus').textContent = text; $('aiDot').className = 'ai-dot' + (state ? ' ' + state : ''); }

  function loadModels() {
    if (!BYOM.isLocal()) return Promise.resolve();
    BYOM.saveConfig({ endpoint: endpoint() });
    modelSel.disabled = true; modelSel.innerHTML = '<option>loading…</option>'; modelReady = false;
    var saved = BYOM.loadConfig().model;
    return BYOM.test({ endpoint: endpoint() }).then(function (res) {
      if (!res.ok) {
        modelSel.innerHTML = '<option value="">— not reachable —</option>';
        setAiStatus(res.error.message + ' — hints, check & solve still work (pure logic).', 'err');
        return;
      }
      modelSel.innerHTML = res.models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
      modelSel.disabled = false;
      var fav = res.models.indexOf(saved) >= 0 ? saved
        : (res.models.find(function (m) { return /llama3\.2:3b|qwen2\.5|3b|7b|8b|mini|small/i.test(m); }) || res.models[0]);
      modelSel.value = fav; defaultModel = fav; modelReady = true;
      BYOM.saveConfig({ model: fav });
      setAiStatus('Ready — ' + res.models.length + ' model(s) via ' + res.provider + '. Tick the box to narrate hints.', 'on');
    }).catch(function (e) {
      modelSel.innerHTML = '<option value="">— error —</option>';
      setAiStatus('Could not reach a model — hints still work offline.', 'err');
    });
  }
  modelSel.addEventListener('change', function () { defaultModel = this.value; BYOM.saveConfig({ model: this.value }); });
  $('refresh').addEventListener('click', loadModels);
  endpointEl.addEventListener('change', loadModels);

  /* ============================ BOOT ============================ */
  $('newGame').addEventListener('click', newGame);
  $('diffSeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn'); if (!b) return;
    $('diffSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    level = b.dataset.diff; newGame();
  });

  newGame();
  if (BYOM.isLocal()) { endpointEl.value = BYOM.loadConfig().endpoint || BYOM.DEFAULT_ENDPOINT; loadModels(); }
  else setAiStatus('Public site — hints, check & solve run offline (pure logic). Run locally to add model narration.', '');
})();
