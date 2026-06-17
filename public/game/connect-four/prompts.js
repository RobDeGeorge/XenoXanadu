/* ============================================================================
 *  XenoXanadu — Connect Four prompt variants  (window.C4Prompts)
 *  ----------------------------------------------------------------------------
 *  The system prompt is the thing under test. Instead of baking one string into
 *  the game, we keep a registry of named variants; the benchmark tags every
 *  logged move with the variant id, so you can measure which wording actually
 *  makes a given model play better (optimal-move rate, blunder rate, latency).
 *
 *  Each variant is { id, label, description, build(grid, player) -> messages }.
 *  Shared board rendering / legality / answer-parsing live here too, so the
 *  benchmark and the live game can speak the exact same protocol.
 * ========================================================================== */
(function (global) {
  'use strict';

  var ROWS = 6, COLS = 7;

  function boardText(grid) {
    var s = '';
    for (var r = 0; r < ROWS; r++) {
      var row = '';
      for (var c = 0; c < COLS; c++) {
        var v = grid[r][c];
        row += (v === 'red' ? 'R' : v === 'blue' ? 'B' : '.') + ' ';
      }
      s += row.replace(/\s+$/, '') + '\n';
    }
    return s + '1 2 3 4 5 6 7   ← column numbers';
  }

  function legalColumns(grid) {            // 0-based columns that aren't full
    var out = [];
    for (var c = 0; c < COLS; c++) if (!grid[0][c]) out.push(c);
    return out;
  }

  // Pull a legal 0-based column out of a model reply, or null if none found.
  function parse(text, legal) {
    var up = String(text || '').toUpperCase();
    var i = up.lastIndexOf('COLUMN');
    var seg = i >= 0 ? up.slice(i) : up;
    var m = seg.match(/[1-7]/);
    if (m) { var c = +m[0] - 1; if (legal.indexOf(c) >= 0) return c; }
    var all = up.match(/[1-7]/g);
    if (all) for (var k = all.length - 1; k >= 0; k--) { var d = +all[k] - 1; if (legal.indexOf(d) >= 0) return d; }
    return null;
  }

  function ctx(grid, player) {
    var opp = player === 'red' ? 'blue' : 'red';
    return {
      opp: opp,
      me: player === 'red' ? 'R' : 'B',
      them: player === 'red' ? 'B' : 'R',
      legal: legalColumns(grid).map(function (c) { return c + 1; }).join(', '),
      board: boardText(grid)
    };
  }

  var RULES =
    "Board: 7 columns (numbered 1-7, left to right) and 6 rows. The top row is shown first; " +
    "a dropped disc falls to the lowest empty slot in its column.\n" +
    "Symbols: '.' empty, 'R' red, 'B' blue.\n" +
    "Goal: be first to line up FOUR of your own discs in a row — horizontally, vertically, or on either diagonal.";

  var VARIANTS = {
    // (1) the game's current production prompt — the baseline to beat
    v1_baseline: {
      label: 'v1 · baseline',
      description: "The game's shipping prompt: rules + ordered strategy + 1-3 sentence reasoning.",
      build: function (grid, player) {
        var x = ctx(grid, player);
        return [
          { role: 'system', content:
"You are playing Connect Four as " + player.toUpperCase() + " ('" + x.me + "'). Your opponent is " + x.opp.toUpperCase() + " ('" + x.them + "').\n" +
RULES + "\n" +
"Strategy priorities, in order: (1) if you can complete four-in-a-row this move, do it; (2) if the opponent threatens four-in-a-row next move, block it; (3) otherwise build your own threats and prefer central columns.\n" +
"Reply with 1-3 short sentences of reasoning, then on the FINAL line output exactly:\nCOLUMN: n\nwhere n is a single column number 1-7 that is not already full. Nothing after that line." },
          { role: 'user', content:
"Current board:\n" + x.board + "\n\nYou are " + player.toUpperCase() + " ('" + x.me + "'). Columns you may still play: " + x.legal + ".\nThink briefly, then give your COLUMN: line." }
        ];
      }
    },

    // (2) force an explicit threat scan before committing — does structured CoT help?
    v2_threat_scan: {
      label: 'v2 · threat scan',
      description: 'Makes the model enumerate its own wins and the opponent\'s threats before choosing.',
      build: function (grid, player) {
        var x = ctx(grid, player);
        return [
          { role: 'system', content:
"You are an expert Connect Four player playing as " + player.toUpperCase() + " ('" + x.me + "'). Opponent is " + x.opp.toUpperCase() + " ('" + x.them + "').\n" +
RULES + "\n" +
"Before answering, work through these steps explicitly:\n" +
"A. WIN: list any column where you ('" + x.me + "') get four-in-a-row immediately. If any exists, play it.\n" +
"B. BLOCK: list any column where the opponent ('" + x.them + "') would get four-in-a-row next turn. If any exists and you have no win, play it.\n" +
"C. TRAP: avoid any move that lets the opponent win directly on top of yours; prefer moves that create two threats at once.\n" +
"D. CENTER: all else equal, prefer columns nearer the middle (4, then 3/5, then 2/6, then 1/7).\n" +
"Show your A/B/C/D reasoning briefly, then on the FINAL line output exactly:\nCOLUMN: n\n(1-7, a non-full column). Nothing after that line." },
          { role: 'user', content:
"Current board:\n" + x.board + "\n\nYou are " + player.toUpperCase() + " ('" + x.me + "'). Legal columns: " + x.legal + ".\nWork through A→D, then give COLUMN: n." }
        ];
      }
    },

    // (3) terse / low-token — tests whether less prose helps small models & speed
    v3_terse: {
      label: 'v3 · terse',
      description: 'Minimal rules, no reasoning requested — fastest; tests if prose is dead weight.',
      build: function (grid, player) {
        var x = ctx(grid, player);
        return [
          { role: 'system', content:
"Connect Four. You are '" + x.me + "'. Connect four of '" + x.me + "' in a row (any direction) before '" + x.them + "' does. Take an immediate win; otherwise block the opponent's immediate win; otherwise play center. Output ONLY:\nCOLUMN: n" },
          { role: 'user', content:
x.board + "\nYou are '" + x.me + "'. Legal: " + x.legal + ".\nCOLUMN:" }
        ];
      }
    }
  };

  function list() {
    return Object.keys(VARIANTS).map(function (id) {
      return { id: id, label: VARIANTS[id].label, description: VARIANTS[id].description };
    });
  }

  function build(id, grid, player) {
    var v = VARIANTS[id] || VARIANTS.v1_baseline;
    return v.build(grid, player);
  }

  global.C4Prompts = {
    list: list, build: build, parse: parse,
    boardText: boardText, legalColumns: legalColumns, ROWS: ROWS, COLS: COLS
  };
})(window);
