/* ============================================================================
 *  XenoXanadu — Eval logger  (window.XenoEval)
 *  ----------------------------------------------------------------------------
 *  Shared, dependency-free data-collection layer for the AI games — the eval
 *  counterpart to byom.js. Every model decision can be logged as one record;
 *  records persist locally in IndexedDB (never leaves the machine — there is no
 *  XenoXanadu server) and can be exported as JSONL/CSV for offline analysis.
 *
 *  The point is prompt tuning: tag each record with a `variant` id, run a batch,
 *  then summary() tells you which system prompt actually played better, per model.
 *
 *  A record is a flat object; the only fields this layer adds are `id`, `ts`, and
 *  `runId`. Everything else (game, model, variant, board, chosen, grading…) is
 *  whatever the caller logs. Two record `kind`s are conventional:
 *    • 'move' — one model decision (graded against a reference)
 *    • 'game' — one finished game (outcome / result)
 *  summary() understands those, but storage is schema-free.
 * ========================================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'xeno.eval.v1';
  var STORE = 'records';
  var dbp = null;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          os.createIndex('runId', 'runId', { unique: false });
          os.createIndex('kind', 'kind', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(mode) {
    return openDB().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  // Start a logical run (one batch). Returns a runId string the caller threads
  // into every record via log(). runId groups records in the export/summary.
  function newRun(meta) {
    var rid = 'run-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    return Object.assign({ runId: rid, ts: Date.now() }, meta || {});
  }

  // Persist one record. Returns a promise resolving to its assigned id.
  function log(rec) {
    var row = Object.assign({ ts: Date.now() }, rec);
    return tx('readwrite').then(function (os) {
      return new Promise(function (resolve, reject) {
        var req = os.add(row);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function all() {
    return tx('readonly').then(function (os) {
      return new Promise(function (resolve, reject) {
        var req = os.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function clear() {
    return tx('readwrite').then(function (os) {
      return new Promise(function (resolve, reject) {
        var req = os.clear();
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function count() { return all().then(function (r) { return r.length; }); }

  // ---- aggregation ---------------------------------------------------------
  // Groups by game|model|variant. Move records drive accuracy/blunder/latency;
  // game records drive win/draw/loss. Returns an array of per-cell summaries.
  function summary(records) {
    var p = records ? Promise.resolve(records) : all();
    return p.then(function (rows) {
      var cells = {};
      function cell(r) {
        var key = [r.game, r.model, r.variant].join(' | ');
        if (!cells[key]) cells[key] = {
          game: r.game, model: r.model, variant: r.variant,
          moves: 0, optimal: 0, blunders: 0, fallbacks: 0, decisive: 0,
          regretSum: 0, regretN: 0, latSum: 0, latN: 0,
          games: 0, wins: 0, draws: 0, losses: 0
        };
        return cells[key];
      }
      rows.forEach(function (r) {
        if (r.kind === 'move') {
          var c = cell(r);
          c.moves++;
          if (r.optimal) c.optimal++;
          if (r.blunder) c.blunders++;
          if (r.fallback) c.fallbacks++;
          if (r.decisive) c.decisive++;
          if (typeof r.regret === 'number') { c.regretSum += r.regret; c.regretN++; }
          if (typeof r.latencyMs === 'number') { c.latSum += r.latencyMs; c.latN++; }
        } else if (r.kind === 'game') {
          var g = cell(r);
          g.games++;
          if (r.result === 'win') g.wins++;
          else if (r.result === 'draw') g.draws++;
          else if (r.result === 'loss') g.losses++;
        }
      });
      return Object.keys(cells).map(function (k) {
        var c = cells[k];
        return Object.assign(c, {
          optimalRate: c.moves ? c.optimal / c.moves : null,
          blunderRate: c.moves ? c.blunders / c.moves : null,
          fallbackRate: c.moves ? c.fallbacks / c.moves : null,
          avgRegret: c.regretN ? c.regretSum / c.regretN : null,
          avgLatencyMs: c.latN ? Math.round(c.latSum / c.latN) : null,
          winRate: c.games ? c.wins / c.games : null
        });
      });
    });
  }

  // ---- export --------------------------------------------------------------
  function download(name, text, mime) {
    var blob = new global.Blob([text], { type: mime || 'text/plain' });
    var url = global.URL.createObjectURL(blob);
    var a = global.document.createElement('a');
    a.href = url; a.download = name;
    global.document.body.appendChild(a); a.click();
    global.setTimeout(function () { a.remove(); global.URL.revokeObjectURL(url); }, 0);
  }

  function exportJSONL(records) {
    var p = records ? Promise.resolve(records) : all();
    return p.then(function (rows) {
      download('xeno-eval-' + Date.now() + '.jsonl',
        rows.map(function (r) { return JSON.stringify(r); }).join('\n'), 'application/x-ndjson');
      return rows.length;
    });
  }

  function exportCSV(records) {
    var p = records ? Promise.resolve(records) : all();
    return p.then(function (rows) {
      // union of keys, stable-ish order with common columns first
      var lead = ['id', 'ts', 'runId', 'kind', 'game', 'model', 'variant', 'side',
        'gameNo', 'ply', 'chosen', 'best', 'optimal', 'blunder', 'blunderType',
        'regret', 'decisive', 'fallback', 'latencyMs', 'result'];
      var seen = {}; lead.forEach(function (k) { seen[k] = true; });
      var keys = lead.slice();
      rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = true; keys.push(k); } }); });
      function esc(v) {
        if (v == null) return '';
        if (typeof v === 'object') v = JSON.stringify(v);
        v = String(v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }
      var lines = [keys.join(',')];
      rows.forEach(function (r) { lines.push(keys.map(function (k) { return esc(r[k]); }).join(',')); });
      download('xeno-eval-' + Date.now() + '.csv', lines.join('\n'), 'text/csv');
      return rows.length;
    });
  }

  global.XenoEval = {
    newRun: newRun, log: log, all: all, clear: clear, count: count,
    summary: summary, exportJSONL: exportJSONL, exportCSV: exportCSV
  };
})(window);
