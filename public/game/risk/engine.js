/* XenoXanadu — Risk: Global Domination
 * ------------------------------------------------------------------
 * engine.js — the pure, DOM-free rules core + the canonical world map.
 *
 * This is the single source of truth for BOTH the rules and the map
 * geometry: every territory carries its continent, adjacency list, and
 * an (x,y) layout anchor used by main.js to draw the low-poly board.
 *
 * It runs unchanged in the browser (global `window.RiskEngine`) and under
 * Node (`module.exports`) — the bottom of the file has a self-check that
 * fires with `node engine.js`, validating that adjacency is symmetric and
 * the continents partition all 42 territories.
 *
 * Nothing here touches the DOM, the network, or localStorage. The UI
 * (main.js) and the bots (bots.js) drive the same functions, so a move is
 * legal for a human, a heuristic bot, or a local model alike.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.RiskEngine = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------
  //  CLASSIC_CONTINENTS — name, army bonus for holding the whole
  //  continent, and a signature hue used to tint its territories.
  //  (This is the built-in default map; maps.js registers more.)
  // ---------------------------------------------------------------
  var CLASSIC_CONTINENTS = {
    "north-america": { name: "North America", bonus: 5, color: "#c7a24a" },
    "south-america": { name: "South America", bonus: 2, color: "#6dbf95" },
    "europe":        { name: "Europe",        bonus: 5, color: "#6f9bd1" },
    "africa":        { name: "Africa",        bonus: 3, color: "#cf8a52" },
    "asia":          { name: "Asia",          bonus: 7, color: "#c06a9b" },
    "australia":     { name: "Australia",     bonus: 2, color: "#c86d92" },
  };

  // ---------------------------------------------------------------
  //  CLASSIC_TERRITORIES — id → { name, cont, x, y, adj[] }
  //  x,y are layout anchors on a 1000 × 640 canvas (geographic-ish).
  //  adj is the canonical Risk adjacency (verified symmetric below).
  // ---------------------------------------------------------------
  var CLASSIC_TERRITORIES = {
    // ---- North America ----
    alaska:      { name: "Alaska",               cont: "north-america", x: 70,  y: 90,  adj: ["northwest-territory", "alberta", "kamchatka"] },
    "northwest-territory": { name: "NW Territory", cont: "north-america", x: 165, y: 88, adj: ["alaska", "alberta", "ontario", "greenland"] },
    greenland:   { name: "Greenland",             cont: "north-america", x: 330, y: 64,  adj: ["northwest-territory", "ontario", "quebec", "iceland"] },
    alberta:     { name: "Alberta",               cont: "north-america", x: 140, y: 162, adj: ["alaska", "northwest-territory", "ontario", "western-us"] },
    ontario:     { name: "Ontario",               cont: "north-america", x: 225, y: 160, adj: ["alberta", "northwest-territory", "greenland", "quebec", "western-us", "eastern-us"] },
    quebec:      { name: "Quebec",                cont: "north-america", x: 305, y: 162, adj: ["greenland", "ontario", "eastern-us"] },
    "western-us": { name: "Western US",           cont: "north-america", x: 150, y: 238, adj: ["alberta", "ontario", "eastern-us", "central-america"] },
    "eastern-us": { name: "Eastern US",           cont: "north-america", x: 245, y: 240, adj: ["western-us", "ontario", "quebec", "central-america"] },
    "central-america": { name: "C. America",      cont: "north-america", x: 185, y: 312, adj: ["western-us", "eastern-us", "venezuela"] },

    // ---- South America ----
    venezuela:   { name: "Venezuela",             cont: "south-america", x: 258, y: 392, adj: ["central-america", "peru", "brazil"] },
    peru:        { name: "Peru",                  cont: "south-america", x: 245, y: 472, adj: ["venezuela", "brazil", "argentina"] },
    brazil:      { name: "Brazil",                cont: "south-america", x: 335, y: 462, adj: ["venezuela", "peru", "argentina", "north-africa"] },
    argentina:   { name: "Argentina",             cont: "south-america", x: 272, y: 566, adj: ["peru", "brazil"] },

    // ---- Europe ----
    iceland:     { name: "Iceland",               cont: "europe", x: 432, y: 112, adj: ["greenland", "great-britain", "scandinavia"] },
    "great-britain": { name: "Great Britain",     cont: "europe", x: 432, y: 192, adj: ["iceland", "scandinavia", "northern-europe", "western-europe"] },
    scandinavia: { name: "Scandinavia",           cont: "europe", x: 522, y: 98,  adj: ["iceland", "great-britain", "northern-europe", "ukraine"] },
    "northern-europe": { name: "N. Europe",       cont: "europe", x: 533, y: 178, adj: ["great-britain", "scandinavia", "ukraine", "southern-europe", "western-europe"] },
    "western-europe": { name: "W. Europe",        cont: "europe", x: 470, y: 256, adj: ["great-britain", "northern-europe", "southern-europe", "north-africa"] },
    "southern-europe": { name: "S. Europe",       cont: "europe", x: 560, y: 244, adj: ["western-europe", "northern-europe", "ukraine", "middle-east", "egypt", "north-africa"] },
    ukraine:     { name: "Ukraine",               cont: "europe", x: 628, y: 142, adj: ["scandinavia", "northern-europe", "southern-europe", "ural", "afghanistan", "middle-east"] },

    // ---- Africa ----
    "north-africa": { name: "North Africa",       cont: "africa", x: 492, y: 352, adj: ["brazil", "western-europe", "southern-europe", "egypt", "east-africa", "congo"] },
    egypt:       { name: "Egypt",                 cont: "africa", x: 578, y: 332, adj: ["southern-europe", "north-africa", "east-africa", "middle-east"] },
    "east-africa": { name: "East Africa",         cont: "africa", x: 622, y: 412, adj: ["egypt", "north-africa", "congo", "south-africa", "madagascar", "middle-east"] },
    congo:       { name: "Congo",                 cont: "africa", x: 560, y: 432, adj: ["north-africa", "east-africa", "south-africa"] },
    "south-africa": { name: "South Africa",       cont: "africa", x: 576, y: 522, adj: ["congo", "east-africa", "madagascar"] },
    madagascar:  { name: "Madagascar",            cont: "africa", x: 656, y: 512, adj: ["east-africa", "south-africa"] },

    // ---- Asia ----
    ural:        { name: "Ural",                  cont: "asia", x: 702, y: 132, adj: ["ukraine", "siberia", "china", "afghanistan"] },
    siberia:     { name: "Siberia",               cont: "asia", x: 762, y: 92,  adj: ["ural", "yakutsk", "irkutsk", "mongolia", "china"] },
    yakutsk:     { name: "Yakutsk",               cont: "asia", x: 842, y: 70,  adj: ["siberia", "irkutsk", "kamchatka"] },
    kamchatka:   { name: "Kamchatka",             cont: "asia", x: 932, y: 92,  adj: ["yakutsk", "irkutsk", "mongolia", "japan", "alaska"] },
    irkutsk:     { name: "Irkutsk",               cont: "asia", x: 822, y: 152, adj: ["siberia", "yakutsk", "kamchatka", "mongolia"] },
    mongolia:    { name: "Mongolia",              cont: "asia", x: 822, y: 218, adj: ["siberia", "irkutsk", "kamchatka", "japan", "china"] },
    japan:       { name: "Japan",                 cont: "asia", x: 942, y: 202, adj: ["kamchatka", "mongolia"] },
    afghanistan: { name: "Afghanistan",           cont: "asia", x: 712, y: 222, adj: ["ukraine", "ural", "china", "india", "middle-east"] },
    china:       { name: "China",                 cont: "asia", x: 792, y: 272, adj: ["ural", "siberia", "mongolia", "afghanistan", "india", "siam"] },
    "middle-east": { name: "Middle East",         cont: "asia", x: 662, y: 288, adj: ["ukraine", "southern-europe", "egypt", "east-africa", "afghanistan", "india"] },
    india:       { name: "India",                 cont: "asia", x: 748, y: 322, adj: ["afghanistan", "china", "middle-east", "siam"] },
    siam:        { name: "Siam",                  cont: "asia", x: 832, y: 342, adj: ["china", "india", "indonesia"] },

    // ---- Australia ----
    indonesia:   { name: "Indonesia",             cont: "australia", x: 822, y: 422, adj: ["siam", "new-guinea", "western-australia"] },
    "new-guinea": { name: "New Guinea",           cont: "australia", x: 918, y: 416, adj: ["indonesia", "western-australia", "eastern-australia"] },
    "western-australia": { name: "W. Australia",  cont: "australia", x: 838, y: 522, adj: ["indonesia", "new-guinea", "eastern-australia"] },
    "eastern-australia": { name: "E. Australia",  cont: "australia", x: 922, y: 512, adj: ["new-guinea", "western-australia"] },
  };

  // ---------------------------------------------------------------
  //  CLASSIC_MAP — the built-in default. maps.js (browser) registers
  //  this one plus several "fun" non-geographic boards. Anything the
  //  renderer needs that is map-specific lives here: canvas size, the
  //  default territory polygon radius, per-continent label nudges, and
  //  any wrap-around edges drawn along the top of the board.
  // ---------------------------------------------------------------
  var CLASSIC_MAP = {
    id: "classic",
    name: "Global Domination",
    blurb: "The classic 42-territory world — six continents, sea routes, and the Alaska–Kamchatka wrap.",
    width: 1000, height: 640, terrRadius: 38,
    startArmies: { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 },
    wrapEdges: [["alaska", "kamchatka"]],
    labelNudge: {
      asia: { y: 50 }, "north-america": { x: 95, y: 300 }, europe: { y: 64 },
      africa: { x: 510, y: 470 }, "south-america": { y: 600 }, australia: { y: 588 },
    },
    continents: CLASSIC_CONTINENTS,
    territories: CLASSIC_TERRITORIES,
  };

  // Player palette — 6 distinct neon hues.
  var PLAYER_COLORS = ["#5fa8b8", "#cf5a52", "#a6c46a", "#c7a24a", "#9b86c4", "#cf8a52"];

  // --- LIVE MAP STATE -------------------------------------------------
  //  These are the variables every rules function reads. They are filled
  //  by installMap() (called once below for the default map, and again by
  //  newGame{map} / the UI when a different board is chosen). Because the
  //  closures capture the *binding*, reassigning here re-points the whole
  //  engine at a new map with no other code change.
  var currentMap, CONTINENTS, T, TERRITORY_IDS, CONTINENT_IDS, CONT_MEMBERS, START_ARMIES;

  // A reasonable starting-army table for a board with `nTerr` territories,
  // used only when a map doesn't ship its own `startArmies`.
  function defaultStartArmies(nTerr) {
    var o = {};
    for (var n = 2; n <= 6; n++) {
      o[n] = Math.max(Math.ceil(nTerr / n) + 3, Math.round((nTerr * 2.4) / n));
    }
    return o;
  }

  // Validate a map definition: continents partition, adjacency symmetric,
  // no dangling/self edges, and the whole board is one connected component.
  function validateMap(def) {
    if (!def || typeof def !== "object") return ["map is not an object"];
    var p = [];
    var C = def.continents, TT = def.territories;
    if (!C || typeof C !== "object") p.push("missing continents");
    if (!TT || typeof TT !== "object") p.push("missing territories");
    if (p.length) return p;
    var ids = Object.keys(TT), cids = Object.keys(C);
    if (!ids.length) return ["no territories"];
    ids.forEach(function (id) {
      var t = TT[id];
      if (!t.cont || !C[t.cont]) p.push(id + " → unknown continent " + t.cont);
      if (typeof t.x !== "number" || typeof t.y !== "number") p.push(id + " missing x/y");
      if (!Array.isArray(t.adj) || !t.adj.length) { p.push(id + " has no adjacency"); return; }
      t.adj.forEach(function (nb) {
        if (nb === id) p.push(id + " adjacent to itself");
        else if (!TT[nb]) p.push(id + " → unknown " + nb);
        else if (TT[nb].adj.indexOf(id) < 0) p.push("asymmetric: " + id + " ↔ " + nb);
      });
    });
    cids.forEach(function (c) {
      if (!ids.some(function (id) { return TT[id].cont === c; })) p.push("empty continent " + c);
    });
    // connectivity — flood fill from the first territory must reach them all
    var seen = {}, stack = [ids[0]], reached = 0;
    seen[ids[0]] = true;
    while (stack.length) {
      var cur = stack.pop(); reached++;
      (TT[cur].adj || []).forEach(function (nb) { if (TT[nb] && !seen[nb]) { seen[nb] = true; stack.push(nb); } });
    }
    if (reached !== ids.length) p.push("map not fully connected (" + reached + "/" + ids.length + " reachable)");
    return p;
  }

  // Install a map as the active board. Recomputes the derived tables and
  // re-points the public api at them so external consumers (main.js, bots)
  // that read `RiskEngine.T` / `.CONT_MEMBERS` pick up the new map for free.
  function installMap(def) {
    var problems = validateMap(def);
    if (problems.length) throw new Error("Invalid map '" + (def && def.id) + "': " + problems.join("; "));
    currentMap = def;
    CONTINENTS = def.continents;
    T = def.territories;
    TERRITORY_IDS = Object.keys(T);
    CONTINENT_IDS = Object.keys(CONTINENTS);
    CONT_MEMBERS = {};
    CONTINENT_IDS.forEach(function (c) { CONT_MEMBERS[c] = []; });
    TERRITORY_IDS.forEach(function (id) { CONT_MEMBERS[T[id].cont].push(id); });
    START_ARMIES = def.startArmies || defaultStartArmies(TERRITORY_IDS.length);
    if (typeof api === "object" && api) {
      api.CONTINENTS = CONTINENTS; api.T = T;
      api.TERRITORY_IDS = TERRITORY_IDS; api.CONTINENT_IDS = CONTINENT_IDS;
      api.CONT_MEMBERS = CONT_MEMBERS; api.START_ARMIES = START_ARMIES;
      api.currentMap = currentMap;
    }
    return def;
  }

  // Card set trade-in values: 4,6,8,10,12,15 then +5 each.
  function setValue(tradeIndex) {
    var base = [4, 6, 8, 10, 12, 15];
    return tradeIndex < base.length ? base[tradeIndex] : 15 + (tradeIndex - 5) * 5;
  }

  // ---------------------------------------------------------------
  //  Small helpers
  // ---------------------------------------------------------------
  function rngInt(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = rngInt(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function rollDie() { return rngInt(6) + 1; }

  // ---------------------------------------------------------------
  //  Card deck — one card per territory (cycling Infantry/Cavalry/
  //  Artillery) plus two wilds. A set is 3-same, 3-different, or any
  //  pair-with-wild.
  // ---------------------------------------------------------------
  var SYMBOLS = ["infantry", "cavalry", "artillery"];
  function buildDeck() {
    var deck = TERRITORY_IDS.map(function (id, i) { return { terr: id, sym: SYMBOLS[i % 3] }; });
    deck.push({ terr: null, sym: "wild" });
    deck.push({ terr: null, sym: "wild" });
    return shuffle(deck);
  }

  // Is a 3-card combo a valid set?
  function isSet(cards) {
    if (cards.length !== 3) return false;
    var wild = cards.filter(function (c) { return c.sym === "wild"; }).length;
    if (wild >= 1) return true; // a wild completes any pair → always a set
    var s = cards.map(function (c) { return c.sym; });
    var allSame = s[0] === s[1] && s[1] === s[2];
    var allDiff = s[0] !== s[1] && s[1] !== s[2] && s[0] !== s[2];
    return allSame || allDiff;
  }

  // Find the first valid 3-card set in a hand (indices), or null.
  function findSet(hand) {
    for (var a = 0; a < hand.length; a++)
      for (var b = a + 1; b < hand.length; b++)
        for (var c = b + 1; c < hand.length; c++)
          if (isSet([hand[a], hand[b], hand[c]])) return [a, b, c];
    return null;
  }

  // ---------------------------------------------------------------
  //  Game construction
  // ---------------------------------------------------------------
  // players: [{ name, isHuman, general }]  (color is assigned here)
  function newGame(opts) {
    opts = opts || {};
    if (opts.map) installMap(opts.map); // switch boards before dealing
    var defs = opts.players || [
      { name: "You", isHuman: true },
      { name: "Bot", isHuman: false },
    ];
    var n = defs.length;
    if (n < 2 || n > 6) throw new Error("Risk supports 2–6 players");

    var players = defs.map(function (d, i) {
      return {
        id: i,
        name: d.name || "Player " + (i + 1),
        color: d.color || PLAYER_COLORS[i],
        isHuman: !!d.isHuman,
        general: d.general || null,
        alive: true,
        cards: [],
      };
    });

    var state = {
      players: players,
      terr: {}, // id → { owner, armies }
      turn: 0,
      phase: "reinforce",
      reinforcements: 0,
      setupRemaining: null,     // [pid]→armies left to place (manual setup only)
      deck: buildDeck(),
      discard: [],
      setsTraded: 0,
      conqueredThisTurn: false, // earns a card at end of turn
      lastConquest: null,       // { from, to, minMove, maxMove } awaiting army move
      pendingElimination: [],   // ids eliminated this action (for UI)
      winner: null,
      started: false,
      log: [],
    };

    var startTotal = START_ARMIES[n];

    // --- MANUAL SETUP: a true draft. The whole board starts UNCLAIMED
    //     (owner null, 0 armies). Players take turns, in seating order,
    //     first CLAIMING empty territories (one army each); once every
    //     territory is owned, the remaining armies STACK onto owned land.
    //     The entire starting pool is placed by hand, one army at a time. ---
    if (opts.manualSetup) {
      TERRITORY_IDS.forEach(function (id) { state.terr[id] = { owner: null, armies: 0 }; });
      state.setupRemaining = players.map(function () { return startTotal; });
      state.phase = "setup";
      state.turn = 0;
      state.started = true;
      log(state, "Claim the map — drop one army on an empty territory, in turn order.");
      return state;
    }

    // --- distribute territories round-robin over a shuffled order ---
    var order = shuffle(TERRITORY_IDS.slice());
    order.forEach(function (id, i) {
      state.terr[id] = { owner: i % n, armies: 1 };
    });

    // --- AUTO: scatter each player's remaining starting armies over their land ---
    players.forEach(function (p) {
      var owned = TERRITORY_IDS.filter(function (id) { return state.terr[id].owner === p.id; });
      var left = startTotal - owned.length; // 1 already placed on each
      while (left-- > 0) state.terr[owned[rngInt(owned.length)]].armies++;
    });

    state.started = true;
    beginTurn(state, 0);
    log(state, "Game on — " + n + " players. " + players[0].name + " moves first.");
    return state;
  }

  function log(state, msg) {
    state.log.push(msg);
    if (state.log.length > 200) state.log.shift();
    return msg;
  }

  // ---------------------------------------------------------------
  //  Ownership / scoring queries
  // ---------------------------------------------------------------
  function ownedBy(state, pid) {
    return TERRITORY_IDS.filter(function (id) { return state.terr[id].owner === pid; });
  }
  function ownsContinent(state, pid, cont) {
    return CONT_MEMBERS[cont].every(function (id) { return state.terr[id].owner === pid; });
  }
  function ownedContinents(state, pid) {
    return CONTINENT_IDS.filter(function (c) { return ownsContinent(state, pid, c); });
  }
  function armyTotal(state, pid) {
    return ownedBy(state, pid).reduce(function (s, id) { return s + state.terr[id].armies; }, 0);
  }

  // Reinforcements a player would receive at the start of their turn:
  // max(3, floor(territories/3)) + continent bonuses.
  function reinforcementCount(state, pid) {
    var lands = ownedBy(state, pid).length;
    var base = Math.max(3, Math.floor(lands / 3));
    var bonus = ownedContinents(state, pid).reduce(function (s, c) { return s + CONTINENTS[c].bonus; }, 0);
    return base + bonus;
  }

  // ---------------------------------------------------------------
  //  Turn / phase flow
  // ---------------------------------------------------------------
  function beginTurn(state, pid) {
    state.turn = pid;
    state.phase = "reinforce";
    state.reinforcements = reinforcementCount(state, pid);
    state.conqueredThisTurn = false;
    state.lastConquest = null;
  }

  function currentPlayer(state) { return state.players[state.turn]; }

  // A player MUST trade if holding 5+ cards (at the start of reinforce).
  function mustTrade(state, pid) {
    return state.players[pid].cards.length >= 5;
  }

  // Advance to the next phase / next living player's turn.
  // Order: reinforce → attack → fortify → (award card) → next turn.
  function endPhase(state) {
    if (state.phase === "reinforce") {
      // can't leave reinforce with armies still to place
      if (state.reinforcements > 0) return false;
      if (mustTrade(state, state.turn)) return false; // forced to trade first
      state.phase = "attack";
      return true;
    }
    if (state.phase === "attack") {
      if (state.lastConquest) return false; // must resolve the army move first
      state.phase = "fortify";
      return true;
    }
    if (state.phase === "fortify") {
      finishTurn(state);
      return true;
    }
    return false;
  }

  // End of a player's turn: award a card if they conquered, then pass on.
  function finishTurn(state) {
    if (state.conqueredThisTurn && state.deck.length) {
      var card = state.deck.pop();
      currentPlayer(state).cards.push(card);
      log(state, currentPlayer(state).name + " earned a card for conquering.");
    }
    if (state.winner != null) { state.phase = "gameover"; return; }
    var next = nextLivingPlayer(state, state.turn);
    if (next == null) { state.phase = "gameover"; return; }
    beginTurn(state, next);
  }

  function nextLivingPlayer(state, from) {
    var n = state.players.length;
    for (var k = 1; k <= n; k++) {
      var pid = (from + k) % n;
      if (state.players[pid].alive) return pid;
    }
    return null;
  }

  // ---------------------------------------------------------------
  //  Manual setup — place starting armies one at a time, alternating.
  // ---------------------------------------------------------------
  // Total armies still waiting to be placed across all players.
  function setupArmiesLeft(state) {
    return (state.setupRemaining || []).reduce(function (s, x) { return s + Math.max(0, x); }, 0);
  }
  // Next player (in seating order) who still has setup armies to place.
  function nextSetupPlayer(state, from) {
    var n = state.players.length;
    for (var k = 1; k <= n; k++) {
      var pid = (from + k) % n;
      if (state.players[pid].alive && state.setupRemaining[pid] > 0) return pid;
    }
    return null;
  }
  // Current player drops ONE army, then the turn passes to the next player
  // with armies left. While the board still has empty land, a placement must
  // CLAIM an unowned territory; once the map is full, players STACK onto land
  // they already own. When every pool is empty the game proper begins
  // (player 0's reinforcement phase).
  function placeSetupArmy(state, id) {
    if (state.phase !== "setup") return err("Not the setup phase");
    if (!(state.setupRemaining[state.turn] > 0)) return err("No armies left to place");
    var cell = state.terr[id];
    var anyUnclaimed = TERRITORY_IDS.some(function (tid) { return state.terr[tid].owner == null; });
    if (cell.owner == null) {
      cell.owner = state.turn; // claim an empty territory
      cell.armies = 1;
    } else if (anyUnclaimed) {
      return err("Claim an empty territory first");
    } else if (cell.owner !== state.turn) {
      return err("You don't own that territory");
    } else {
      cell.armies++;
    }
    state.setupRemaining[state.turn]--;
    var next = nextSetupPlayer(state, state.turn);
    if (next == null) {
      log(state, "All armies placed — the campaign begins.");
      beginTurn(state, 0);
      return ok({ done: true, left: 0 });
    }
    state.turn = next;
    return ok({ done: false, left: setupArmiesLeft(state) });
  }

  // ---------------------------------------------------------------
  //  Reinforce — place armies, trade card sets
  // ---------------------------------------------------------------
  function placeArmies(state, id, count) {
    if (state.phase !== "reinforce") return err("Not the reinforcement phase");
    if (state.terr[id].owner !== state.turn) return err("You don't own that territory");
    count = Math.max(1, Math.min(count || 1, state.reinforcements));
    if (count <= 0) return err("No reinforcements left");
    state.terr[id].armies += count;
    state.reinforcements -= count;
    return ok({ placed: count, left: state.reinforcements });
  }

  // Trade a 3-card set (array of indices into the player's hand) for armies.
  function tradeCards(state, idxs) {
    var p = currentPlayer(state);
    if (state.phase !== "reinforce") return err("Trade during reinforcement");
    if (!idxs || idxs.length !== 3) return err("A set is exactly 3 cards");
    var cards = idxs.map(function (i) { return p.cards[i]; });
    if (cards.some(function (c) { return !c; })) return err("Bad card selection");
    if (!isSet(cards)) return err("Those 3 cards aren't a valid set");
    var value = setValue(state.setsTraded);
    state.setsTraded++;
    // remove the 3 cards (high→low so indices stay valid), recycle to discard
    idxs.slice().sort(function (a, b) { return b - a; }).forEach(function (i) {
      state.discard.push(p.cards.splice(i, 1)[0]);
    });
    // +2 territory bonus: if you own a territory pictured on a traded card,
    // reinforce it directly (classic rule, capped at one).
    var bonusTerr = null;
    cards.some(function (c) {
      if (c.terr && state.terr[c.terr].owner === p.id) { bonusTerr = c.terr; return true; }
      return false;
    });
    if (bonusTerr) state.terr[bonusTerr].armies += 2;
    state.reinforcements += value;
    log(state, p.name + " traded a set for " + value + " armies" + (bonusTerr ? " (+2 on " + T[bonusTerr].name + ")" : "") + ".");
    return ok({ value: value, bonusTerr: bonusTerr });
  }

  // ---------------------------------------------------------------
  //  Attack
  // ---------------------------------------------------------------
  // Every legal attack for the current player: from own land with 2+ armies
  // to an adjacent enemy.
  function listAttacks(state) {
    var pid = state.turn, out = [];
    ownedBy(state, pid).forEach(function (from) {
      if (state.terr[from].armies < 2) return;
      T[from].adj.forEach(function (to) {
        if (state.terr[to].owner !== pid) out.push({ from: from, to: to });
      });
    });
    return out;
  }

  function canAttack(state, from, to) {
    if (state.phase !== "attack") return false;
    if (state.terr[from].owner !== state.turn) return false;
    if (state.terr[from].armies < 2) return false;
    if (T[from].adj.indexOf(to) < 0) return false;
    return state.terr[to].owner !== state.turn;
  }

  // One assault: attacker rolls min(3, armies-1) dice, defender min(2, armies).
  // Returns { aDice, dDice, attackerLoss, defenderLoss, conquered }.
  function rollAttack(state, from, to) {
    if (!canAttack(state, from, to)) return err("Illegal attack");
    var atk = state.terr[from], def = state.terr[to];
    var aN = Math.min(3, atk.armies - 1);
    var dN = Math.min(2, def.armies);
    var aRolls = []; for (var i = 0; i < aN; i++) aRolls.push(rollDie());
    var dRolls = []; for (var j = 0; j < dN; j++) dRolls.push(rollDie());
    var aSort = aRolls.slice().sort(function (a, b) { return b - a; });
    var dSort = dRolls.slice().sort(function (a, b) { return b - a; });
    var aLoss = 0, dLoss = 0;
    var pairs = Math.min(aSort.length, dSort.length);
    for (var k = 0; k < pairs; k++) {
      if (aSort[k] > dSort[k]) dLoss++; else aLoss++; // ties → defender
    }
    atk.armies -= aLoss;
    def.armies -= dLoss;
    var conquered = false;
    if (def.armies <= 0) {
      conquered = true;
      captureTerritory(state, from, to, aN);
    }
    return ok({ aRolls: aRolls, dRolls: dRolls, attackerLoss: aLoss, defenderLoss: dLoss, conquered: conquered });
  }

  // Defender hit 0: attacker takes the land; must move at least the number of
  // dice they last rolled (and at least 1), up to armies-1. We stage the move
  // as `lastConquest` for the UI/bot to finalise via moveAfterConquest().
  function captureTerritory(state, from, to, aDice) {
    var loserId = state.terr[to].owner;
    state.terr[to].owner = state.turn;
    state.terr[to].armies = 0;
    state.conqueredThisTurn = true;
    var maxMove = state.terr[from].armies - 1;
    var minMove = Math.min(Math.max(aDice, 1), maxMove);
    state.lastConquest = { from: from, to: to, minMove: minMove, maxMove: maxMove };
    log(state, currentPlayer(state).name + " took " + T[to].name + ".");
    handleElimination(state, loserId);
    checkWin(state);
  }

  // Finalise the post-conquest army move (also auto-called with min if skipped).
  function moveAfterConquest(state, count) {
    var c = state.lastConquest;
    if (!c) return err("No conquest awaiting a move");
    count = Math.max(c.minMove, Math.min(count == null ? c.minMove : count, c.maxMove));
    state.terr[c.from].armies -= count;
    state.terr[c.to].armies += count;
    state.lastConquest = null;
    return ok({ moved: count });
  }

  // When a player loses their last territory: hand their cards to the conqueror
  // and mark them out. (Classic rule: capturing cards can force an immediate
  // extra trade if you exceed 6 — we let the next reinforce handle it.)
  function handleElimination(state, loserId) {
    if (loserId == null || loserId === state.turn) return;
    if (ownedBy(state, loserId).length > 0) return;
    var loser = state.players[loserId];
    if (!loser.alive) return;
    loser.alive = false;
    var taker = currentPlayer(state);
    if (loser.cards.length) {
      taker.cards = taker.cards.concat(loser.cards);
      loser.cards = [];
      log(state, taker.name + " eliminated " + loser.name + " and seized their cards.");
    } else {
      log(state, taker.name + " eliminated " + loser.name + ".");
    }
    state.pendingElimination.push(loserId);
  }

  function checkWin(state) {
    var alive = state.players.filter(function (p) { return p.alive; });
    if (alive.length === 1) { state.winner = alive[0].id; return; }
    // total domination also ends it (covered by the above once others die)
    var first = state.terr[TERRITORY_IDS[0]].owner;
    var solo = TERRITORY_IDS.every(function (id) { return state.terr[id].owner === first; });
    if (solo) state.winner = first;
  }

  // ---------------------------------------------------------------
  //  Fortify — one move per turn, between two of your territories that
  //  are connected through a chain of territories you own.
  // ---------------------------------------------------------------
  function connectedOwn(state, from) {
    var pid = state.terr[from].owner;
    var seen = {}, stack = [from], out = [];
    seen[from] = true;
    while (stack.length) {
      var cur = stack.pop();
      T[cur].adj.forEach(function (nb) {
        if (!seen[nb] && state.terr[nb].owner === pid) {
          seen[nb] = true; out.push(nb); stack.push(nb);
        }
      });
    }
    return out; // excludes `from`
  }

  function canFortify(state, from, to) {
    if (state.phase !== "fortify") return false;
    if (from === to) return false;
    if (state.terr[from].owner !== state.turn || state.terr[to].owner !== state.turn) return false;
    if (state.terr[from].armies < 2) return false;
    return connectedOwn(state, from).indexOf(to) >= 0;
  }

  function fortify(state, from, to, count) {
    if (!canFortify(state, from, to)) return err("Illegal fortify");
    var maxMove = state.terr[from].armies - 1;
    count = Math.max(1, Math.min(count || maxMove, maxMove));
    state.terr[from].armies -= count;
    state.terr[to].armies += count;
    log(state, currentPlayer(state).name + " fortified " + T[to].name + " with " + count + ".");
    finishTurn(state);
    return ok({ moved: count });
  }

  // Skip fortifying — just end the turn.
  function skipFortify(state) {
    if (state.phase !== "fortify") return err("Not the fortify phase");
    finishTurn(state);
    return ok({});
  }

  // ---------------------------------------------------------------
  //  Result helpers
  // ---------------------------------------------------------------
  function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
  function err(msg) { return { ok: false, error: msg }; }

  // ---------------------------------------------------------------
  //  Public surface
  // ---------------------------------------------------------------
  var api = {
    CONTINENTS: CONTINENTS, CONTINENT_IDS: CONTINENT_IDS, CONT_MEMBERS: CONT_MEMBERS,
    T: T, TERRITORY_IDS: TERRITORY_IDS, PLAYER_COLORS: PLAYER_COLORS, START_ARMIES: START_ARMIES,
    CLASSIC_MAP: CLASSIC_MAP, currentMap: currentMap, installMap: installMap, validateMap: validateMap,
    newGame: newGame,
    reinforcementCount: reinforcementCount,
    ownedBy: ownedBy, ownsContinent: ownsContinent, ownedContinents: ownedContinents, armyTotal: armyTotal,
    beginTurn: beginTurn, endPhase: endPhase, finishTurn: finishTurn, nextLivingPlayer: nextLivingPlayer,
    placeSetupArmy: placeSetupArmy, nextSetupPlayer: nextSetupPlayer, setupArmiesLeft: setupArmiesLeft,
    currentPlayer: currentPlayer, mustTrade: mustTrade,
    placeArmies: placeArmies, tradeCards: tradeCards, isSet: isSet, findSet: findSet, setValue: setValue,
    listAttacks: listAttacks, canAttack: canAttack, rollAttack: rollAttack, moveAfterConquest: moveAfterConquest,
    connectedOwn: connectedOwn, canFortify: canFortify, fortify: fortify, skipFortify: skipFortify,
    log: log,
  };

  // Install the built-in default map now that `api` exists (so the derived
  // tables and the api references are populated before anyone calls newGame).
  installMap(CLASSIC_MAP);

  // ---------------------------------------------------------------
  //  Self-check — `node engine.js` validates the active map.
  // ---------------------------------------------------------------
  function selfCheck() { return validateMap(currentMap); }
  api.selfCheck = selfCheck;

  if (typeof module === "object" && module.exports && require.main === module) {
    var probs = selfCheck();
    if (probs.length) { console.error("✗ map problems:\n" + probs.join("\n")); process.exit(1); }
    console.log("✓ Risk map OK — " + currentMap.name + ": " + TERRITORY_IDS.length +
                " territories, " + CONTINENT_IDS.length + " continents, adjacency symmetric.");
    // quick smoke: play 50 random turns without throwing
    var s = newGame({ players: [{ name: "A", isHuman: false }, { name: "B", isHuman: false }, { name: "C", isHuman: false }] });
    for (var t = 0; t < 400 && s.winner == null; t++) {
      if (s.phase === "reinforce") { var land = ownedBy(s, s.turn); placeArmies(s, land[0], s.reinforcements); endPhase(s); }
      else if (s.phase === "attack") {
        var atks = listAttacks(s);
        if (atks.length && Math.random() < 0.7) { rollAttack(s, atks[0].from, atks[0].to); if (s.lastConquest) moveAfterConquest(s, s.lastConquest.minMove); }
        else endPhase(s);
      } else if (s.phase === "fortify") { skipFortify(s); }
      else break;
    }
    console.log("✓ random self-play ran; winner=" + (s.winner != null ? s.players[s.winner].name : "none yet") + ", turns=" + t);
  }

  return api;
});
