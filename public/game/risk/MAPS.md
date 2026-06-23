# Making a new Risk map

Every board in Risk is **plain data**. The engine owns the rules; a map just describes
the territories, who's adjacent to whom, and where to draw them. Add a board and it shows
up in the map picker automatically — no engine or renderer changes needed.

- **`engine.js`** — the rules. Ships one built-in board (`CLASSIC_MAP`) and the functions
  `installMap()` / `validateMap()`.
- **`maps.js`** — the **registry** (`window.RiskMaps`). This is where you add your board.
- **`main.js`** — draws whatever map is installed, purely from the data.

> TL;DR: write a `register(build({ ... }))` block in `maps.js`, run `node maps.js` to
> validate, reload the page. That's it.

---

## 1. The shape of a map

A board is one object. You almost never write it by hand in full — you use the `build()`
helper (next section), but this is what it produces:

```js
{
  id:         "mymap",              // unique slug (lowercase, no spaces)
  name:       "My Map",            // shown in the picker
  blurb:      "One-line pitch.",   // shown under the picker
  width:      900,                  // SVG canvas size (user units)
  height:     700,
  terrRadius: 34,                   // default territory blob radius (optional, default 38)
  startArmies:{ 2:30, 3:26, ... },  // armies per player-count (optional — see §6)
  wrapEdges:  [],                   // edges drawn over the top edge (optional — see §7)
  labelNudge: {},                   // per-continent label offsets (optional — see §7)
  continents: { ... },              // id -> { name, bonus, color }
  territories:{ ... },              // id -> { name, cont, x, y, adj:[...] }
}
```

The **territory** is the atom: a screen position (`x`,`y`), the continent it belongs to,
and its **adjacency list**. The renderer draws a low-poly blob at each `x,y` and a line
for each adjacency.

---

## 2. Author with `build({ nodes, edges })` — don't hand-write `adj`

Writing each territory's `adj` array by hand is error-prone (you can easily make A border
B without B bordering A). Instead declare **nodes** and **edges** and let `build()` create
symmetric, de-duplicated adjacency for you:

```js
register(build({
  id: "mymap", name: "My Map", blurb: "...",
  width: 900, height: 700, terrRadius: 34,
  startArmies: { 2: 30, 3: 26, 4: 22, 5: 19, 6: 16 },
  continents: {
    north: { name: "Northrealm", bonus: 4, color: "#5fa8b8" },
    south: { name: "Southmark",  bonus: 3, color: "#cf8a52" },
  },
  nodes: [
    { id: "n1", name: "Frosthold", cont: "north", x: 200, y: 120 },
    { id: "n2", name: "Icereach",  cont: "north", x: 360, y: 140 },
    { id: "s1", name: "Sunvale",   cont: "south", x: 220, y: 420 },
    { id: "s2", name: "Dunemark",  cont: "south", x: 380, y: 440 },
  ],
  edges: [
    ["n1", "n2"],   // list each connection ONCE — both directions are created
    ["s1", "s2"],
    ["n1", "s1"],   // cross-continent border (auto-drawn as a dashed "sea route")
  ],
}));
```

- **`nodes`** — one per territory: `{ id, name, cont, x, y }`. `id` is internal (slug),
  `name` is what the player sees, `cont` must match a key in `continents`.
- **`edges`** — `[a, b]` pairs. List each border **once**; `build()` adds the reverse.
  An edge between two *different* continents is rendered as a dashed sea route.

---

## 3. Continents = the regions worth taking

```js
continents: {
  north: { name: "Northrealm", bonus: 4, color: "#5fa8b8" },
}
```

- **`bonus`** is how many extra reinforcement armies a player gets each turn for holding
  **every** territory in that continent. This is the strategic value of the region.
- **`color`** is the continent's hue. It tints the territories **and** the region backdrop
  (the soft blob behind the territories — drawn automatically, see §8). Use distinct hues
  so neighbouring regions read apart. The existing palette:
  `#5fa8b8` teal · `#cf5a52` red · `#9ec27a` green · `#c7a24a` gold ·
  `#9b86c4` violet · `#cf8a52` orange · `#c06a9b` rose · `#d4b25c` amber.

Every continent must contain at least one territory, and every territory's `cont` must
name a real continent — `validateMap` checks this.

---

## 4. Register it

`register(...)` adds the board to the picker (and validates it, warning in the console if
something's off). Wrap your block in an IIFE if you compute nodes/edges in a loop, so your
locals don't leak — see the existing boards:

```js
(function () {
  var nodes = [], edges = [];
  // ...build them procedurally...
  register(build({ id: "mymap", /* ... */, nodes: nodes, edges: edges }));
})();
```

Place it anywhere among the other `register(...)` calls in `maps.js`. Order in the picker
follows registration order.

---

## 5. Helpers for procedural boards

`maps.js` exposes a few builders so you can generate layouts instead of placing every node
by hand. Use whichever fits your shape:

- **`P(cx, cy, r, deg)`** → `{x,y}` on a circle. Polar placement: `deg 0` = east, `-90` =
  north, `y` grows downward. Great for wheels, spokes, rings, stars.
  *(Used by Arena, Starfall, Bridges.)*
- **`normalize(nodes, margin)`** → shifts a node set so its bounding box sits `margin` from
  the top-left, and **returns `{ width, height }`** for the canvas. Lets a generator work
  in any coordinate space, then fit the board to it.
  *(Used by Hex Dominion, Realms.)*
- **`nearestPair(groupA, groupB)`** → the closest pair of node ids between two groups, e.g.
  `["a3","b1"]`. Handy for dropping a single bridge between two landmasses at their nearest
  coastlines. *(Used by Realms' ring bridges.)*

A typical procedural board:

```js
(function () {
  var nodes = [], edges = [];
  for (var i = 0; i < 6; i++) {
    var p = P(400, 400, 250, -90 + i * 60);     // six points on a ring
    nodes.push({ id: "r" + i, name: "Ward " + (i + 1), cont: "ring", x: p.x, y: p.y });
    if (i > 0) edges.push(["r" + (i - 1), "r" + i]);
  }
  edges.push(["r5", "r0"]);                       // close the ring
  var dim = normalize(nodes, 50);                 // fit canvas to the nodes
  register(build({
    id: "ring", name: "Ringworld", blurb: "...",
    width: dim.width, height: dim.height,
    continents: { ring: { name: "The Ring", bonus: 3, color: "#9ec27a" } },
    nodes: nodes, edges: edges,
  }));
})();
```

---

## 6. Starting armies (`startArmies`)

Optional. A table of armies each player begins with, keyed by player count (2–6):

```js
startArmies: { 2: 30, 3: 26, 4: 22, 5: 19, 6: 16 },
```

If you omit it, the engine derives a reasonable table from the territory count. Roughly,
bigger boards want more starting armies. As a rule of thumb the classic 42-territory board
uses `{2:40, 3:35, 4:30, 5:25, 6:20}`; scale down for small boards (Clash, 16 tiles, uses
`{2:20,…,6:12}`) and up for large ones (Hex Dominion, 61 tiles, uses `{2:54,…,6:32}`).

---

## 7. Optional polish

- **`terrRadius`** — territory blob size. Drop it on dense boards so blobs don't crowd
  (Realms uses 30, Classic 38). Default 38.
- **`wrapEdges: [["alaska","kamchatka"]]`** — edges you want drawn **over the top of the
  board** (a route that "wraps around" the world) instead of as a straight line across it.
  The pair must also appear in `edges` (it's a real adjacency; this just changes how it's
  drawn).
- **`labelNudge: { asia: { x: 95, y: 50 } }`** — nudge a continent's name label off a busy
  centre or onto a one-tile continent. `x`/`y` set an absolute position for that label.

---

## 8. What you get for free

You do **not** draw any of this — the renderer derives it from your data:

- **Territory blobs** at each `x,y`, tinted by owner in-game / by continent in the preview.
- **Adjacency lines**; cross-continent edges become dashed sea routes.
- **Continent region backdrops** — a soft, colour-tinted blob behind each continent's
  territories, labelled with its name and bonus (e.g. `NORTHREALM +4`), so players can see
  which regions are worth taking. These regions are computed as a **partition** of the
  board (every point belongs to its nearest territory), so adjacent regions *share* a
  border but **never overlap**. Nothing to author — just give each continent a `color`.
- **The map picker entry**, with your `name`, territory count, `blurb`, and a live preview.

Because regions are auto-derived from territory positions, keep a continent's territories
**spatially clustered**. Scattering one continent's tiles across the map will produce a
sprawling or fragmented region blob. (A deliberately separate group — like an offshore
island chain — is fine; it just gets its own blob.)

---

## 9. Validate

The engine validates every board. Run it headless:

```bash
cd public/game/risk
node maps.js
```

It prints a ✓/✗ line per board. `validateMap` enforces:

1. Every territory names a real continent and has numeric `x`,`y`.
2. Every territory has a non-empty adjacency list.
3. **Adjacency is symmetric** — no `a→b` without `b→a`. (`build()` guarantees this; you'd
   only break it by hand-editing `territories`.)
4. No self-edges or edges to missing territories.
5. No empty continents.
6. The whole board is **one connected component** — you can walk from any territory to any
   other. (A board split into unreachable islands is rejected; connect them with at least
   one edge, even a sea route.)

A board that fails validation throws when `installMap` tries to load it, so fix all ✗
before shipping.

---

## 10. Checklist

- [ ] `id` is unique and slug-style.
- [ ] Every `node.cont` matches a key in `continents`.
- [ ] Every continent has at least one territory.
- [ ] The board is fully connected (every region reachable).
- [ ] Continents are spatially clustered and use distinct `color`s.
- [ ] `width`/`height` contain all your nodes (use `normalize` if generating).
- [ ] `node maps.js` prints ✓ for your board.
- [ ] Reload the arcade and pick it from the map dropdown.

---

## Worked references

Each shipped board demonstrates a style — read these in `maps.js`:

| Board          | Technique |
|----------------|-----------|
| **Clash**      | nested loops over a 4×4 grid; link left/up |
| **Arena**      | `P()` on inner/outer rings + radial spokes; symmetric |
| **Bridges**    | diamond islands, internal rings + explicit named bridges |
| **Starfall**   | five arms off a core, dead-end tips |
| **Hex Dominion** | axial hex coordinates, 6-way neighbours, `normalize` |
| **Realms**     | grid provinces in a ring joined by `nearestPair` bridges |
| **Aetheria**   | fully hand-placed nodes + hand-listed edges (no generator) |
| **Classic**    | the built-in world (defined in `engine.js`) |
