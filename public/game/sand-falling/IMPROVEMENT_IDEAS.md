# Sand Garden AI — improvement ideas (live monitoring)

Monitoring window: **started 2026-06-13 14:24 MST**, target ~1 hour.
Watching: bridge move-log + offline Ollama experiments. I'll keep appending.

Model in play: `gemma4:12b-it-qat`.

---

## Observations log

### 14:24 — first 7 moves
Move stream: `brick(22,15) → crystal(24,13) → fire(31,4) → fish(38,20) → sparkle(32,15) → crystal(35,10) → crystal(36,11)`

What I notice:
- **Fish painted on dry land (38,20)** with no water anywhere → they just flop and sink. The model doesn't know materials have prerequisites (fish need water, seeds want soil/water, fire needs fuel).
- **Scattered single dabs**, no spatial plan — moves jump around (22,15)→(24,13)→(31,4)→(38,20). No sense of "I'm building a lake here, a forest there."
- **Repetition** — crystal three times in a row at nearly the same spot (35,10),(36,11). Little awareness of what it just did.
- It can't *see results* of prior moves clearly (the ASCII is coarse 44×25), so no feedback loop ("did my water actually pool?").

---

## Candidate improvements (to discuss & prioritize)

> Rough buckets. Will refine/score as I gather more data.

### A. Make it play *better* (smarter moves)
1. **Material "recipes" / hints in the prompt** — a short cheat-sheet of what each material needs and does (fish→needs water first; seed→sprouts on soil/near water; fire→needs plants/wood to spread; lava+water→stone). Cheapest high-impact change.
2. **Short-term memory of recent moves** — feed the model its last 3–5 actions so it stops repeating and can build sequences ("I made a basin, now fill it").
3. **Goals / intentions** — let it set a multi-step goal ("build a volcano") and pursue it across turns, instead of one disconnected dab per turn. Could add a `plan` field it carries forward.
4. **Bigger/repeatable strokes** — encourage it to commit (paint a real lake, not a 3-region dot). Maybe allow a `line`/`fill` action or multiple dabs per turn.

### B. Make it more *fun to watch* (your main goal)
5. **Show the streamed thinking *and* keep a scrollable transcript** of past turns (right now each turn wipes the box). A history of its inner monologue is the best "sit back and watch."
6. **Narration vs action split** — give it a tiny persona ("a whimsical garden spirit") so the thoughts are characterful, not dry.
7. **Caption overlay on the canvas** — float its current one-line intention near where it's painting, so you read what it's doing where it's doing it.
8. **Pace control in the UI** — a speed slider for move delay, and a "step once" button.

### C. Technical / reliability
9. **Faster model option surfaced in UI** — a model dropdown (it pulls `/api/tags`), so you can flip to a 3B for snappy play vs 12B for smarter play without restarting.
10. **Log the thinking server-side** — currently only actions are logged; capturing reasoning would help us tune the prompt (and let me analyze quality during monitoring).
11. **Give the model feedback** — after a move, tell it what changed ("your water is now pooling at the bottom") so it has a real perception→action loop.
12. **Guard against off-board / no-op moves** — count how often actions fail to parse or land somewhere pointless.

---

### 14:33 — moves 8–20 (13 new)
Stream: `sparkle(34,15) vine(31,16) crystal(30,14) brick(18,15) sparkle(20,18) crystal(20,14) crystal(28,10) lava(35,20) lava(40,2) sparkle(38,5) crystal(23,16) seed(35,15) sparkle(28,15)`

Patterns over 20 moves:
- **Material fixation**: crystal ~7/20 and sparkle ~5/20. The model keeps reaching for the same 2–3 names. Low diversity.
- **NEVER paints water** in 20 moves — yet it painted fish (needs water) and a seed (wants water). Zero dependency reasoning.
- **100% `paint` actions** — never used `birds`, `clear`, or `wait`. The richer interactions just aren't happening.
- Still spatially scattered; clusters in the mid-band (x:18–40, y:10–20). Never deliberately rains from the top or lays a foundation at the bottom.
- No parse failures so far (the THINKING→ACTION format is holding up well). ✅

### 14:33 — offline experiment ✅ (strong signal)
Tested a prompt with **(a) RECIPES/dependencies, (b) last-5 moves memory, (c) "vary your materials"**.
Given "fish flopping on dry land, no water," the model replied:
> *"To save the flopping fish and create an aquatic environment, I need to introduce water."*
> `ACTION: paint water at (38,21) r4`

→ Instantly produced the dependency-aware, coherent move that's been missing. **This validates idea #1 (recipes) and #2 (recent-move memory) as the highest-impact, lowest-cost changes.** Both are pure prompt/server edits — no UI work.

---

## ⭐ Leading recommendations (so far)
1. **Recipe/dependency cheat-sheet in the system prompt** — proven to flip behavior toward coherent, goal-directed play. ~10 lines in `server.js`. **Do first.**
2. **Feed last 3–5 actions back to the model** — kills the crystal-spam repetition, enables sequences. Small `aiLoop` change.
3. **Nudge material & action variety** — explicitly "don't repeat; you can also release birds / clear / wait." It currently only ever paints.
4. **(Watch-ability) scrollable thought transcript + on-canvas caption** — your stated goal; biggest "sit back and watch" win once play quality is up.

### 14:42 — moves 21–33 (13 new) — fixation worsening
Material tally over **all 33 moves**: `crystal 11 (33%!), sparkle 7, seed 4, fish 3, vine 2, lava 2, brick 2, lightning 1, fire 1` — **water 0, plant 0, ice 0, birds 0, clear 0, wait 0**.
- **Crystal is now a third of every move** — fixation is getting *worse* over time, not better. This is the #1 quality problem.
- **Three checks in a row with zero water.** It painted fish 3× and seeds 4× this whole session and never once made the water they need.
- **`fish at (38,24)`** — bottom edge (y=24 = void); the fish flops straight off-board. Model has no sense of the deadly edges.
- **lightning(20,15)** with no water nearby → fizzles (its whole point is electrifying pools).
- Still **100% paint**, still zero parse errors / stable connection.

### 14:42 — offline experiment ✅ (anti-fixation mechanism)
Fed the model its **own material-usage tally** ("crystal:11 … water:0 … try the underused ones") + edge warning.
> *"To support the life in the board, I need to introduce water for the fish and seeds."*
> `ACTION: paint water (22,18) r6` — a big, deliberate lake stroke.

→ Broke the crystal fixation AND addressed dependencies in one move. **Tracking per-material counts in `aiLoop` and feeding them back is a concrete, cheap, high-impact feature.** (~41s this run due to GPU contention with the live session.)

---

## ⭐⭐ Top 3 validated, ready to build (all server/prompt — no UI risk)
1. **Recipe/dependency cheat-sheet** in the system prompt (fish→water, seed→water/soil, fire→fuel, lava+water→stone, lightning→water, edges=void). *Proven 2×.*
2. **Recent-moves memory** (last 3–5 actions) → kills repetition, enables sequences.
3. **Per-material usage tally fed back** ("you've used crystal 11×, water 0× — try fresh ones") → directly breaks the dominant fixation. *Proven.*

All three combine into ~20 lines in `server.js` (`aiLoop` builds a small `memory` + `tally` string into the user message; recipes go in `SYSTEM`). Biggest play-quality win for the least code.

### 14:51 — moves 34–42 (9 new) — it self-corrects, but *slowly*
Stream: `fire(38,5) lava(40,2) lightning(5,24) [released 10 birds] lava(35,2) sparkle(35,8) water(20,5) crystal(38,15) water(5,2)`
- **First `birds` action of the session** (released 10) — variety beyond paint finally appeared. 🎉
- **First water of the session** (2×, at y=5 and y=2) — after **33 dry moves**. Placed high → rains down, which is actually nice.
- Takeaway: the model *is* capable of water/birds/coherent moves — it just **stumbles into them ~30 moves late**. The validated prompt fixes would make this the default from move 1 instead of an accident at move 37.
- Still: lava painted high (40,2)/(35,2) and lightning at (5,24) edge — weak spatial/edge awareness persists.
- Tally (42 moves): `crystal 12, sparkle 8, seed 4, lava 4, fish 3, water 2, vine 2, lightning 2, fire 2, brick 2`. Still no `clear`/`wait`. Zero parse errors; connection stable.

---

## Offline experiments
- 14:33: recipe+memory prompt → model added water for the fish. Confirmed.
- 14:42: usage-tally feedback → model painted a deliberate r6 lake for its fish/seeds. Confirmed.
- 14:51: (skipped — let the live session run; top 3 already validated.)

### 14:59 — moves 43–50 (8 new) — diversity holding; first parse failure
Stream: `crystal(35,10) fire(15,8) water(25,10) water(25,5) fire(35,18) [released 15 birds] sparkle(20,10) fire(30,12)`
- Diversity is sticking now: **water up to 4, fire up to 5, second birds release (15)**. The model warms into variety after ~35 moves — early-game fixation is the real problem, not a permanent one.
- **First parse failure of the session** — model returned a reply with **no `ACTION:` line** (empty content). Server logged "couldn't read an ACTION — retrying" and moved on. ~2% failure over 50 moves, fully recovered. ✅ robustness is good, but see idea below.
- Tally (50 moves): `crystal 13, sparkle 9, fire 5, water 4, seed 4, lava 4, fish 3, vine 2, lightning 2, brick 2`. Still no `clear`/`wait`.

**New small idea (robustness):** when no `ACTION:` parses, do a single cheap **re-prompt** that turn ("You forgot the ACTION line — output only `ACTION: {…}`") instead of skipping the turn. Cuts the occasional wasted ~20–40s cycle.

### 15:07 — moves 51–59 (9 new) — picture has converged
Stream: `water(10,5) seed(21,13) water(35,2) water(25,20) crystal(20,23) fire(25,10) water(30,15) sparkle(20,13) lava(25,14)`
- **Water surged** — 4 more this batch → **8 total** (doubled). After a 33-move drought it's now a go-to. Distribution flattening: `crystal 14, sparkle 10, water 8, fire 6, seed 5, lava 5, fish 3, vine 2, lightning 2, brick 2`.
- Parse failures **still 1 total** — the earlier miss was a one-off; format is robust (~1.7% over 59 moves).
- **Never once used `clear` or `wait`** in 59 moves — it only ever paints or releases birds. (Not a problem, just a note: the canvas only fills up, never resets/pauses.)

**Conclusion of monitoring:** behavior is now well-characterized and stable. The story is consistent across the whole hour:
- *Capable but unguided* — it eventually does varied, sensible things (water, fire, birds, even rough scenes) but **stumbles into them 30+ moves late**; early game is crystal/sand spam with dependency-blind placements (fish/seeds with no water, things on the void edge).
- *Technically solid* — streaming, palette-selection mirroring, and the THINKING→ACTION format all hold up; ~1.7% recoverable parse failures; stable connection.
- The **validated top-3 prompt/server fixes** would front-load the good behavior to move 1 with ~20 lines of code and zero UI risk. Everything else is polish / watch-ability.

### 15:18 — moves 60–74 (15 new) — only mild new notes
- **First `cloud` and `wood`** of the session → broader material palette in use.
- **Swung hard to water** (7 of last 15 moves) — a near-mirror of the early crystal fixation. Confirms the model **latches onto whatever it's recently done** (recency bias), which is *exactly* what the usage-tally fix (#3) counteracts. Good supporting evidence, not a new idea.
- No new failure modes: parse failures still **1 total**, no clear/wait, server healthy (HTTP 200), no crashes.

### 15:29 — moves 75–92 (18 new) — textbook fixation swing
- This batch is **~half water**. The session now reads as a clean before/after: **crystal-fixated early third → water-fixated final third.** Same recency-bias loop, just flipped material. It's the single clearest illustration of why **fix #3 (usage tally)** matters — the model rides whatever it last did until something jolts it.
- No new failure modes: parse failures still **1 total**, no clear/wait ever, server HTTP 200, no crashes. Monitoring stable; nothing further to add to the recommendations.

### 15:40 — moves 93–107 (15 new) — one small insight
- Model painted **"sand"** (its natural word), not the internal **"sparkle"** — the alias map routed it correctly. Confirms models reach for intuitive names. **Small actionable: rename "sparkle"→"sand" in the palette/legend (or broaden aliases)** so the model's instinctive names always land. Low effort, removes a class of "unknown material" misses.
- Otherwise unchanged: water-heavy, no clear/wait, parse failures still 1 total, server HTTP 200, no crashes.
