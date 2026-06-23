/* XenoXanadu — Risk: Global Domination
 * ------------------------------------------------------------------
 * generals.js — the named-general personality pool (global RiskGenerals).
 *
 * Each general is a strategy profile + a voice. The numeric weights steer
 * the heuristic bot in bots.js (so they play differently even with no model
 * connected); the prompt/voice fields colour what a connected local model
 * says when it narrates the general's turn.
 *
 * Weights (all 0..1 unless noted):
 *   aggression   how readily it attacks vs. banks armies
 *   bravado      how thin a margin it will attack on (low odds tolerance)
 *   expansion    preference for grabbing many territories vs. stacking few
 *   continent    drive to complete & hold whole continents (for the bonus)
 *   vengeance    tendency to focus the current strongest/leading player
 *   targetCont   continent id it covets (bias), or null
 */
(function (root) {
  "use strict";

  var GENERALS = [
    {
      id: "voss",
      name: "Gen. Voss",
      emoji: "VO",
      blurb: "“I take Asia, or I take nothing.”",
      weights: { aggression: 0.74, bravado: 0.5, expansion: 0.45, continent: 0.92, vengeance: 0.3, targetCont: "asia" },
      voice: "a grim, continent-obsessed strategist who speaks in clipped military doctrine and fixates on holding Asia",
      taunts: ["The map bends to patience.", "Your borders are a suggestion.", "Asia is mine by right."],
    },
    {
      id: "fox",
      name: "The Fox",
      emoji: "FX",
      blurb: "Picks off your weakest borders.",
      weights: { aggression: 0.62, bravado: 0.78, expansion: 0.8, continent: 0.35, vengeance: 0.25, targetCont: null },
      voice: "a sly opportunist who hunts thin, undefended borders and gloats about easy pickings",
      taunts: ["One soldier guarding a whole front? How generous.", "I do love a soft border.", "Snip. Snip."],
    },
    {
      id: "ironwall",
      name: "Ironwall",
      emoji: "IW",
      blurb: "Fortifies, then punishes overreach.",
      weights: { aggression: 0.32, bravado: 0.28, expansion: 0.4, continent: 0.7, vengeance: 0.35, targetCont: "australia" },
      voice: "a defensive tactician who stacks deep, rarely overcommits, and lectures about overreach",
      taunts: ["Throw yourself at the wall. I'll wait.", "Aggression is a loan. The interest is steep.", "Hold. Always hold."],
    },
    {
      id: "blaze",
      name: "Marshal Blaze",
      emoji: "BZ",
      blurb: "All gas, no brakes — blitz everything.",
      weights: { aggression: 0.95, bravado: 0.9, expansion: 0.7, continent: 0.4, vengeance: 0.45, targetCont: null },
      voice: "a reckless blitzer who attacks on almost any odds and treats caution as cowardice",
      taunts: ["Forward! Always forward!", "Dice are just a formality.", "I'll sleep when the map is red."],
    },
    {
      id: "sphinx",
      name: "The Sphinx",
      emoji: "SX",
      blurb: "Quietly hoards Africa & cards.",
      weights: { aggression: 0.5, bravado: 0.45, expansion: 0.55, continent: 0.85, vengeance: 0.2, targetCont: "africa" },
      voice: "an inscrutable hoarder who covets Africa, banks card sets, and speaks in riddles",
      taunts: ["Patience is a kind of army.", "The desert keeps its secrets.", "I am counting. You are not."],
    },
    {
      id: "tunder",
      name: "Baroness Tundra",
      emoji: "BT",
      blurb: "Locks down the Americas.",
      weights: { aggression: 0.58, bravado: 0.55, expansion: 0.66, continent: 0.8, vengeance: 0.3, targetCont: "north-america" },
      voice: "a cold, methodical conqueror who walls off the Americas and advances like a glacier",
      taunts: ["The new world is mine.", "Two chokepoints. That's all it takes.", "Winter does not negotiate."],
    },
    {
      id: "hydra",
      name: "Hydra",
      emoji: "HY",
      blurb: "Targets whoever's winning.",
      weights: { aggression: 0.7, bravado: 0.6, expansion: 0.6, continent: 0.45, vengeance: 0.92, targetCont: null },
      voice: "a vindictive kingmaker who hunts the current leader and rallies the board against them",
      taunts: ["Cut off the head…", "The biggest crown makes the biggest target.", "We don't like winners here."],
    },
    {
      id: "automaton",
      name: "Automaton-7",
      emoji: "A7",
      blurb: "Cold expected-value machine.",
      weights: { aggression: 0.6, bravado: 0.4, expansion: 0.62, continent: 0.6, vengeance: 0.4, targetCont: null },
      voice: "a flat, emotionless optimizer that reports probabilities and expected value with zero affect",
      taunts: ["Probability of your survival: declining.", "Computing optimal aggression.", "Sentiment: irrelevant. Odds: favorable."],
    },
  ];

  function byId(id) { return GENERALS.filter(function (g) { return g.id === id; })[0] || null; }

  // Pick `n` distinct generals at random (for filling AI seats).
  function pick(n) {
    var pool = GENERALS.slice();
    for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    return pool.slice(0, n);
  }

  root.RiskGenerals = { ALL: GENERALS, byId: byId, pick: pick };
})(typeof self !== "undefined" ? self : this);
