/* ============================================================================
 *  XenoXanadu — Connect Four reference solver  (window.C4Solver)
 *  ----------------------------------------------------------------------------
 *  The "ground truth" for grading a model's play. Connect Four is a solved game,
 *  so we can score every candidate move and say — exactly, near the endgame —
 *  whether the model picked an optimal one, blundered a forced win, or walked
 *  into a forced loss.
 *
 *  This is a depth-limited negamax (alpha-beta, center-first move ordering) with
 *  EXACT terminal detection. Within the search depth, forced wins/losses are
 *  found exactly; beyond it, a positions is scored by a classic 4-window
 *  heuristic. So:
 *    • decisive verdicts (forced win/loss) are exact when they're within depth
 *      — which covers essentially all real blunders, since blunders are tactical;
 *    • non-decisive move *ordering* is strong-but-heuristic (good enough to rank
 *      "best" early in the game, where every reasonable move is still drawing).
 *  Records carry the depth used, so grading is honest about its own horizon.
 *
 *  Board representation matches the game: grid[r][c], row 0 = TOP, values are
 *  'red' | 'blue' | null. analyze() converts to a fast internal stack board.
 * ========================================================================== */
(function (global) {
  'use strict';

  var ROWS = 6, COLS = 7;
  var WIN = 1000000;            // base score for a forced win
  var DECISIVE = WIN - 1000;    // |score| >= this  ⇒  a forced result (exact)
  var INF = 1e9;
  var ORDER = [3, 2, 4, 1, 5, 0, 6];   // center-first: best moves examined first

  // ---- internal mutable board (column stacks) ------------------------------
  // cells[c*ROWS + row] = 0 empty | 1 | 2  (row 0 = bottom).  heights[c] = count.
  var cells = new Int8Array(COLS * ROWS);
  var heights = new Int8Array(COLS);
  var nodes = 0;

  function reset() { cells.fill(0); heights.fill(0); }
  function cellAt(c, row) { return row < heights[c] ? cells[c * ROWS + row] : 0; }
  function other(p) { return p === 1 ? 2 : 1; }

  function place(c, p) { cells[c * ROWS + heights[c]] = p; heights[c]++; }
  function unplace(c) { heights[c]--; cells[c * ROWS + heights[c]] = 0; }

  // does the disc most recently placed at (c, row) complete four-in-a-row for p?
  function isWinAt(c, row, p) {
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (var d = 0; d < 4; d++) {
      var dc = dirs[d][0], dr = dirs[d][1], n = 1, k, cc, rr;
      for (k = 1; k < 4; k++) {
        cc = c + dc * k; rr = row + dr * k;
        if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS || cellAt(cc, rr) !== p) break;
        n++;
      }
      for (k = 1; k < 4; k++) {
        cc = c - dc * k; rr = row - dr * k;
        if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS || cellAt(cc, rr) !== p) break;
        n++;
      }
      if (n >= 4) return true;
    }
    return false;
  }

  // would playing column c win immediately for p?  (no lasting mutation)
  function winsAt(c, p) {
    if (heights[c] >= ROWS) return false;
    var row = heights[c];
    cells[c * ROWS + row] = p; heights[c]++;
    var w = isWinAt(c, row, p);
    heights[c]--; cells[c * ROWS + row] = 0;
    return w;
  }

  function legalCols() {
    var out = [];
    for (var i = 0; i < ORDER.length; i++) { var c = ORDER[i]; if (heights[c] < ROWS) out.push(c); }
    return out;
  }

  // ---- classic 4-window heuristic (from p's perspective) -------------------
  function scoreWindow(a, b, c, d, p) {
    var me = 0, them = 0, empty = 0, o = other(p), arr = [a, b, c, d], v;
    for (var i = 0; i < 4; i++) { v = arr[i]; if (v === p) me++; else if (v === o) them++; else empty++; }
    if (me && them) return 0;            // contested window — dead
    if (me === 3 && empty === 1) return 50;
    if (me === 2 && empty === 2) return 10;
    if (me === 1 && empty === 3) return 1;
    if (them === 3 && empty === 1) return -50;
    if (them === 2 && empty === 2) return -10;
    if (them === 1 && empty === 3) return -1;
    return 0;
  }

  function heuristic(p) {
    var s = 0, c, r;
    // central column is worth holding
    for (r = 0; r < ROWS; r++) { var v = cellAt(3, r); if (v === p) s += 3; else if (v) s -= 3; }
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (c + 3 < COLS) s += scoreWindow(cellAt(c, r), cellAt(c + 1, r), cellAt(c + 2, r), cellAt(c + 3, r), p);
        if (r + 3 < ROWS) s += scoreWindow(cellAt(c, r), cellAt(c, r + 1), cellAt(c, r + 2), cellAt(c, r + 3), p);
        if (c + 3 < COLS && r + 3 < ROWS) s += scoreWindow(cellAt(c, r), cellAt(c + 1, r + 1), cellAt(c + 2, r + 2), cellAt(c + 3, r + 3), p);
        if (c + 3 < COLS && r - 3 >= 0) s += scoreWindow(cellAt(c, r), cellAt(c + 1, r - 1), cellAt(c + 2, r - 2), cellAt(c + 3, r - 3), p);
      }
    }
    return s;
  }

  // negamax: best achievable score for player `p` to move, `ply` from the root.
  function negamax(p, depth, alpha, beta, ply) {
    nodes++;
    var legal = legalCols();
    if (legal.length === 0) return 0;                 // board full → draw
    for (var i = 0; i < legal.length; i++) if (winsAt(legal[i], p)) return WIN - ply;
    if (depth === 0) return heuristic(p);
    var best = -INF;
    for (var j = 0; j < legal.length; j++) {
      var c = legal[j];
      place(c, p);
      var val = -negamax(other(p), depth - 1, -beta, -alpha, ply + 1);
      unplace(c);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                       // prune
    }
    return best;
  }

  function colorId(color) { return color === 'red' ? 1 : 2; }

  // ---- public: analyse a position for `color` to move ----------------------
  // returns { best, bestVal, scores:{col:val}, decisive, depth, nodes }
  // `scores` keys are 0-based columns; val is from `color`'s perspective.
  function analyze(grid, color, opts) {
    opts = opts || {};
    var depth = opts.depth != null ? opts.depth : 10;
    reset();
    // grid row 0 = top; stack each column from the bottom up
    for (var c = 0; c < COLS; c++) {
      for (var r = ROWS - 1; r >= 0; r--) {
        var v = grid[r][c];
        if (v) place(c, colorId(v));
      }
    }
    var p = colorId(color);
    nodes = 0;
    var scores = {}, best = null, bestVal = -INF;
    var legal = legalCols();
    for (var k = 0; k < legal.length; k++) {
      var col = legal[k];
      var val;
      if (winsAt(col, p)) {
        val = WIN;                                     // immediate win
      } else {
        place(col, p);
        val = -negamax(other(p), depth - 1, -INF, INF, 1);
        unplace(col);
      }
      scores[col] = val;
      if (val > bestVal) { bestVal = val; best = col; }
    }
    return {
      best: best, bestVal: bestVal, scores: scores,
      decisive: Math.abs(bestVal) >= DECISIVE, depth: depth, nodes: nodes
    };
  }

  // grade one move (0-based `chosen`) against a fresh analysis (or a supplied one)
  function grade(grid, color, chosen, opts) {
    var a = (opts && opts.analysis) || analyze(grid, color, opts);
    var chosenVal = a.scores[chosen];
    var legal = chosenVal != null;
    var optimal = legal && chosenVal === a.bestVal;
    // a blunder = a move that flips an EXACT decisive verdict the wrong way
    var threwWin = a.bestVal >= DECISIVE && (!legal || chosenVal < DECISIVE);
    var intoLoss = a.bestVal > -DECISIVE && legal && chosenVal <= -DECISIVE;
    return {
      best: a.best, bestVal: a.bestVal,
      chosen: chosen, chosenVal: legal ? chosenVal : null,
      legal: legal, optimal: optimal,
      regret: legal ? (a.bestVal - chosenVal) : null,
      blunder: !!(threwWin || intoLoss),
      blunderType: threwWin ? 'threw-win' : (intoLoss ? 'into-loss' : null),
      decisive: a.decisive, depth: a.depth
    };
  }

  global.C4Solver = { analyze: analyze, grade: grade, WIN: WIN, DECISIVE: DECISIVE, ROWS: ROWS, COLS: COLS };
})(window);
