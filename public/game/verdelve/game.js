/* =====================================================================
   VERDELVE — a cozy overworld, a dangerous deep.
   2D mining / building / crafting RPG. Pure HTML5 Canvas + vanilla JS.
   Works with keyboard+mouse AND touch; scales to any screen.
   ===================================================================== */

(() => {
  "use strict";

  // ---------- Constants ----------
  const TILE = 32;
  let VIEW_W = 960, VIEW_H = 640;   // updated to fill the window on resize
  const MAP_W = 60, MAP_H = 60;
  const SAVE_KEY = "verdelve_save_v1";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // ---------- Tiles ----------
  const T = {
    VOID: 0, FLOOR: 1, WALL: 2, DIRT: 3, WOOD: 4, ORE: 5, GOLD: 6,
    TORCH: 7, BRICK: 8, PLANK: 9, CHEST: 11,
    GRASS: 12, WATER: 13, PORTAL: 14, EXIT: 15, GEM: 16,
  };

  const TILEDEF = {
    [T.VOID]:   { name: "void",   solid: true,  color: "#04040a" },
    [T.FLOOR]:  { name: "floor",  solid: false, color: "#2a2636" },
    [T.WALL]:   { name: "stone",  solid: true,  mineable: true, hp: 3, drop: "stone", color: "#6a6478" },
    [T.DIRT]:   { name: "dirt",   solid: true,  mineable: true, hp: 2, drop: "dirt",  color: "#6b5238" },
    [T.WOOD]:   { name: "tree",   solid: true,  mineable: true, hp: 2, drop: "wood",  color: "#6b4a25" },
    [T.ORE]:    { name: "iron ore", solid: true, mineable: true, hp: 4, drop: "iron", needs: "pick", color: "#6d6a78" },
    [T.GOLD]:   { name: "gold ore", solid: true, mineable: true, hp: 5, drop: "gold", needs: "pick", color: "#7a6a40" },
    [T.GEM]:    { name: "gem crystal", solid: true, mineable: true, hp: 6, drop: "gem", needs: "pick", color: "#3a5a6a" },
    [T.TORCH]:  { name: "torch",  solid: false, mineable: true, hp: 1, drop: "torch", color: "#2a2636" },
    [T.BRICK]:  { name: "brick wall", solid: true, mineable: true, hp: 3, drop: "brick", color: "#8a5a44" },
    [T.PLANK]:  { name: "plank wall", solid: true, mineable: true, hp: 2, drop: "plank", color: "#b07a3a" },
    [T.CHEST]:  { name: "chest",  solid: true, mineable: true, hp: 1, drop: "loot", color: "#caa14a" },
    [T.GRASS]:  { name: "grass",  solid: false, color: "#3f7d36" },
    [T.WATER]:  { name: "water",  solid: true,  color: "#2a5d8a" },
    [T.PORTAL]: { name: "dungeon portal", solid: false, color: "#1a1030" },
    [T.EXIT]:   { name: "exit",   solid: false, color: "#1a1622" },
  };

  // ---------- Items ----------
  const ITEMS = {
    stone: { name: "Stone", icon: "🪨", block: T.WALL },
    dirt:  { name: "Dirt",  icon: "🟫", block: T.DIRT },
    wood:  { name: "Wood",  icon: "🪵", block: T.WOOD },
    iron:  { name: "Iron",  icon: "⛓️" },
    gold:  { name: "Gold",  icon: "🪙" },
    gem:   { name: "Gem",   icon: "💎", rare: true },
    ruby:  { name: "Ruby",  icon: "🔻", rare: true },
    torch: { name: "Torch", icon: "🔥", block: T.TORCH },
    brick: { name: "Brick", icon: "🧱", block: T.BRICK },
    plank: { name: "Plank", icon: "🟧", block: T.PLANK },
    pick:  { name: "Pickaxe", icon: "⛏️", tool: true },
    sword: { name: "Sword", icon: "⚔️", tool: true },
    beef:    { name: "Beef",    icon: "🥩", food: 30 },
    egg:     { name: "Egg",     icon: "🥚", food: 8 },
    leather: { name: "Leather", icon: "🟤" },
    feather: { name: "Feather", icon: "🪶" },
  };

  // ---------- Recipes ----------
  const RECIPES = [
    { out: "pick",  qty: 1, icon: "⛏️", name: "Pickaxe",   cost: { wood: 3, stone: 2 }, desc: "Mine ore & gems" },
    { out: "sword", qty: 1, icon: "⚔️", name: "Sword",     cost: { wood: 2, iron: 1 }, desc: "Doubles attack" },
    { out: "torch", qty: 4, icon: "🔥", name: "Torches x4", cost: { wood: 1 }, desc: "Light the deep" },
    { out: "brick", qty: 4, icon: "🧱", name: "Bricks x4",  cost: { stone: 2 }, desc: "Sturdy wall" },
    { out: "plank", qty: 4, icon: "🟧", name: "Planks x4",  cost: { wood: 1 }, desc: "Cheap wall" },
    { special: "maxhp", icon: "❤️", name: "Heart Crystal", cost: { gem: 3 }, desc: "+25 max HP (rare!)" },
    { special: "atk",   icon: "🗡️", name: "Ruby Blade",    cost: { ruby: 2, iron: 3 }, desc: "+10 attack forever (rare!)" },
  ];

  // ---------- Overworld starter quest chain ----------
  const OW_QUESTS = [
    { type: "mine",  item: "wood",  target: 3, icon: "🪵", title: "Chop 3 Wood from trees" },
    { type: "mine",  item: "stone", target: 5, icon: "🪨", title: "Mine 5 Stone from rocks" },
    { type: "craft", item: "pick",  target: 1, icon: "⛏️", title: "Craft a Pickaxe (C)" },
    { type: "enter", item: "dungeon", target: 1, icon: "🌀", title: "Step into a 🌀 dungeon portal (F)" },
  ];

  // ---------- Dungeon miniquests (random each dungeon) ----------
  const DUNGEON_QUESTS = [
    { type: "mine", item: "iron", target: 4, icon: "⛓️", title: "Mine 4 Iron Ore", reward: { gem: 1, gold: 2 } },
    { type: "kill", item: "slime", target: 6, icon: "🟢", title: "Slay 6 Slimes", reward: { ruby: 1, iron: 2 } },
    { type: "mine", item: "gem",  target: 2, icon: "💎", title: "Mine 2 Gem Crystals", reward: { ruby: 1, gem: 1 } },
    { type: "mine", item: "gold", target: 3, icon: "🪙", title: "Collect 3 Gold Ore", reward: { gem: 2 } },
  ];

  // ---------- State ----------
  let map, light, ambient = 1.0;
  let scene = "title";      // "title" | "play"
  let mode = "overworld";   // "overworld" | "dungeon"
  let paused = false;
  let dungeonLevel = 1, dungeonsCleared = 0, deaths = 0;
  let player, enemies = [], animals = [], particles = [], floatTexts = [];
  let owSnap = null;        // persistent overworld snapshot {map, animals, px, py}
  const miningHp = {};
  const inv = {};
  const keys = {};
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, tx: 0, ty: 0, down: false, active: false };
  const touch = { active: false, mining: false };
  let aimTx = 0, aimTy = 0;

  const HOTBAR = ["pick", "sword", "torch", "brick", "plank", "wood", "stone", "dirt"];
  let activeSlot = 0;

  // character appearance (persisted in the save)
  const HAIR_COLORS = ["#1a1a1a", "#3a2a18", "#d9b45a", "#b5532a", "#3a6ea5", "#e07ba8"];
  const SHIRT_COLORS = ["#4aa3ff", "#d35454", "#5fbf52", "#9b6bd6", "#e08a3a", "#e8e8e8"];
  const character = { name: "Hero", gender: "boy", hair: "#3a2a18", shirt: "#4aa3ff" };

  // quest objects
  const owQuest = { step: 0, progress: 0, done: false };
  let dQuest = null; // { def, progress, done }

  // ---------- Inventory ----------
  function give(item, n = 1) { inv[item] = (inv[item] || 0) + n; renderHotbar(); renderMats(); }
  function has(item, n = 1) { return (inv[item] || 0) >= n; }
  function take(item, n = 1) {
    if (!has(item, n)) return false;
    inv[item] -= n;
    if (inv[item] <= 0 && !ITEMS[item]?.tool) delete inv[item];
    renderHotbar(); renderMats();
    return true;
  }

  // ---------- Utils ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rndi = (a, b) => Math.floor(rnd(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }
  function tileAt(x, y) { return inBounds(x, y) ? map[y][x] : T.VOID; }
  function isSolid(x, y) { const d = TILEDEF[tileAt(x, y)]; return d ? d.solid : true; }
  function findType(t) {
    for (let i = 0; i < 5000; i++) { const x = rndi(1, MAP_W - 2), y = rndi(1, MAP_H - 2); if (map[y][x] === t) return { x, y }; }
    return { x: 2, y: 2 };
  }
  function findTypeFar(t, from, minD) {
    for (let i = 0; i < 5000; i++) { const p = findType(t); if (dist(p.x, p.y, from.x, from.y) >= minD) return p; }
    return findType(t);
  }

  // =====================================================================
  //  WORLD GENERATION
  // =====================================================================
  function ensurePlayer() {
    if (!player) player = { hp: 100, maxHp: 100, atk: 8, px: 0, py: 0, facing: 1, fx: 1, fy: 0, hurtT: 0, swingT: 0 };
  }

  function generateOverworld() {
    mode = "overworld"; ambient = 1.0;
    map = [];
    for (let y = 0; y < MAP_H; y++) {
      const row = [];
      for (let x = 0; x < MAP_W; x++) {
        const edge = x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2;
        row.push(edge ? T.WATER : T.GRASS);
      }
      map.push(row);
    }
    // ponds
    for (let i = 0; i < 5; i++) blob(T.WATER, rndi(6, MAP_W - 6), rndi(6, MAP_H - 6), rndi(2, 4));
    // forests (tree clusters)
    for (let i = 0; i < 14; i++) cluster(T.WOOD, rndi(4, MAP_W - 4), rndi(4, MAP_H - 4), rndi(4, 9));
    // rocky outcrops (stone)
    for (let i = 0; i < 10; i++) cluster(T.WALL, rndi(4, MAP_W - 4), rndi(4, MAP_H - 4), rndi(3, 7));
    // dirt patches
    for (let i = 0; i < 6; i++) cluster(T.DIRT, rndi(4, MAP_W - 4), rndi(4, MAP_H - 4), rndi(2, 5));

    ensurePlayer();
    const spawn = findType(T.GRASS);
    setSpawn(spawn);

    // dungeon portals scattered far apart
    for (let i = 0; i < 4; i++) {
      const p = findTypeFar(T.GRASS, spawn, 14);
      map[p.y][p.x] = T.PORTAL;
      // little clearing around it
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (inBounds(p.x + dx, p.y + dy) && map[p.y + dy][p.x + dx] !== T.PORTAL && map[p.y + dy][p.x + dx] !== T.WATER)
          map[p.y + dy][p.x + dx] = T.GRASS;
    }

    // peaceful animals only — no monsters in the overworld
    enemies = [];
    animals = [];
    for (let i = 0; i < 7; i++) { const s = findType(T.GRASS); animals.push(makeCow(s.x, s.y)); }
    for (let i = 0; i < 8; i++) { const s = findType(T.GRASS); animals.push(makeChicken(s.x, s.y)); }

    snapshotOverworld();
    computeLight();
  }

  function generateDungeon() {
    mode = "dungeon"; ambient = 0.0;
    dungeonLevel = dungeonsCleared + 1;
    map = [];
    for (let y = 0; y < MAP_H; y++) {
      const row = [];
      for (let x = 0; x < MAP_W; x++) {
        const edge = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
        row.push(edge ? T.WALL : (Math.random() < 0.45 ? T.WALL : T.FLOOR));
      }
      map.push(row);
    }
    for (let i = 0; i < 4; i++) {
      const next = map.map(r => r.slice());
      for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
        let w = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(x + dx, y + dy) === T.WALL) w++;
        next[y][x] = w >= 5 ? T.WALL : T.FLOOR;
      }
      map = next;
    }
    for (let r = 0; r < 6; r++) {
      const rw = rndi(4, 8), rh = rndi(4, 7), rx = rndi(2, MAP_W - rw - 2), ry = rndi(2, MAP_H - rh - 2);
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) map[y][x] = T.FLOOR;
    }
    // ores & gems (the rare stuff lives here)
    veins(T.ORE, 8 + dungeonLevel, 4);
    veins(T.GOLD, 3 + Math.floor(dungeonLevel / 2), 3);
    veins(T.GEM, 2 + Math.floor(dungeonLevel / 2), 2);
    scatter(T.DIRT, 40);

    ensurePlayer();
    const spawn = findType(T.FLOOR);
    setSpawn(spawn);
    // exit pad right at spawn so you can always retreat
    placeNear(T.TORCH, spawn, 3);
    const ex = findFloorAdjacent(spawn) || spawn;
    map[ex.y][ex.x] = T.EXIT;

    for (let i = 0; i < 3 + dungeonLevel; i++) { const c = findType(T.FLOOR); map[c.y][c.x] = T.CHEST; }

    // monsters scale with level; no peaceful animals down here
    animals = [];
    enemies = [];
    const count = 5 + dungeonLevel * 2;
    for (let i = 0; i < count; i++) { const s = findTypeFar(T.FLOOR, spawn, 10); enemies.push(makeSlime(s.x, s.y)); }

    // pick a random miniquest
    const def = DUNGEON_QUESTS[rndi(0, DUNGEON_QUESTS.length - 1)];
    dQuest = { def, progress: 0, done: false };

    computeLight();
  }

  function setSpawn(spawn) {
    player.px = spawn.x * TILE + TILE / 2;
    player.py = spawn.y * TILE + TILE / 2;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (inBounds(spawn.x + dx, spawn.y + dy)) {
        const cur = map[spawn.y + dy][spawn.x + dx];
        if (cur !== T.WATER) map[spawn.y + dy][spawn.x + dx] = (mode === "overworld" ? T.GRASS : T.FLOOR);
      }
  }
  function findFloorAdjacent(p) {
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]])
      if (inBounds(p.x + dx, p.y + dy) && map[p.y + dy][p.x + dx] === T.FLOOR) return { x: p.x + dx, y: p.y + dy };
    return null;
  }
  function blob(tile, cx, cy, r) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
      if (inBounds(x, y) && dist(x, y, cx, cy) <= r && x > 1 && y > 1 && x < MAP_W - 2 && y < MAP_H - 2) map[y][x] = tile;
  }
  function cluster(tile, cx, cy, n) {
    let x = cx, y = cy;
    for (let i = 0; i < n * 2; i++) {
      if (inBounds(x, y) && map[y][x] === (mode === "overworld" ? T.GRASS : T.FLOOR)) map[y][x] = tile;
      x = clamp(x + rndi(-1, 1), 2, MAP_W - 3); y = clamp(y + rndi(-1, 1), 2, MAP_H - 3);
    }
  }
  function scatter(tile, n) {
    for (let i = 0; i < n; i++) { const x = rndi(1, MAP_W - 2), y = rndi(1, MAP_H - 2); if (map[y][x] === T.WALL) map[y][x] = tile; }
  }
  function veins(tile, count, len) {
    for (let i = 0; i < count; i++) {
      let x = rndi(2, MAP_W - 3), y = rndi(2, MAP_H - 3);
      for (let j = 0; j < len; j++) {
        if (inBounds(x, y) && map[y][x] === T.WALL) map[y][x] = tile;
        x = clamp(x + rndi(-1, 1), 1, MAP_W - 2); y = clamp(y + rndi(-1, 1), 1, MAP_H - 2);
      }
    }
  }
  function placeNear(tile, c, n) {
    let placed = 0, tries = 0;
    while (placed < n && tries++ < 200) {
      const x = c.x + rndi(-3, 3), y = c.y + rndi(-3, 3);
      if (inBounds(x, y) && (map[y][x] === T.FLOOR || map[y][x] === T.GRASS)) { map[y][x] = tile; placed++; }
    }
  }

  // ---------- Mob factories ----------
  function makeSlime(tx, ty) {
    const hp = 16 + dungeonLevel * 6;
    return { px: tx * TILE + 16, py: ty * TILE + 16, hp, maxHp: hp, atk: 5 + dungeonLevel * 2,
      speed: rnd(0.6, 1.1), hurtT: 0, cd: 0, wob: rnd(0, 6.28), dirx: 0, diry: 0, repathT: 0 };
  }
  function makeCow(tx, ty) {
    return { kind: "cow", hp: 20, maxHp: 20, px: tx * TILE + 16, py: ty * TILE + 16,
      speed: 0.55, hurtT: 0, fleeT: 0, wob: rnd(0, 6.28), dirx: 0, diry: 0, repathT: 0 };
  }
  function makeChicken(tx, ty) {
    return { kind: "chicken", hp: 8, maxHp: 8, px: tx * TILE + 16, py: ty * TILE + 16,
      speed: 0.9, hurtT: 0, fleeT: 0, layT: rnd(8, 16), wob: rnd(0, 6.28), dirx: 0, diry: 0, repathT: 0 };
  }

  // ---------- Lighting ----------
  function computeLight() {
    light = [];
    for (let y = 0; y < MAP_H; y++) light.push(new Float32Array(MAP_W));
    if (ambient >= 0.99) return; // daylight: skip
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const id = map[y][x];
      if (id === T.TORCH) addLight(x, y, 5);
      else if (id === T.EXIT) addLight(x, y, 3);
      else if (id === T.GEM) addLight(x, y, 2);
    }
  }
  function addLight(cx, cy, r) {
    for (let y = Math.max(0, cy - r); y <= Math.min(MAP_H - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(MAP_W - 1, cx + r); x++) {
        const d = dist(x, y, cx, cy);
        if (d <= r) light[y][x] = Math.max(light[y][x], 1 - d / r);
      }
  }

  // =====================================================================
  //  SNAPSHOT / SAVE / LOAD
  // =====================================================================
  function snapshotOverworld() {
    if (mode !== "overworld") return;
    owSnap = { map, animals, px: player.px, py: player.py };
  }
  function applyOverworld() {
    mode = "overworld"; ambient = 1.0;
    map = owSnap.map; animals = owSnap.animals; enemies = [];
    player.px = owSnap.px; player.py = owSnap.py;
    dQuest = null;
    for (const k in miningHp) delete miningHp[k];
    computeLight();
  }

  function saveGame() {
    snapshotOverworld();
    if (!owSnap) return false;
    const data = {
      deaths, dungeonsCleared,
      character: { ...character },
      inv: { ...inv },
      player: { hp: Math.max(1, player.hp), maxHp: player.maxHp, atk: player.atk },
      owQuest: { step: owQuest.step, progress: owQuest.progress, done: owQuest.done },
      ow: {
        px: owSnap.px, py: owSnap.py, map: owSnap.map,
        animals: owSnap.animals.map(a => ({ kind: a.kind, px: a.px, py: a.py, hp: a.hp, maxHp: a.maxHp })),
      },
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; }
    catch (e) { console.error("save failed", e); return false; }
  }
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function loadGame() {
    let data; try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
    if (!data) return false;
    deaths = data.deaths || 0; dungeonsCleared = data.dungeonsCleared || 0;
    if (data.character) Object.assign(character, data.character);
    for (const k in inv) delete inv[k];
    Object.assign(inv, data.inv || {});
    ensurePlayer();
    player.hp = data.player.hp; player.maxHp = data.player.maxHp; player.atk = data.player.atk;
    owQuest.step = data.owQuest.step; owQuest.progress = data.owQuest.progress; owQuest.done = data.owQuest.done;
    const animObjs = (data.ow.animals || []).map(a => {
      const m = a.kind === "cow" ? makeCow(0, 0) : makeChicken(0, 0);
      m.px = a.px; m.py = a.py; m.hp = a.hp; m.maxHp = a.maxHp; return m;
    });
    owSnap = { map: data.ow.map, animals: animObjs, px: data.ow.px, py: data.ow.py };
    applyOverworld();
    return true;
  }

  // =====================================================================
  //  INPUT (keyboard + mouse)
  // =====================================================================
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (scene !== "play") return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= HOTBAR.length) { activeSlot = n - 1; renderHotbar(); }
    if (k === "c") toggleCraft();
    if (k === "f") useTile();
    if (k === "q") eatFood();
    if (k === "r") warpHome();
    if (k === "escape" || k === "p") togglePause();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    mouse.active = true; touch.active = false;
  });
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (scene !== "play" || paused) return;
    if (e.button === 0) { mouse.down = true; primaryAction(); }
    else if (e.button === 2) placeAction();
  });
  canvas.addEventListener("mouseup", () => { mouse.down = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // =====================================================================
  //  TOUCH CONTROLS
  // =====================================================================
  const touchEl = document.getElementById("touch");
  const stickEl = document.getElementById("stick");
  const knobEl = document.getElementById("knob");
  const pauseBtn = document.getElementById("pause-btn");
  const warpBtn = document.getElementById("warp-btn");
  const stickVec = { x: 0, y: 0 };
  let stickId = null;

  function isTouchDevice() { return ("ontouchstart" in window) || navigator.maxTouchPoints > 0; }

  function initStick() {
    stickEl.addEventListener("touchstart", onStick, { passive: false });
    stickEl.addEventListener("touchmove", onStick, { passive: false });
    stickEl.addEventListener("touchend", endStick, { passive: false });
    stickEl.addEventListener("touchcancel", endStick, { passive: false });
    function onStick(e) {
      e.preventDefault(); touch.active = true; mouse.active = false;
      const t = e.changedTouches[0]; stickId = t.identifier;
      const r = stickEl.getBoundingClientRect();
      let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      stickVec.x = dx; stickVec.y = dy;
      knobEl.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
    }
    function endStick(e) { e.preventDefault(); stickVec.x = 0; stickVec.y = 0; knobEl.style.transform = "translate(0,0)"; }
  }

  function initTouchButtons() {
    document.querySelectorAll(".tbtn").forEach(btn => {
      const act = btn.dataset.act;
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault(); touch.active = true; mouse.active = false;
        if (scene !== "play" || paused) return;
        if (act === "mine") { touch.mining = true; primaryAction(); }
        else if (act === "place") placeAction();
        else if (act === "craft") toggleCraft();
        else if (act === "eat") eatFood();
        else if (act === "use") useTile();
        else if (act === "warp") warpHome();
      }, { passive: false });
      btn.addEventListener("touchend", (e) => { e.preventDefault(); if (act === "mine") touch.mining = false; }, { passive: false });
    });
    pauseBtn.addEventListener("click", () => { if (scene === "play") togglePause(); });
    warpBtn.addEventListener("click", warpHome);
  }
  function updateWarpBtn() { warpBtn.classList.toggle("hidden", !(scene === "play" && mode === "dungeon")); }

  // =====================================================================
  //  CAMERA / AIM
  // =====================================================================
  const cam = { x: 0, y: 0 };
  function updateCamera() {
    const worldW = MAP_W * TILE, worldH = MAP_H * TILE;
    cam.x = worldW <= VIEW_W ? (worldW - VIEW_W) / 2 : clamp(player.px - VIEW_W / 2, 0, worldW - VIEW_W);
    cam.y = worldH <= VIEW_H ? (worldH - VIEW_H) / 2 : clamp(player.py - VIEW_H / 2, 0, worldH - VIEW_H);
  }
  function updateAim() {
    if (touch.active || !mouse.active) {
      // touch / keyboard: aim the tile the player faces
      aimTx = Math.floor(player.px / TILE) + player.fx;
      aimTy = Math.floor(player.py / TILE) + player.fy;
    } else {
      aimTx = Math.floor((mouse.x + cam.x) / TILE);
      aimTy = Math.floor((mouse.y + cam.y) / TILE);
    }
  }

  // =====================================================================
  //  ACTIONS
  // =====================================================================
  function reachable(tx, ty) {
    return dist(player.px / TILE, player.py / TILE, tx + 0.5, ty + 0.5) <= 3.2;
  }

  function primaryAction() {
    // 1) attack a monster/animal near the aim point (or nearest in range on touch)
    let target = null, best = 1e9;
    const ax = (touch.active || !mouse.active) ? player.px + player.fx * TILE : mouse.x + cam.x;
    const ay = (touch.active || !mouse.active) ? player.py + player.fy * TILE : mouse.y + cam.y;
    for (const en of enemies) {
      const d = dist(ax, ay, en.px, en.py);
      if (d < TILE && dist(player.px, player.py, en.px, en.py) < TILE * 2.6 && d < best) { best = d; target = { t: en, kind: "enemy" }; }
    }
    if (!target) for (const an of animals) {
      const d = dist(ax, ay, an.px, an.py);
      if (d < TILE && dist(player.px, player.py, an.px, an.py) < TILE * 2.6 && d < best) { best = d; target = { t: an, kind: "animal" }; }
    }
    if (target) { target.kind === "enemy" ? attack(target.t) : hitAnimal(target.t); return; }
    mineTile(aimTx, aimTy);
  }

  function attack(en) {
    player.swingT = 0.18;
    const dmg = player.atk + (has("sword") ? player.atk : 0);
    en.hp -= dmg; en.hurtT = 0.2;
    const a = Math.atan2(en.py - player.py, en.px - player.px);
    en.px += Math.cos(a) * 10; en.py += Math.sin(a) * 10;
    spawnFloat(en.px, en.py, "-" + dmg, "#ff6b6b");
    spawnParticles(en.px, en.py, "#7ed957", 6);
    if (en.hp <= 0) {
      enemies = enemies.filter(s => s !== en);
      spawnParticles(en.px, en.py, "#7ed957", 16);
      if (Math.random() < 0.4) give("iron", 1);
      questEvent("kill", "slime", 1);
    }
  }

  function hitAnimal(an) {
    player.swingT = 0.18;
    const dmg = player.atk + (has("sword") ? player.atk : 0);
    an.hp -= dmg; an.hurtT = 0.2; an.fleeT = 5;
    const a = Math.atan2(an.py - player.py, an.px - player.px);
    an.px += Math.cos(a) * 8; an.py += Math.sin(a) * 8;
    spawnFloat(an.px, an.py, "-" + dmg, "#ff6b6b");
    spawnParticles(an.px, an.py, an.kind === "cow" ? "#e8d8c0" : "#fff", 6);
    if (an.hp <= 0) {
      animals = animals.filter(x => x !== an);
      spawnParticles(an.px, an.py, "#d8c0a0", 14);
      if (an.kind === "cow") { give("beef", rndi(1, 3)); give("leather", rndi(1, 2)); spawnFloat(an.px, an.py - 10, "🥩 +leather", "#cfc"); }
      else { give("feather", rndi(1, 3)); if (Math.random() < 0.5) give("egg", 1); spawnFloat(an.px, an.py - 10, "🪶", "#cfc"); }
    }
  }

  function mineTile(tx, ty) {
    if (!inBounds(tx, ty) || !reachable(tx, ty)) return;
    const id = map[ty][tx], def = TILEDEF[id];
    if (!def || !def.mineable) return;
    if (def.needs === "pick" && !has("pick")) { toast("Need a ⛏️ Pickaxe for " + def.name); return; }
    player.swingT = 0.15;
    const key = tx + "," + ty;
    miningHp[key] = (miningHp[key] ?? def.hp) - 1;
    spawnParticles(tx * TILE + 16, ty * TILE + 16, def.color, 3);
    if (miningHp[key] <= 0) { delete miningHp[key]; breakTile(tx, ty, id, def); }
  }

  function breakTile(tx, ty, id, def) {
    map[ty][tx] = (mode === "overworld" ? T.GRASS : T.FLOOR);
    spawnParticles(tx * TILE + 16, ty * TILE + 16, def.color, 12);
    if (id === T.CHEST) {
      const loot = [["gold", rndi(1, 3)], ["iron", rndi(1, 3)], ["wood", rndi(2, 4)], ["torch", rndi(1, 3)]];
      for (const [it, n] of loot) give(it, n);
      if (Math.random() < 0.35) { give("gem", 1); }
      toast("💰 Chest looted!");
      spawnFloat(tx * TILE + 16, ty * TILE, "LOOT!", "#f1c40f");
    } else if (def.drop && ITEMS[def.drop]) {
      give(def.drop, 1);
      const r = ITEMS[def.drop].rare;
      spawnFloat(tx * TILE + 16, ty * TILE, "+" + ITEMS[def.drop].name, r ? "#8ad0ff" : "#cfc9b5");
      questEvent("mine", def.drop, 1);
    }
    if (id === T.TORCH || id === T.GEM) computeLight();
  }

  function placeAction() {
    const item = HOTBAR[activeSlot], def = ITEMS[item];
    if (!def || !def.block) { toast("Can't place " + (def?.name || "that")); return; }
    if (!inBounds(aimTx, aimTy) || !reachable(aimTx, aimTy)) return;
    const ground = mode === "overworld" ? T.GRASS : T.FLOOR;
    if (map[aimTy][aimTx] !== ground) return;
    const ptx = Math.floor(player.px / TILE), pty = Math.floor(player.py / TILE);
    if (aimTx === ptx && aimTy === pty && TILEDEF[def.block].solid) return;
    if (!take(item, 1)) { toast("Out of " + def.name); return; }
    map[aimTy][aimTx] = def.block;
    spawnParticles(aimTx * TILE + 16, aimTy * TILE + 16, TILEDEF[def.block].color, 6);
    if (def.block === T.TORCH) computeLight();
  }

  function eatFood() {
    if (player.hp >= player.maxHp) { toast("Already at full health"); return; }
    const food = ["beef", "egg"].find(f => has(f));
    if (!food) { toast("No food — harvest a 🐄 or 🐔"); return; }
    take(food, 1);
    const heal = ITEMS[food].food;
    player.hp = clamp(player.hp + heal, 0, player.maxHp);
    spawnFloat(player.px, player.py - 18, "+" + heal, "#7ed957");
    toast("Ate " + ITEMS[food].name + " (+" + heal + ")");
    renderHUD();
  }

  function useTile() {
    const tx = Math.floor(player.px / TILE), ty = Math.floor(player.py / TILE);
    const id = map[ty][tx];
    if (mode === "overworld" && id === T.PORTAL) enterDungeon();
    else if (mode === "dungeon" && id === T.EXIT) exitDungeon();
    else toast(mode === "overworld" ? "Stand on a 🌀 portal, press F" : "Stand on the ▲ exit, press F");
  }

  function enterDungeon() {
    snapshotOverworld();
    for (const k in miningHp) delete miningHp[k];
    generateDungeon();
    questEvent("enter", "dungeon", 1);
    toast("🌀 Entered dungeon — " + dQuest.def.title);
    renderQuest(); updateHUD(); saveGame();
  }
  function exitDungeon() {
    applyOverworld();
    toast("🌿 Back in the overworld");
    renderQuest(); updateHUD(); saveGame();
  }

  // Warp Stone — every delver carries one; whisks you home from the deep.
  function warpHome() {
    if (scene !== "play" || paused) return;
    if (mode !== "dungeon") { toast("✨ The Warp Stone only hums underground"); return; }
    spawnParticles(player.px, player.py, "#d6a8ff", 24);
    spawnFloat(player.px, player.py - 20, "✨ WARP", "#d6a8ff");
    exitDungeon();
  }

  // =====================================================================
  //  QUEST ENGINE
  // =====================================================================
  function questEvent(type, item, amount = 1) {
    if (mode === "dungeon" && dQuest && !dQuest.done) {
      const d = dQuest.def;
      if (d.type === type && d.item === item) {
        dQuest.progress = Math.min(d.target, dQuest.progress + amount);
        if (dQuest.progress >= d.target) completeDungeon();
        renderQuest();
      }
    }
    if (mode === "overworld" && !owQuest.done) {
      const step = OW_QUESTS[owQuest.step];
      if (step && step.type === type && step.item === item) {
        owQuest.progress = Math.min(step.target, owQuest.progress + amount);
        if (owQuest.progress >= step.target) advanceOwQuest();
        renderQuest();
      }
    }
    // entering a dungeon also fulfils the overworld "enter" step (fires before mode flips fully)
    if (type === "enter" && !owQuest.done) {
      const step = OW_QUESTS[owQuest.step];
      if (step && step.type === "enter") { advanceOwQuest(); }
    }
  }
  function advanceOwQuest() {
    spawnFloat(player.px, player.py - 24, "✔ step done", "#7ed957");
    toast("✔ Quest step complete!");
    owQuest.step++; owQuest.progress = 0;
    if (owQuest.step >= OW_QUESTS.length) { owQuest.done = true; toast("🏆 Tutorial done — explore & delve!"); }
    renderQuest(); saveGame();
  }
  function completeDungeon() {
    dQuest.done = true; dungeonsCleared++;
    const reward = dQuest.def.reward;
    for (const [it, n] of Object.entries(reward)) give(it, n);
    const rstr = Object.entries(reward).map(([it, n]) => ITEMS[it].icon + n).join(" ");
    toast("🏆 Dungeon cleared! Reward: " + rstr);
    spawnFloat(player.px, player.py - 28, "QUEST COMPLETE!", "#f1c40f");
    renderQuest(); saveGame();
  }

  // =====================================================================
  //  MOVEMENT
  // =====================================================================
  function tryMove(nx, ny) {
    const rad = TILE * 0.34;
    let ok = true;
    for (const [cx, cy] of [[nx - rad, player.py - rad], [nx + rad, player.py - rad], [nx - rad, player.py + rad], [nx + rad, player.py + rad]])
      if (isSolid(Math.floor(cx / TILE), Math.floor(cy / TILE))) ok = false;
    if (ok) player.px = nx;
    ok = true;
    for (const [cx, cy] of [[player.px - rad, ny - rad], [player.px + rad, ny - rad], [player.px - rad, ny + rad], [player.px + rad, ny + rad]])
      if (isSolid(Math.floor(cx / TILE), Math.floor(cy / TILE))) ok = false;
    if (ok) player.py = ny;
  }

  // =====================================================================
  //  MAIN LOOP
  // =====================================================================
  let last = 0;
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000) || 0;
    last = t;
    try {
      if (scene === "play" && !paused) update(dt);
      if (map && player) render();
    } catch (err) { console.error("loop error:", err); }
    requestAnimationFrame(loop);
  }

  function update(dt) {
    // movement: keyboard or stick
    let dx = 0, dy = 0;
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    if (touch.active && (stickVec.x || stickVec.y)) { dx = stickVec.x; dy = stickVec.y; }
    if (dx || dy) {
      const m = Math.hypot(dx, dy) || 1;
      tryMove(player.px + (dx / m) * 150 * dt, player.py + (dy / m) * 150 * dt);
      // facing for touch/keyboard aim
      if (Math.abs(dx) > Math.abs(dy)) { player.fx = dx > 0 ? 1 : -1; player.fy = 0; }
      else { player.fx = 0; player.fy = dy > 0 ? 1 : -1; }
      if (dx) player.facing = dx > 0 ? 1 : -1;
    }
    if (player.swingT > 0) player.swingT -= dt;
    if (player.hurtT > 0) player.hurtT -= dt;

    updateCamera(); updateAim();

    // hold-to-mine
    if (mouse.down || touch.mining) mineTile(aimTx, aimTy);

    // enemies
    for (const en of enemies) {
      if (en.hurtT > 0) en.hurtT -= dt;
      en.cd -= dt; en.wob += dt * 4;
      const d = dist(en.px, en.py, player.px, player.py);
      if (d < TILE * 7) { const a = Math.atan2(player.py - en.py, player.px - en.px); en.dirx = Math.cos(a); en.diry = Math.sin(a); }
      else { en.repathT -= dt; if (en.repathT <= 0) { const a = rnd(0, 6.28); en.dirx = Math.cos(a); en.diry = Math.sin(a); en.repathT = rnd(1, 3); } }
      moveEntity(en, en.dirx * en.speed * 55 * dt, en.diry * en.speed * 55 * dt);
      if (d < TILE * 0.8 && en.cd <= 0) { en.cd = 0.8; damagePlayer(en.atk, en); }
    }

    // animals (peaceful)
    for (const an of animals) {
      if (an.hurtT > 0) an.hurtT -= dt;
      if (an.fleeT > 0) an.fleeT -= dt;
      an.wob += dt * (an.kind === "chicken" ? 10 : 4);
      if (an.fleeT > 0) { const a = Math.atan2(an.py - player.py, an.px - player.px); an.dirx = Math.cos(a); an.diry = Math.sin(a); }
      else { an.repathT -= dt; if (an.repathT <= 0) { if (Math.random() < 0.4) { an.dirx = 0; an.diry = 0; } else { const a = rnd(0, 6.28); an.dirx = Math.cos(a); an.diry = Math.sin(a); } an.repathT = rnd(1.2, 3.5); } }
      moveEntity(an, an.dirx * an.speed * (an.fleeT > 0 ? 95 : 40) * dt, an.diry * an.speed * (an.fleeT > 0 ? 95 : 40) * dt);
      if (an.kind === "chicken") { an.layT -= dt; if (an.layT <= 0) { an.layT = rnd(12, 22); give("egg", 1); spawnFloat(an.px, an.py - 12, "🥚", "#fff"); } }
    }

    updateParticles(dt);
    if (player.hp <= 0) onDeath();
  }

  function moveEntity(en, mx, my) {
    const rad = TILE * 0.3;
    let nx = en.px + mx;
    if (!isSolid(Math.floor((nx - rad) / TILE), Math.floor(en.py / TILE)) && !isSolid(Math.floor((nx + rad) / TILE), Math.floor(en.py / TILE))) en.px = nx;
    let ny = en.py + my;
    if (!isSolid(Math.floor(en.px / TILE), Math.floor((ny - rad) / TILE)) && !isSolid(Math.floor(en.px / TILE), Math.floor((ny + rad) / TILE))) en.py = ny;
  }

  function damagePlayer(amt, src) {
    if (player.hurtT > 0) return;
    player.hp -= amt; player.hurtT = 0.5;
    spawnFloat(player.px, player.py - 16, "-" + amt, "#ff5555");
    if (src) { const a = Math.atan2(player.py - src.py, player.px - src.px); tryMove(player.px + Math.cos(a) * 14, player.py + Math.sin(a) * 14); }
    renderHUD();
  }

  // ---------- Particles ----------
  function spawnParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(20, 90); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.7), color, size: rnd(2, 4) }); }
  }
  function spawnFloat(x, y, text, color) { floatTexts.push({ x, y, text, color, life: 0.9 }); }
  function updateParticles(dt) {
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    for (const f of floatTexts) { f.y -= 24 * dt; f.life -= dt; }
    floatTexts = floatTexts.filter(f => f.life > 0);
  }

  // =====================================================================
  //  RENDER
  // =====================================================================
  function render() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = mode === "overworld" ? "#2c5e28" : "#05050a";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const x0 = Math.floor(cam.x / TILE), y0 = Math.floor(cam.y / TILE);
    const x1 = Math.ceil((cam.x + VIEW_W) / TILE), y1 = Math.ceil((cam.y + VIEW_H) / TILE);
    const plx = Math.floor(player.px / TILE), ply = Math.floor(player.py / TILE);

    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inBounds(x, y)) continue;
      const id = map[y][x], def = TILEDEF[id];
      const sx = x * TILE - cam.x, sy = y * TILE - cam.y;
      let lv = light[y][x];
      lv = Math.max(lv, clamp(1 - dist(x, y, plx, ply) / 6, 0, 1) * 0.9);
      lv = clamp(Math.max(lv, ambient), 0.04, 1);
      drawTile(id, def, sx, sy, lv, x, y);
      const key = x + "," + y;
      if (miningHp[key] !== undefined && def.hp) { ctx.fillStyle = `rgba(0,0,0,${0.4 * (1 - miningHp[key] / def.hp)})`; ctx.fillRect(sx, sy, TILE, TILE); }
    }

    for (const en of enemies) drawSlime(en);
    for (const an of animals) an.kind === "cow" ? drawCow(an) : drawChicken(an);

    for (const p of particles) { ctx.globalAlpha = clamp(p.life * 2, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x - cam.x - p.size / 2, p.y - cam.y - p.size / 2, p.size, p.size); }
    ctx.globalAlpha = 1;

    drawPlayer();

    ctx.textAlign = "center"; ctx.font = "bold 14px Trebuchet MS";
    for (const f of floatTexts) {
      ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
      ctx.fillStyle = "#000"; ctx.fillText(f.text, f.x - cam.x + 1, f.y - cam.y + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x - cam.x, f.y - cam.y);
    }
    ctx.globalAlpha = 1;

    // aim highlight
    const ax = aimTx * TILE - cam.x, ay = aimTy * TILE - cam.y;
    ctx.strokeStyle = reachable(aimTx, aimTy) ? "rgba(241,196,15,0.8)" : "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2; ctx.strokeRect(ax + 1, ay + 1, TILE - 2, TILE - 2);

    // vignette (lighter in daylight), scaled to the screen
    const vr = Math.max(VIEW_W, VIEW_H) * 0.62;
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, vr * 0.22, VIEW_W / 2, VIEW_H / 2, vr);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, mode === "overworld" ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.6)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  function shade(hex, lv) {
    const r = parseInt(hex.slice(1, 3), 16) * lv, g = parseInt(hex.slice(3, 5), 16) * lv, b = parseInt(hex.slice(5, 7), 16) * lv;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  function drawTile(id, def, sx, sy, lv, x, y) {
    const ground = mode === "overworld" ? T.GRASS : T.FLOOR;
    ctx.fillStyle = shade(TILEDEF[ground].color, lv);
    ctx.fillRect(sx, sy, TILE, TILE);

    if (id === T.GRASS) {
      ctx.fillStyle = shade("#356b2e", lv);
      if ((x * 3 + y * 7) % 5 === 0) { ctx.fillRect(sx + 6, sy + 8, 3, 6); ctx.fillRect(sx + 20, sy + 16, 3, 6); }
      if ((x * 5 + y * 2) % 11 === 0) { ctx.fillStyle = shade("#e8d24a", lv); ctx.fillRect(sx + 14, sy + 12, 3, 3); } // flower
      return;
    }
    if (id === T.FLOOR) { ctx.fillStyle = shade("#211e2c", lv); if ((x + y) % 2 === 0) ctx.fillRect(sx, sy, TILE, TILE); return; }
    if (id === T.WATER) {
      ctx.fillStyle = shade("#2a5d8a", lv); ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = shade("#3f7db0", lv);
      const w = Math.sin((performance.now() / 400) + x + y) * 2;
      ctx.fillRect(sx + 4, sy + 10 + w, 10, 2); ctx.fillRect(sx + 18, sy + 20 - w, 9, 2);
      return;
    }
    if (id === T.PORTAL) {
      ctx.fillStyle = shade("#0c081a", lv); ctx.fillRect(sx, sy, TILE, TILE);
      const t = performance.now() / 300;
      for (let i = 0; i < 3; i++) {
        const rr = 4 + i * 4 + Math.sin(t + i) * 2;
        ctx.strokeStyle = `rgba(${150 + i * 30},80,${220 - i * 20},0.9)`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx + 16, sy + 16, rr, 0, 6.28); ctx.stroke();
      }
      ctx.fillStyle = "#d6a8ff"; ctx.font = "13px serif"; ctx.textAlign = "center"; ctx.fillText("🌀", sx + 16, sy + 21);
      return;
    }
    if (id === T.EXIT) {
      ctx.fillStyle = shade("#0c0a12", lv); ctx.fillRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
      ctx.fillStyle = shade("#7a9a5a", lv); for (let i = 0; i < 4; i++) ctx.fillRect(sx + 5 + i * 4, sy + 24 - i * 6, TILE - 10 - i * 4, 3);
      ctx.fillStyle = "#9be36b"; ctx.font = "15px serif"; ctx.textAlign = "center"; ctx.fillText("▲", sx + 16, sy + 22);
      return;
    }
    if (id === T.TORCH) {
      ctx.fillStyle = "#3a2a18"; ctx.fillRect(sx + 14, sy + 14, 4, 14);
      const fl = 0.7 + Math.sin(performance.now() / 120 + x + y) * 0.3;
      ctx.fillStyle = `rgba(255,${150 + fl * 60 | 0},40,1)`; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 12, 5, 8 * fl, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = "rgba(255,240,150,0.9)"; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 12, 2.5, 4 * fl, 0, 0, 6.28); ctx.fill();
      return;
    }

    // solid blocks with bevel
    const base = def.color;
    ctx.fillStyle = shade(base, lv); ctx.fillRect(sx, sy, TILE, TILE);
    ctx.fillStyle = shade(base, Math.min(1, lv * 1.35)); ctx.fillRect(sx, sy, TILE, 3); ctx.fillRect(sx, sy, 3, TILE);
    ctx.fillStyle = shade(base, lv * 0.6); ctx.fillRect(sx, sy + TILE - 3, TILE, 3); ctx.fillRect(sx + TILE - 3, sy, 3, TILE);

    if (id === T.ORE || id === T.GOLD || id === T.GEM) {
      ctx.fillStyle = id === T.ORE ? shade("#cfd3dd", lv) : id === T.GOLD ? shade("#ffd24a", lv) : "#6fe6ff";
      for (let i = 0; i < 4; i++) { const ox = ((x * 7 + i * 11) % 20) + 6, oy = ((y * 5 + i * 13) % 20) + 6; ctx.fillRect(sx + ox, sy + oy, 3, 3); }
    }
    if (id === T.WOOD) {
      ctx.fillStyle = shade("#3f2d18", lv); ctx.fillRect(sx + 13, sy + 12, 6, TILE - 12);
      ctx.fillStyle = shade("#3c7a2f", lv); ctx.beginPath(); ctx.arc(sx + 16, sy + 11, 12, 0, 6.28); ctx.fill();
      ctx.fillStyle = shade("#4f9636", lv); ctx.beginPath(); ctx.arc(sx + 11, sy + 9, 6, 0, 6.28); ctx.arc(sx + 21, sy + 12, 6, 0, 6.28); ctx.fill();
    }
    if (id === T.CHEST) {
      ctx.fillStyle = shade("#5a3a12", lv); ctx.fillRect(sx + 5, sy + 9, TILE - 10, TILE - 14);
      ctx.fillStyle = shade("#caa14a", lv); ctx.fillRect(sx + 5, sy + 9, TILE - 10, 4);
      ctx.fillStyle = "#3a2a10"; ctx.fillRect(sx + 14, sy + 14, 4, 4);
    }
  }

  function drawSlime(en) {
    const sx = en.px - cam.x, sy = en.py - cam.y, sq = 1 + Math.sin(en.wob) * 0.08;
    ctx.fillStyle = en.hurtT > 0 ? "#fff" : "#6abf4b";
    ctx.beginPath(); ctx.ellipse(sx, sy + 4, 11 / sq, 9 * sq, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = "#0a0a0a"; ctx.fillRect(sx - 5, sy, 3, 4); ctx.fillRect(sx + 2, sy, 3, 4);
    if (en.hp < en.maxHp) { ctx.fillStyle = "#000"; ctx.fillRect(sx - 12, sy - 16, 24, 4); ctx.fillStyle = "#7ed957"; ctx.fillRect(sx - 12, sy - 16, 24 * (en.hp / en.maxHp), 4); }
  }
  function drawCow(an) {
    const sx = an.px - cam.x, sy = an.py - cam.y, bob = Math.sin(an.wob) * 1.5, fl = an.dirx < 0;
    ctx.fillStyle = an.hurtT > 0 ? "#fff" : "#efe9e0"; ctx.fillRect(sx - 12, sy - 6 + bob, 24, 16);
    ctx.fillStyle = an.hurtT > 0 ? "#fff" : "#5a4632"; ctx.fillRect(sx - 8, sy - 2 + bob, 6, 6); ctx.fillRect(sx + 3, sy + 2 + bob, 7, 5);
    ctx.fillStyle = "#cfc6ba"; ctx.fillRect(sx - 10, sy + 9 + bob, 4, 6); ctx.fillRect(sx + 6, sy + 9 + bob, 4, 6);
    const hx = fl ? sx - 14 : sx + 8;
    ctx.fillStyle = an.hurtT > 0 ? "#fff" : "#efe9e0"; ctx.fillRect(hx, sy - 4 + bob, 8, 9);
    ctx.fillStyle = "#f0a0c0"; ctx.fillRect(hx + (fl ? -1 : 6), sy + 1 + bob, 3, 4);
    ctx.fillStyle = "#000"; ctx.fillRect(hx + (fl ? 1 : 5), sy - 2 + bob, 2, 2);
    mobHp(an, sx, sy + bob);
  }
  function drawChicken(an) {
    const sx = an.px - cam.x, sy = an.py - cam.y, bob = Math.sin(an.wob) * 1.2, fl = an.dirx < 0;
    ctx.fillStyle = an.hurtT > 0 ? "#fff" : "#fafafa"; ctx.fillRect(sx - 6, sy - 2 + bob, 12, 11);
    ctx.fillStyle = an.hurtT > 0 ? "#fff" : "#e2e2e2"; ctx.fillRect(sx - 4, sy + 1 + bob, 7, 5);
    const hx = fl ? sx - 8 : sx + 3;
    ctx.fillStyle = an.hurtT > 0 ? "#fff" : "#fafafa"; ctx.fillRect(hx, sy - 8 + bob, 6, 7);
    ctx.fillStyle = "#e74c3c"; ctx.fillRect(hx + 1, sy - 11 + bob, 4, 3);
    ctx.fillStyle = "#f1a830"; ctx.fillRect(fl ? hx - 2 : hx + 6, sy - 5 + bob, 2, 2);
    ctx.fillStyle = "#000"; ctx.fillRect(hx + (fl ? 1 : 3), sy - 6 + bob, 1, 1);
    ctx.fillStyle = "#f1a830"; ctx.fillRect(sx - 3, sy + 9 + bob, 2, 4); ctx.fillRect(sx + 2, sy + 9 + bob, 2, 4);
    mobHp(an, sx, sy + bob);
  }
  function mobHp(m, sx, sy) {
    if (m.hp >= m.maxHp) return;
    ctx.fillStyle = "#000"; ctx.fillRect(sx - 12, sy - 16, 24, 4);
    ctx.fillStyle = "#ff6b6b"; ctx.fillRect(sx - 12, sy - 16, 24 * (m.hp / m.maxHp), 4);
  }
  // Draws the customizable avatar. Used for the live player AND the creation preview.
  function drawCharacter(g, cx, cy, s, facing, hurt) {
    const shirt = hurt ? "#fff" : character.shirt;
    const hair = hurt ? "#fff" : character.hair;
    const skin = hurt ? "#fff" : "#f0c89a";
    const girl = character.gender === "girl";
    // body / shirt (girls a touch narrower)
    const bw = girl ? 16 : 18;
    g.fillStyle = shirt; g.fillRect(cx - (bw / 2) * s, cy - 11 * s, bw * s, 22 * s);
    // head
    g.fillStyle = skin; g.fillRect(cx - 7 * s, cy - 18 * s, 14 * s, 10 * s);
    // hair: top fringe + (girl) longer sides
    g.fillStyle = hair;
    g.fillRect(cx - 7 * s, cy - 18 * s, 14 * s, 3 * s);
    if (girl) { g.fillRect(cx - 8 * s, cy - 18 * s, 2 * s, 13 * s); g.fillRect(cx + 6 * s, cy - 18 * s, 2 * s, 13 * s); }
    else { g.fillRect(cx - 7 * s, cy - 18 * s, 2 * s, 5 * s); g.fillRect(cx + 5 * s, cy - 18 * s, 2 * s, 5 * s); }
    // eyes
    g.fillStyle = "#000";
    const eo = facing > 0 ? 2 : -2;
    g.fillRect(cx + (-4 + eo) * s, cy - 14 * s, 2 * s, 2 * s);
    g.fillRect(cx + (2 + eo) * s, cy - 14 * s, 2 * s, 2 * s);
  }

  function drawPlayer() {
    const sx = player.px - cam.x, sy = player.py - cam.y;
    drawCharacter(ctx, sx, sy, 1, player.facing, player.hurtT > 0);
    if (player.swingT > 0) {
      const a = Math.atan2(aimTy * TILE + 16 - player.py, aimTx * TILE + 16 - player.px);
      ctx.font = "16px serif"; ctx.textAlign = "center";
      ctx.fillText(ITEMS[HOTBAR[activeSlot]]?.icon || "⛏️", sx + Math.cos(a) * 24, sy + Math.sin(a) * 24 + 6);
    }
  }

  // =====================================================================
  //  UI
  // =====================================================================
  const hotbarEl = document.getElementById("hotbar");
  function renderHotbar() {
    hotbarEl.innerHTML = "";
    HOTBAR.forEach((item, i) => {
      const def = ITEMS[item];
      const slot = document.createElement("div");
      slot.className = "slot" + (i === activeSlot ? " active" : "");
      slot.innerHTML = `<span class="key">${i + 1}</span><span>${def.icon}</span>`;
      if (!def.tool) { const c = inv[item] || 0; slot.innerHTML += `<span class="count">${c}</span>`; if (!c) slot.style.opacity = 0.45; }
      else { slot.innerHTML += `<span class="count">${has(item) ? "✓" : "—"}</span>`; if (!has(item)) slot.style.opacity = 0.45; }
      slot.onclick = () => { activeSlot = i; renderHotbar(); };
      hotbarEl.appendChild(slot);
    });
  }
  function renderHUD() { document.getElementById("hp-fill").style.width = clamp(player.hp / player.maxHp * 100, 0, 100) + "%"; }
  function renderMats() {
    const parts = [];
    if (inv.gem) parts.push("💎" + inv.gem);
    if (inv.ruby) parts.push("🔻" + inv.ruby);
    document.getElementById("mats").textContent = parts.join("  ");
  }
  function updateHUD() {
    document.getElementById("depth").textContent = mode === "overworld" ? "🌳 Overworld" : "🗡️ Dungeon Lv " + dungeonLevel;
    document.getElementById("deaths").textContent = "☠️ " + deaths;
    renderHUD(); renderMats(); updateWarpBtn();
  }
  function renderQuest() {
    const el = document.getElementById("quest"); el.classList.remove("hidden");
    const titleEl = document.getElementById("q-title"), progEl = document.getElementById("q-prog");
    let step, prog, target, done, label;
    if (mode === "dungeon" && dQuest) {
      step = dQuest.def; prog = dQuest.progress; target = step.target; done = dQuest.done;
      label = done ? "✔ Cleared — find ▲ exit (F)" : step.icon + " " + step.title;
    } else if (!owQuest.done) {
      step = OW_QUESTS[owQuest.step]; prog = owQuest.progress; target = step.target; done = false;
      label = step.icon + " " + step.title;
    } else {
      titleEl.className = "done"; titleEl.textContent = "🌿 Find a 🌀 portal for rare loot";
      progEl.innerHTML = `<div class="q-fill" style="width:100%"></div><div class="q-txt">free roam</div>`; return;
    }
    titleEl.className = done ? "done" : ""; titleEl.textContent = label;
    const pct = (prog / target) * 100;
    progEl.innerHTML = `<div class="q-fill" style="width:${pct}%"></div><div class="q-txt">${prog} / ${target}</div>`;
  }

  const craftPanel = document.getElementById("craft-panel");
  function toggleCraft() { craftPanel.classList.toggle("hidden"); if (!craftPanel.classList.contains("hidden")) renderRecipes(); }
  function renderRecipes() {
    const list = document.getElementById("recipe-list"); list.innerHTML = "";
    for (const r of RECIPES) {
      const can = Object.entries(r.cost).every(([it, n]) => has(it, n));
      const costStr = Object.entries(r.cost).map(([it, n]) => `${ITEMS[it].icon}${n}`).join("  ");
      const el = document.createElement("div");
      el.className = "recipe" + (can ? "" : " locked");
      el.innerHTML = `<div class="r-icon">${r.icon}</div><div class="r-body"><div class="r-name">${r.name}</div><div class="r-cost">${costStr} · <i>${r.desc}</i></div></div>`;
      el.onclick = () => { if (can) craft(r); };
      list.appendChild(el);
    }
  }
  function craft(r) {
    if (!Object.entries(r.cost).every(([it, n]) => has(it, n))) return;
    for (const [it, n] of Object.entries(r.cost)) take(it, n);
    if (r.special === "maxhp") { player.maxHp += 25; player.hp = player.maxHp; toast("❤️ Max HP +25!"); renderHUD(); }
    else if (r.special === "atk") { player.atk += 10; toast("🗡️ Attack +10!"); }
    else { give(r.out, r.qty); questEvent("craft", r.out, 1); toast("Crafted " + r.name + "!"); }
    renderRecipes(); saveGame();
  }

  function toast(msg) {
    const now = performance.now();
    if (msg === toast._last && now - toast._t < 1200) return; // throttle duplicates
    toast._last = msg; toast._t = now;
    const el = document.getElementById("toast");
    const m = document.createElement("div"); m.className = "toast-msg"; m.textContent = msg;
    el.appendChild(m); setTimeout(() => m.remove(), 1800);
  }

  // =====================================================================
  //  SCENES: title / pause / death
  // =====================================================================
  function savedName() { try { return JSON.parse(localStorage.getItem(SAVE_KEY))?.character?.name; } catch (e) { return null; } }
  function showTitle() {
    scene = "title"; paused = false;
    document.getElementById("title").classList.remove("hidden");
    document.getElementById("create").classList.add("hidden");
    document.getElementById("pause").classList.add("hidden");
    document.getElementById("death").classList.add("hidden");
    craftPanel.classList.add("hidden");
    pauseBtn.classList.add("hidden");
    warpBtn.classList.add("hidden");
    const sn = savedName();
    const cont = document.getElementById("btn-continue");
    cont.disabled = !hasSave();
    cont.textContent = sn ? `Continue (${sn})` : "Continue";
  }

  // ----- Character creation screen -----
  const createScreen = document.getElementById("create");
  function showCreate() {
    document.getElementById("title").classList.add("hidden");
    createScreen.classList.remove("hidden");
    document.getElementById("char-name").value = character.name === "Hero" ? "" : character.name;
    buildCreateOptions();
    drawPreview();
  }
  function swatch(parent, sel, onPick, opts) {
    parent.innerHTML = "";
    for (const o of opts) {
      const b = document.createElement("div");
      b.className = "sw" + (o.text ? " text" : "") + (sel === o.val ? " sel" : "");
      if (o.text) b.textContent = o.text; else b.style.background = o.val;
      b.onclick = () => { onPick(o.val); buildCreateOptions(); drawPreview(); };
      parent.appendChild(b);
    }
  }
  function buildCreateOptions() {
    swatch(document.getElementById("opt-gender"), character.gender, v => character.gender = v,
      [{ val: "boy", text: "Boy" }, { val: "girl", text: "Girl" }]);
    swatch(document.getElementById("opt-hair"), character.hair, v => character.hair = v, HAIR_COLORS.map(c => ({ val: c })));
    swatch(document.getElementById("opt-shirt"), character.shirt, v => character.shirt = v, SHIRT_COLORS.map(c => ({ val: c })));
  }
  function drawPreview() {
    const cv = document.getElementById("char-preview"), g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#356b2e"; g.fillRect(0, cv.height - 16, cv.width, 16);
    drawCharacter(g, cv.width / 2, cv.height / 2 + 4, 3, 1, false);
  }
  function startPlay() {
    document.getElementById("title").classList.add("hidden");
    document.getElementById("death").classList.add("hidden");
    document.getElementById("pause").classList.add("hidden");
    scene = "play"; paused = false;
    if (isTouchDevice()) touchEl.classList.remove("hidden");
    pauseBtn.classList.remove("hidden");
    activeSlot = 0;
    renderHotbar(); updateHUD(); renderQuest();
  }
  function newGame() {
    for (const k in inv) delete inv[k];
    for (const k in miningHp) delete miningHp[k];
    deaths = 0; dungeonsCleared = 0; player = null;
    owQuest.step = 0; owQuest.progress = 0; owQuest.done = false;
    ensurePlayer(); player.hp = player.maxHp = 100; player.atk = 8;
    generateOverworld();
    give("torch", 5); give("wood", 2); give("stone", 2);
    startPlay();
    toast("📜 " + character.name + ", chop 3 wood to begin!");
    saveGame();
  }
  function continueGame() { if (loadGame()) { startPlay(); toast("Welcome back!"); } else newGame(); }

  function togglePause() {
    if (scene !== "play") return;
    paused = !paused;
    document.getElementById("pause").classList.toggle("hidden", !paused);
    document.getElementById("save-note").textContent = "";
  }
  function onDeath() {
    deaths++; saveGame();
    scene = "play"; paused = true; // freeze world behind overlay
    document.getElementById("death-note").textContent = `${character.name} has fallen. Total deaths: ${deaths}. Your stuff is safe.`;
    document.getElementById("death").classList.remove("hidden");
  }
  function respawn() {
    document.getElementById("death").classList.add("hidden");
    paused = false;
    if (!owSnap) generateOverworld(); else applyOverworld();
    // move to a safe grass tile and heal
    const s = findType(T.GRASS); setSpawn(s);
    player.hp = player.maxHp;
    updateHUD(); renderQuest();
    toast("🌿 Respawned in the overworld");
  }

  // ---------- Fullscreen canvas (fills window, never crops) ----------
  function resizeCanvas() {
    VIEW_W = canvas.width = Math.max(320, Math.floor(window.innerWidth));
    VIEW_H = canvas.height = Math.max(240, Math.floor(window.innerHeight));
    ctx.imageSmoothingEnabled = false;   // reset after a resize
    mouse.x = VIEW_W / 2; mouse.y = VIEW_H / 2;
  }
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));

  // ---------- Wire up menus ----------
  document.getElementById("btn-new").onclick = showCreate;
  document.getElementById("btn-start").onclick = () => {
    const nm = document.getElementById("char-name").value.trim();
    character.name = nm || "Hero";
    createScreen.classList.add("hidden");
    newGame();
  };
  document.getElementById("btn-create-back").onclick = showTitle;
  document.getElementById("btn-continue").onclick = continueGame;
  document.getElementById("btn-help").onclick = () => document.getElementById("help-box").classList.toggle("hidden");
  document.getElementById("btn-resume").onclick = togglePause;
  document.getElementById("btn-save").onclick = () => { document.getElementById("save-note").textContent = saveGame() ? "✔ Saved!" : "Save failed"; };
  document.getElementById("btn-quit").onclick = () => { saveGame(); showTitle(); };
  document.getElementById("btn-respawn").onclick = respawn;
  document.getElementById("btn-death-quit").onclick = () => { showTitle(); };

  // ---------- Boot ----------
  initStick(); initTouchButtons(); resizeCanvas();
  renderHotbar(); showTitle();
  requestAnimationFrame(loop);
})();
