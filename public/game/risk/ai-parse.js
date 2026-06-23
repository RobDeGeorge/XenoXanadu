/* XenoXanadu — Risk: Global Domination
 * ------------------------------------------------------------------
 * ai-parse.js — pure parsing/allocation for the model-driven AI (global
 * RiskAIParse; also module.exports under Node). Kept separate from main.js so
 * it can be unit-tested against real model output with no DOM (test-ai.js).
 *
 * The model only ever returns a NUMBER (or a deploy allocation); these helpers
 * turn its free text into a legal choice. Nothing here mutates game state — the
 * caller applies the result through the engine, which enforces legality.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.RiskAIParse = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Pull a single 1-based choice out of a reply, e.g. "ATTACK: 3" / "I choose 3".
  function parseIndex(reply, token) {
    if (!reply) return null;
    var m = reply.match(new RegExp(token + "\\s*[:#=\\-]?\\s*(\\d+)", "i"));
    if (m) return +m[1];
    var nums = reply.match(/\b\d+\b/g);
    return nums ? +nums[nums.length - 1] : null;
  }

  // Parse a deploy allocation into { territoryIndex(0-based): armies }.
  // Accepts "DEPLOY 1 5", "#1 x5", "1: 5", etc. Prefers lines mentioning
  // "deploy" to avoid picking up stray numbers from an in-character sentence.
  function parseDeploy(reply, n) {
    if (!reply) return null;
    var lines = reply.split(/\n/).filter(function (l) { return /deploy/i.test(l); });
    var src = lines.length ? lines.join("\n") : reply;
    var re = /#?(\d{1,2})\s*(?:x|×|:|=|,|->|\s)\s*(\d{1,3})/gi, m, map = {}, any = false;
    while ((m = re.exec(src))) {
      var idx = +m[1], cnt = +m[2];
      if (idx >= 1 && idx <= n && cnt > 0) { map[idx - 1] = (map[idx - 1] || 0) + cnt; any = true; }
    }
    return any ? map : null;
  }

  // Reconcile a raw allocation map to exactly `R` armies, returning
  // [{ i: territoryIndex, c: armies }] (c > 0). Scales proportionally and
  // fixes rounding so the total is always exactly R. Pure — no state touched.
  function reconcileDeploy(map, R) {
    var entries = Object.keys(map).map(function (k) { return { i: +k, c: map[k] }; });
    var total = entries.reduce(function (s, e) { return s + e.c; }, 0);
    if (total <= 0 || !entries.length) return null;
    entries.forEach(function (e) { e.c = Math.max(0, Math.round(e.c * R / total)); });
    var sum = entries.reduce(function (s, e) { return s + e.c; }, 0), k = 0;
    while (sum < R) { entries[k % entries.length].c++; sum++; k++; }
    while (sum > R) { var e = entries.filter(function (x) { return x.c > 0; })[0]; if (!e) break; e.c--; sum--; }
    return entries.filter(function (e) { return e.c > 0; });
  }

  return { parseIndex: parseIndex, parseDeploy: parseDeploy, reconcileDeploy: reconcileDeploy };
});
