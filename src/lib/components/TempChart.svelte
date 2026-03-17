<script>
	let { data = [], source = '' } = $props();

	const W = 600;
	const H = 260;
	const PAD = { top: 24, right: 20, bottom: 40, left: 40 };
	const chartW = W - PAD.left - PAD.right;
	const chartH = H - PAD.top - PAD.bottom;

	const allTemps = $derived(data.flatMap(d => [d.high, d.low]));
	const minT = $derived(Math.floor((Math.min(...allTemps) - 5) / 10) * 10);
	const maxT = $derived(Math.ceil((Math.max(...allTemps) + 5) / 10) * 10);

	function x(i) { return PAD.left + (i / (data.length - 1)) * chartW; }
	function y(t) { return PAD.top + (1 - (t - minT) / (maxT - minT)) * chartH; }

	const highPath = $derived(data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.high)}`).join(' '));
	const lowPath = $derived(data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.low)}`).join(' '));
	const areaPath = $derived(
		data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.high)}`).join(' ') +
		data.slice().reverse().map((d, i) => `L${x(data.length - 1 - i)},${y(d.low)}`).join(' ') + 'Z'
	);

	const gridLines = $derived(
		Array.from({ length: Math.floor((maxT - minT) / 10) + 1 }, (_, i) => minT + i * 10)
	);
</script>

<div class="temp-chart-wrap">
	<svg viewBox="0 0 {W} {H}" class="temp-chart">
		<!-- grid lines -->
		{#each gridLines as temp}
			<line x1={PAD.left} y1={y(temp)} x2={W - PAD.right} y2={y(temp)} stroke="var(--border)" stroke-width="0.5" />
			<text x={PAD.left - 6} y={y(temp) + 4} text-anchor="end" fill="var(--text-muted)" font-size="11">{temp}°</text>
		{/each}

		<!-- month labels -->
		{#each data as d, i}
			<text x={x(i)} y={H - 8} text-anchor="middle" fill="var(--text-muted)" font-size="11">{d.month}</text>
		{/each}

		<!-- filled area between high and low -->
		<path d={areaPath} fill="var(--accent)" opacity="0.1" />

		<!-- lines -->
		<path d={highPath} fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
		<path d={lowPath} fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

		<!-- dots + values -->
		{#each data as d, i}
			<circle cx={x(i)} cy={y(d.high)} r="3.5" fill="var(--accent)" />
			<text x={x(i)} y={y(d.high) - 8} text-anchor="middle" fill="var(--accent)" font-size="10" font-weight="600">{d.high}°</text>
			<circle cx={x(i)} cy={y(d.low)} r="3.5" fill="var(--cyan)" />
			<text x={x(i)} y={y(d.low) + 16} text-anchor="middle" fill="var(--cyan)" font-size="10" font-weight="600">{d.low}°</text>
		{/each}
	</svg>
	<div class="temp-chart-legend">
		<span><span class="dot" style="background:var(--accent)"></span> Avg High</span>
		<span><span class="dot" style="background:var(--cyan)"></span> Avg Low</span>
		{#if source}<span class="temp-chart-source">Source: {source}</span>{/if}
	</div>
</div>

<style>
	.temp-chart-wrap {
		margin-top: 16px;
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 20px 16px 12px;
	}
	.temp-chart {
		width: 100%;
		height: auto;
		display: block;
	}
	.temp-chart-legend {
		display: flex;
		gap: 16px;
		justify-content: center;
		align-items: center;
		margin-top: 8px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin-right: 4px;
		vertical-align: middle;
	}
	.temp-chart-source {
		margin-left: auto;
		font-size: 11px;
		opacity: 0.6;
	}
</style>
