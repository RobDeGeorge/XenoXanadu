/* =====================================================================
   NEON TILT — a tiny pinball arcade.  Pure Canvas + vanilla JS.
   Multiball, drop targets, combo multipliers, sound, and neon polish.
   Desktop (arrows/space) + touch.
   ===================================================================== */
(() => {
  "use strict";
  const W = 480, H = 720;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // ---------- Table geometry ----------
  const E = 0.5;
  const WALLS = [
    // left wall + lower-left funnel (ends exactly at the flipper pivot — no crack)
    [24, 150, 24, 560, E], [24, 560, 132, 636, E],
    // lower-right funnel (ends at the right flipper pivot) + field right wall
    [324, 636, 432, 560, E], [432, 560, 432, 150, E],
    // ceiling
    [432, 150, 420, 128, E], [420, 128, 340, 104, E], [340, 104, 228, 98, E],
    [228, 98, 120, 104, E], [120, 104, 40, 128, E], [40, 128, 24, 150, E],
    // plunger lane
    [432, 560, 432, 706, E], [462, 150, 462, 706, E], [432, 706, 462, 706, E],
    [462, 150, 420, 128, E],
  ];
  const SLINGS = [
    [96, 560, 150, 602, 1.3],
    [360, 560, 306, 602, 1.3],
  ];
  const BUMPERS = [
    { x: 150, y: 250, r: 22, pulse: 0 }, { x: 306, y: 250, r: 22, pulse: 0 }, { x: 228, y: 178, r: 24, pulse: 0 },
  ];
  const POSTS = [{ x: 228, y: 332, r: 9 }];
  // Drop-target bank (left). When all down -> bonus + multiball, then reset.
  const TARGETS = [
    { x: 58, y: 308, h: 15, down: false }, { x: 58, y: 348, h: 15, down: false }, { x: 58, y: 388, h: 15, down: false },
  ];
  let targetResetT = 0;

  // ---------- Flippers ----------
  function makeFlipper(px, py, side) {
    const rest = side < 0 ? 0.42 : Math.PI - 0.42;
    const flip = side < 0 ? -0.52 : Math.PI + 0.52;
    return { px, py, len: 78, r: 9, side, rest, flip, a: rest, prevA: rest, av: 0, on: false };
  }
  // pivots spread so the tips leave a ~50px center drain gap (ball can't cradle)
  const flippers = [makeFlipper(132, 636, -1), makeFlipper(324, 636, +1)];

  // ---------- Balls (array supports multiball) ----------
  const R = 10, GRAV = 1500, MAXV = 1500;
  let ballsArr = [];
  function serveBall() { ballsArr.push({ x: 447, y: 690, vx: 0, vy: 0, r: R, inLane: true }); launchPow = 0; launchHeld = false; updateLaunchBtn(); }
  function spawnBall(x, y, vx, vy) { ballsArr.push({ x, y, vx, vy, r: R, inLane: false }); }

  // ---------- Game state ----------
  let scene = "title";
  let score = 0, lives = 3;
  let best = +(localStorage.getItem("neon_tilt_best") || 0);
  let launchHeld = false, launchPow = 0;
  let combo = 0, comboT = 0;
  const sparks = [], pops = [];
  let message = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function flipTip(f, ang) { return { x: f.px + Math.cos(ang) * f.len, y: f.py + Math.sin(ang) * f.len }; }
  function closest(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    let t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return { x: ax + t * dx, y: ay + t * dy };
  }

  // ---------- Sound (WebAudio) ----------
  let actx = null;
  function initAudio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } }
  function blip(freq, dur = 0.08, type = "square", vol = 0.14) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur);
  }
  function sweep(f1, f2, dur = 0.2, vol = 0.12) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "sawtooth"; o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur);
  }
  function arpeggio(notes, step = 0.07) { notes.forEach((n, i) => setTimeout(() => blip(n, 0.09, "triangle", 0.16), i * step * 1000)); }

  // ---------- Scoring ----------
  function updateScore() { document.getElementById("score").textContent = score; }
  function hit(base, x, y) {
    comboT = 2; combo = Math.min(combo + 1, 9);
    const pts = base * combo; score += pts; updateScore();
    pops.push({ x, y, text: "+" + pts + (combo > 1 ? "  x" + combo : ""), life: 0.9, c: combo > 1 ? "#ffd34a" : "#7af0ff" });
    sparkBurst(x, y, combo > 1 ? "#ffd34a" : "#7af0ff");
  }
  function bonus(pts, text) {
    score += pts; updateScore();
    message = { text, life: 1.6 };
    arpeggio([523, 659, 784, 1046]);
    pops.push({ x: W / 2, y: 360, text: "+" + pts, life: 1.2, c: "#ff7ad9" });
  }
  function sparkBurst(x, y, c) {
    for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28, s = 70 + Math.random() * 140; sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, c }); }
  }
  function showMsg(text) { message = { text, life: 1.3 }; }

  // ---------- Physics ----------
  function bounce(b, nx, ny, e, pvx = 0, pvy = 0) {
    const rvx = b.vx - pvx, rvy = b.vy - pvy, vn = rvx * nx + rvy * ny;
    if (vn < 0) { const j = -(1 + e) * vn; b.vx += j * nx; b.vy += j * ny; }
  }
  function collideSeg(b, ax, ay, bx, by, e, pad) {
    const c = closest(b.x, b.y, ax, ay, bx, by);
    let dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy);
    const rad = b.r + (pad || 0);
    if (d < rad) {
      if (d < 1e-4) { dx = 0; dy = -1; d = 1; }
      const nx = dx / d, ny = dy / d; b.x = c.x + nx * rad; b.y = c.y + ny * rad; bounce(b, nx, ny, e); return true;
    }
    return false;
  }
  function collideCircle(b, cx, cy, cr, e, kick) {
    let dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy); const rad = cr + b.r;
    if (d < rad) {
      if (d < 1e-4) { dx = 0; dy = -1; d = 1; }
      const nx = dx / d, ny = dy / d; b.x = cx + nx * rad; b.y = cy + ny * rad; bounce(b, nx, ny, e);
      if (kick) { b.vx += nx * kick; b.vy += ny * kick; } return true;
    }
    return false;
  }

  function stepFlippers(dt) {
    for (const f of flippers) {
      f.prevA = f.a; const target = f.on ? f.flip : f.rest, sp = 24 * dt;
      f.a = f.a < target ? Math.min(target, f.a + sp) : Math.max(target, f.a - sp);
      f.av = (f.a - f.prevA) / dt;
    }
  }

  function physics(dt) {
    stepFlippers(dt);
    if (targetResetT > 0) { targetResetT -= dt; if (targetResetT <= 0) TARGETS.forEach(t => t.down = false); }

    const survivors = [];
    for (const b of ballsArr) {
      if (b.inLane) {
        b.vy += GRAV * dt; b.y += b.vy * dt;
        if (b.y > 690) { b.y = 690; b.vy = 0; }
        b.x = clamp(b.x, 432 + b.r + 1, 462 - b.r - 1);
        if (b.y <= 152) {          // hand off into the playfield (reliable entry)
          b.inLane = false; b.x = 410; b.y = 150; b.vx = -150; b.vy = clamp(b.vy, -950, -260);
        }
        survivors.push(b); continue;
      }

      const steps = 5, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        b.vy += GRAV * h;
        const v = Math.hypot(b.vx, b.vy); if (v > MAXV) { b.vx *= MAXV / v; b.vy *= MAXV / v; }
        b.x += b.vx * h; b.y += b.vy * h;

        for (const w of WALLS) collideSeg(b, w[0], w[1], w[2], w[3], w[4]);
        SLINGS.forEach((sl, i) => { if (collideSeg(b, sl[0], sl[1], sl[2], sl[3], sl[4])) { hit(25, b.x, b.y); blip(440, 0.05, "square", 0.12); } });
        BUMPERS.forEach((bp) => { if (collideCircle(b, bp.x, bp.y, bp.r, 1.45, 130)) { hit(50, bp.x, bp.y); bp.pulse = 1; blip(620 + Math.random() * 80, 0.07, "square", 0.13); } });
        POSTS.forEach(p => collideCircle(b, p.x, p.y, p.r, 0.6, 0));

        // drop targets
        TARGETS.forEach(t => {
          if (t.down) return;
          if (collideSeg(b, t.x, t.y - t.h, t.x, t.y + t.h, 0.4)) {
            t.down = true; hit(75, t.x + 14, t.y); blip(880, 0.06, "triangle", 0.13);
            if (TARGETS.every(q => q.down)) {
              bonus(1000, "TARGET BANK!  MULTIBALL");
              targetResetT = 3;
              spawnBall(190, 430, -90, -260); spawnBall(266, 430, 90, -260);
            }
          }
        });

        // flippers (moving surface)
        for (const f of flippers) {
          const tip = flipTip(f, f.a), c = closest(b.x, b.y, f.px, f.py, tip.x, tip.y);
          let dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy); const rad = b.r + f.r;
          if (d < rad) {
            if (d < 1e-4) { dx = 0; dy = -1; d = 1; }
            const nx = dx / d, ny = dy / d; b.x = c.x + nx * rad; b.y = c.y + ny * rad;
            const pvx = -f.av * (c.y - f.py), pvy = f.av * (c.x - f.px);
            bounce(b, nx, ny, 0.45, pvx, pvy);
          }
        }
      }
      // anti-stuck: free a ball wedged near the flippers (only when not being cradled)
      const spd = Math.hypot(b.vx, b.vy);
      if (b.y > 470 && spd < 45 && !flippers[0].on && !flippers[1].on) {
        b.stuckT = (b.stuckT || 0) + dt;
        if (b.stuckT > 0.55) { b.vx += (b.x < 228 ? 1 : -1) * 95 + (Math.random() * 40 - 20); b.vy -= 150; b.stuckT = 0; }
      } else b.stuckT = 0;
      if (b.y > H + 30) { blip(140, 0.22, "sawtooth", 0.12); continue; } // drained
      survivors.push(b);
    }
    ballsArr = survivors;
    if (ballsArr.length === 0 && scene === "play") loseLife();
  }

  function loseLife() {
    lives--; document.getElementById("balls").textContent = "●".repeat(Math.max(0, lives));
    combo = 0;
    if (lives <= 0) { gameOver(); return; }
    showMsg("BALL " + (4 - lives));
    serveBall();
  }
  function fireLaunch() {
    const b = ballsArr.find(x => x.inLane); if (!b) return;
    const p = clamp(launchPow, 0.2, 1);
    b.vy = -(1350 + p * 600); b.vx = -60;
    launchPow = 0; launchHeld = false; updateLaunchBtn();
    sweep(180, 520, 0.18, 0.12);
  }
  function updateLaunchBtn() {
    const b = document.getElementById("launch-btn");
    b.classList.toggle("hidden", !(scene === "play" && isTouch && ballsArr.some(x => x.inLane)));
  }

  // ---------- Loop ----------
  let last = 0;
  function loop(t) {
    const dt = Math.min(0.033, (t - last) / 1000) || 0; last = t;
    if (scene === "play") {
      if (launchHeld && ballsArr.some(x => x.inLane)) launchPow = clamp(launchPow + dt * 1.3, 0, 1);
      physics(dt);
      if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
      for (const b of BUMPERS) if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - dt * 5);
      for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 400 * dt; if ((s.life -= dt) <= 0) sparks.splice(i, 1); }
      for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.y -= 28 * dt; if ((p.life -= dt) <= 0) pops.splice(i, 1); }
      if (message && (message.life -= dt) <= 0) message = null;
    }
    render(); requestAnimationFrame(loop);
  }

  // ---------- Render ----------
  function render() {
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#14163a"); g.addColorStop(1, "#0a0a16");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // dot grid
    ctx.fillStyle = "rgba(120,140,255,0.05)";
    for (let y = 60; y < H; y += 30) for (let x = 40; x < W - 20; x += 30) ctx.fillRect(x, y, 2, 2);
    // faint center logo
    ctx.save(); ctx.globalAlpha = 0.06; ctx.fillStyle = "#7af0ff"; ctx.font = "bold 40px Trebuchet MS"; ctx.textAlign = "center";
    ctx.fillText("NEON", 228, 440); ctx.fillText("TILT", 228, 480); ctx.restore();

    for (const p of POSTS) { ctx.fillStyle = "#3a3a66"; circ(p.x, p.y, p.r); }

    // drop targets
    for (const t of TARGETS) {
      ctx.fillStyle = t.down ? "rgba(120,140,255,0.18)" : "#ffae3a";
      if (!t.down) { ctx.shadowColor = "#ffae3a"; ctx.shadowBlur = 10; }
      ctx.fillRect(t.x - 4, t.y - t.h, 8, t.h * 2); ctx.shadowBlur = 0;
    }

    // bumpers
    BUMPERS.forEach((b) => {
      const pu = b.pulse;
      ctx.fillStyle = "#2a2a55"; circ(b.x, b.y, b.r + 4 + pu * 4);
      ctx.save(); ctx.shadowColor = "#ff4fb0"; ctx.shadowBlur = 12 + pu * 18;
      ctx.fillStyle = pu > 0.4 ? "#ffffff" : "#ff4fb0"; circ(b.x, b.y, b.r); ctx.restore();
      ctx.fillStyle = "#0a0a16"; circ(b.x, b.y, b.r * 0.5);
      ctx.fillStyle = pu > 0.2 ? "#fff" : "#7af0ff"; circ(b.x, b.y, b.r * 0.28);
    });

    // slingshots
    SLINGS.forEach((s) => { ctx.save(); ctx.shadowColor = "#7af0ff"; ctx.shadowBlur = 8; ctx.strokeStyle = "#7af0ff"; ctx.lineWidth = 7; lin(s[0], s[1], s[2], s[3]); ctx.restore(); });

    // walls
    ctx.save(); ctx.shadowColor = "#3a4aa0"; ctx.shadowBlur = 6; ctx.strokeStyle = "#5566c0"; ctx.lineWidth = 5; ctx.lineCap = "round";
    for (const w of WALLS) lin(w[0], w[1], w[2], w[3]); ctx.restore();

    // flippers
    for (const f of flippers) {
      const tip = flipTip(f, f.a);
      ctx.save(); ctx.shadowColor = "#ffd34a"; ctx.shadowBlur = 10; ctx.strokeStyle = "#ffd34a"; ctx.lineWidth = f.r * 2; ctx.lineCap = "round";
      lin(f.px, f.py, tip.x, tip.y); ctx.restore();
      ctx.fillStyle = "#7a5a10"; circ(f.px, f.py, f.r);
    }

    // plunger charge
    if (scene === "play" && ballsArr.some(x => x.inLane)) { const h = 80 * launchPow; ctx.fillStyle = "#43c0e0"; ctx.fillRect(440, 706 - h, 14, h); }

    // balls
    for (const b of ballsArr) {
      ctx.save(); ctx.shadowColor = "#cfe4ff"; ctx.shadowBlur = 14;
      const bg = ctx.createRadialGradient(b.x - 3, b.y - 4, 1, b.x, b.y, b.r);
      bg.addColorStop(0, "#fff"); bg.addColorStop(1, "#8aa0c0"); ctx.fillStyle = bg; circ(b.x, b.y, b.r); ctx.restore();
    }

    // sparks & popups
    for (const s of sparks) { ctx.globalAlpha = clamp(s.life * 2, 0, 1); ctx.fillStyle = s.c; ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3); }
    ctx.globalAlpha = 1; ctx.textAlign = "center";
    for (const p of pops) { ctx.globalAlpha = clamp(p.life * 1.4, 0, 1); ctx.font = "bold 16px Trebuchet MS"; ctx.fillStyle = "#000"; ctx.fillText(p.text, p.x + 1, p.y + 1); ctx.fillStyle = p.c; ctx.fillText(p.text, p.x, p.y); }
    ctx.globalAlpha = 1;

    // combo meter
    if (combo > 1) { ctx.fillStyle = "#ffd34a"; ctx.font = "bold 14px Trebuchet MS"; ctx.textAlign = "left"; ctx.fillText("COMBO x" + combo, 28, 700); }

    // center message
    if (message) {
      ctx.globalAlpha = clamp(message.life, 0, 1); ctx.textAlign = "center";
      ctx.font = "bold 26px Trebuchet MS"; ctx.fillStyle = "#000"; ctx.fillText(message.text, W / 2 + 2, 332);
      ctx.fillStyle = "#ff7ad9"; ctx.fillText(message.text, W / 2, 330); ctx.globalAlpha = 1;
    }
  }
  function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
  function lin(a, b, c, d) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }

  // ---------- Scenes ----------
  function startGame() {
    initAudio();
    score = 0; lives = 3; combo = 0; comboT = 0;
    ballsArr = []; sparks.length = 0; pops.length = 0; message = null;
    TARGETS.forEach(t => t.down = false); targetResetT = 0;
    updateScore();
    document.getElementById("balls").textContent = "●●●";
    document.getElementById("best").textContent = "BEST " + best;
    document.getElementById("overlay").classList.add("hidden");
    document.getElementById("gameover").classList.add("hidden");
    if (isTouch) document.getElementById("touch").classList.remove("hidden");
    scene = "play"; serveBall(); showMsg("BALL 1");
  }
  function gameOver() {
    scene = "over";
    if (score > best) { best = score; localStorage.setItem("neon_tilt_best", best); }
    document.getElementById("final").textContent = `Score ${score}  ·  Best ${best}`;
    document.getElementById("gameover").classList.remove("hidden");
    blip(120, 0.4, "sawtooth", 0.14);
  }

  // ---------- Input ----------
  const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  function setFlip(side, on) { for (const f of flippers) if (f.side === side && f.on !== on) { f.on = on; if (on) blip(170, 0.03, "square", 0.08); } }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a" || k === "z") setFlip(-1, true);
    if (k === "arrowright" || k === "l" || k === "/") setFlip(1, true);
    if (k === " ") { e.preventDefault(); if (scene === "play" && ballsArr.some(x => x.inLane)) launchHeld = true; }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a" || k === "z") setFlip(-1, false);
    if (k === "arrowright" || k === "l" || k === "/") setFlip(1, false);
    if (k === " ") { if (launchHeld) fireLaunch(); }
  });

  function zone(sel, side) {
    const el = document.querySelector(sel);
    el.addEventListener("touchstart", (e) => { e.preventDefault(); setFlip(side, true); }, { passive: false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); setFlip(side, false); }, { passive: false });
    el.addEventListener("touchcancel", () => setFlip(side, false));
  }
  zone(".flip-zone.left", -1); zone(".flip-zone.right", 1);
  const lb = document.getElementById("launch-btn");
  lb.addEventListener("touchstart", (e) => { e.preventDefault(); if (ballsArr.some(x => x.inLane)) launchHeld = true; }, { passive: false });
  lb.addEventListener("touchend", (e) => { e.preventDefault(); fireLaunch(); }, { passive: false });

  document.getElementById("play-btn").onclick = startGame;
  document.getElementById("again-btn").onclick = startGame;

  // ---------- Fit (contain) ----------
  function fit() {
    const m = 8, scale = Math.min((window.innerWidth - m) / W, (window.innerHeight - m) / H);
    canvas.style.width = W * scale + "px"; canvas.style.height = H * scale + "px";
  }
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", () => setTimeout(fit, 120));
  fit();
  setInterval(updateLaunchBtn, 200);
  requestAnimationFrame(loop);
})();
