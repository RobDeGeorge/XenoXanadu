/* ============================================================
   XenoXanadu — Generative Topographic Contour Background
   Simplex noise + marching squares = animated topo map
   ============================================================ */

(function() {
  'use strict';

  var canvas = document.createElement('canvas');
  canvas.id = 'topoBg';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:0.13;';
  document.body.prepend(canvas);

  var ctx = canvas.getContext('2d');
  var W, H, time = 0;
  var cols = ['#c45d3e', '#c49a3c', '#6b8f71', '#3d7a6e', '#7a7362'];

  // ===== Simplex 2D noise =====
  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;
  var grad3 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  var perm = new Uint8Array(512);
  var p = new Uint8Array(256);

  for (var i = 0; i < 256; i++) p[i] = i;
  for (var i = 255; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (var i = 0; i < 512; i++) perm[i] = p[i & 255];

  function noise2D(x, y) {
    var s = (x + y) * F2;
    var i = Math.floor(x + s);
    var j = Math.floor(y + s);
    var t = (i + j) * G2;
    var x0 = x - (i - t), y0 = y - (j - t);
    var i1 = x0 > y0 ? 1 : 0;
    var j1 = x0 > y0 ? 0 : 1;
    var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    var x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    var ii = i & 255, jj = j & 255;
    var n0 = 0, n1 = 0, n2 = 0;
    var t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { t0 *= t0; var g = grad3[perm[ii + perm[jj]] & 7]; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
    var t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { t1 *= t1; var g = grad3[perm[ii + i1 + perm[jj + j1]] & 7]; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
    var t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { t2 *= t2; var g = grad3[perm[ii + 1 + perm[jj + 1]] & 7]; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * (n0 + n1 + n2);
  }

  // ===== Resize canvas =====
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ===== Draw contour lines via marching squares =====
  function drawContours() {
    ctx.clearRect(0, 0, W, H);

    var step = 6;
    var scale = 0.0028;
    var levels = 14;
    var ox = time * 6;

    var gw = Math.ceil(W / step) + 1;
    var gh = Math.ceil(H / step) + 1;
    var field = new Float32Array(gw * gh);

    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        var nx = (gx * step + ox) * scale;
        var ny = gy * step * scale;
        field[gy * gw + gx] = noise2D(nx, ny) * 0.65 + noise2D(nx * 2.3, ny * 2.3 + 80) * 0.35;
      }
    }

    for (var lev = 0; lev < levels; lev++) {
      var th = -0.75 + (lev / levels) * 1.5;
      ctx.strokeStyle = cols[lev % cols.length];
      ctx.lineWidth = lev % 5 === 0 ? 1.4 : 0.6;
      ctx.globalAlpha = lev % 5 === 0 ? 0.8 : 0.35;
      ctx.beginPath();

      for (var gy = 0; gy < gh - 1; gy++) {
        for (var gx = 0; gx < gw - 1; gx++) {
          var idx = gy * gw + gx;
          var a = field[idx], b = field[idx + 1];
          var c = field[idx + gw + 1], d = field[idx + gw];
          var code = 0;
          if (a >= th) code |= 1;
          if (b >= th) code |= 2;
          if (c >= th) code |= 4;
          if (d >= th) code |= 8;
          if (code === 0 || code === 15) continue;

          var x = gx * step, y = gy * step;
          function lp(v1, v2) { var d = v2 - v1; return Math.abs(d) < 1e-4 ? 0.5 : (th - v1) / d; }
          var tp = x + lp(a, b) * step;
          var rt = y + lp(b, c) * step;
          var bt = x + lp(d, c) * step;
          var lt = y + lp(a, d) * step;

          switch (code) {
            case 1: case 14: ctx.moveTo(x, lt); ctx.lineTo(tp, y); break;
            case 2: case 13: ctx.moveTo(tp, y); ctx.lineTo(x + step, rt); break;
            case 3: case 12: ctx.moveTo(x, lt); ctx.lineTo(x + step, rt); break;
            case 4: case 11: ctx.moveTo(x + step, rt); ctx.lineTo(bt, y + step); break;
            case 5: ctx.moveTo(x, lt); ctx.lineTo(tp, y); ctx.moveTo(x + step, rt); ctx.lineTo(bt, y + step); break;
            case 6: case 9: ctx.moveTo(tp, y); ctx.lineTo(bt, y + step); break;
            case 7: case 8: ctx.moveTo(x, lt); ctx.lineTo(bt, y + step); break;
            case 10: ctx.moveTo(x, lt); ctx.lineTo(bt, y + step); ctx.moveTo(tp, y); ctx.lineTo(x + step, rt); break;
          }
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ===== Animate (slow drift, throttled to ~8fps) =====
  var running = true, lastFrame = 0;
  function animate(ts) {
    if (!running) return;
    if (ts - lastFrame < 125) { requestAnimationFrame(animate); return; }
    lastFrame = ts;
    time += 0.0015;
    drawContours();
    requestAnimationFrame(animate);
  }

  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  resize();
  if (mq.matches) { drawContours(); } else { requestAnimationFrame(animate); }

  window.addEventListener('resize', function() { resize(); drawContours(); });
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) { running = false; } else { running = true; requestAnimationFrame(animate); }
  });
})();
