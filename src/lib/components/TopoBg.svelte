<script>
	import { onMount } from 'svelte';

	let canvas;

	onMount(() => {
		const ctx = canvas.getContext('2d');
		let W, H, time = 0;
		const cols = ['#c45d3e', '#c49a3c', '#6b8f71', '#3d7a6e', '#7a7362'];

		// Simplex 2D noise
		const F2 = 0.5 * (Math.sqrt(3) - 1);
		const G2 = (3 - Math.sqrt(3)) / 6;
		const grad3 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
		const perm = new Uint8Array(512);
		const p = new Uint8Array(256);

		for (let i = 0; i < 256; i++) p[i] = i;
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
		}
		for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

		function noise2D(x, y) {
			const s = (x + y) * F2;
			const i = Math.floor(x + s);
			const j = Math.floor(y + s);
			const t = (i + j) * G2;
			const x0 = x - (i - t), y0 = y - (j - t);
			const i1 = x0 > y0 ? 1 : 0;
			const j1 = x0 > y0 ? 0 : 1;
			const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
			const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
			const ii = i & 255, jj = j & 255;
			let n0 = 0, n1 = 0, n2 = 0;
			let t0 = 0.5 - x0 * x0 - y0 * y0;
			if (t0 >= 0) { t0 *= t0; const g = grad3[perm[ii + perm[jj]] & 7]; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
			let t1 = 0.5 - x1 * x1 - y1 * y1;
			if (t1 >= 0) { t1 *= t1; const g = grad3[perm[ii + i1 + perm[jj + j1]] & 7]; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
			let t2 = 0.5 - x2 * x2 - y2 * y2;
			if (t2 >= 0) { t2 *= t2; const g = grad3[perm[ii + 1 + perm[jj + 1]] & 7]; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
			return 70 * (n0 + n1 + n2);
		}

		function resize() {
			const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
			W = window.innerWidth;
			H = window.innerHeight;
			canvas.width = W * dpr;
			canvas.height = H * dpr;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}

		function drawContours() {
			ctx.clearRect(0, 0, W, H);
			const step = 6;
			const scale = 0.0028;
			const levels = 14;
			const ox = time * 6;
			const gw = Math.ceil(W / step) + 1;
			const gh = Math.ceil(H / step) + 1;
			const field = new Float32Array(gw * gh);

			for (let gy = 0; gy < gh; gy++) {
				for (let gx = 0; gx < gw; gx++) {
					const nx = (gx * step + ox) * scale;
					const ny = gy * step * scale;
					field[gy * gw + gx] = noise2D(nx, ny) * 0.65 + noise2D(nx * 2.3, ny * 2.3 + 80) * 0.35;
				}
			}

			for (let lev = 0; lev < levels; lev++) {
				const th = -0.75 + (lev / levels) * 1.5;
				ctx.strokeStyle = cols[lev % cols.length];
				ctx.lineWidth = lev % 5 === 0 ? 1.4 : 0.6;
				ctx.globalAlpha = lev % 5 === 0 ? 0.8 : 0.35;
				ctx.beginPath();

				for (let gy = 0; gy < gh - 1; gy++) {
					for (let gx = 0; gx < gw - 1; gx++) {
						const idx = gy * gw + gx;
						const a = field[idx], b = field[idx + 1];
						const c = field[idx + gw + 1], d = field[idx + gw];
						let code = 0;
						if (a >= th) code |= 1;
						if (b >= th) code |= 2;
						if (c >= th) code |= 4;
						if (d >= th) code |= 8;
						if (code === 0 || code === 15) continue;

						const x = gx * step, y = gy * step;
						function lp(v1, v2) { const d = v2 - v1; return Math.abs(d) < 1e-4 ? 0.5 : (th - v1) / d; }
						const tp = x + lp(a, b) * step;
						const rt = y + lp(b, c) * step;
						const bt = x + lp(d, c) * step;
						const lt = y + lp(a, d) * step;

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

		let running = true;
		let lastFrame = 0;
		function animate(ts) {
			if (!running) return;
			if (ts - lastFrame < 125) { requestAnimationFrame(animate); return; }
			lastFrame = ts;
			time += 0.0015;
			drawContours();
			requestAnimationFrame(animate);
		}

		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		resize();
		if (mq.matches) { drawContours(); } else { requestAnimationFrame(animate); }

		function handleResize() { resize(); drawContours(); }
		function handleVisibility() {
			if (document.hidden) { running = false; } else { running = true; requestAnimationFrame(animate); }
		}

		window.addEventListener('resize', handleResize);
		document.addEventListener('visibilitychange', handleVisibility);

		return () => {
			running = false;
			window.removeEventListener('resize', handleResize);
			document.removeEventListener('visibilitychange', handleVisibility);
		};
	});
</script>

<canvas
	bind:this={canvas}
	id="topoBg"
	style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:0.13;"
></canvas>
