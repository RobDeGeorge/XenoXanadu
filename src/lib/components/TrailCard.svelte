<script>
	let { trail, onclick = null } = $props();

	function diffBadgeClass(d) {
		if (d === 'easy') return 'badge-easy';
		if (d === 'moderate') return 'badge-moderate';
		return 'badge-strenuous';
	}

	function diffLabel(d) {
		return d.charAt(0).toUpperCase() + d.slice(1);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="card {trail.closed ? 'card-closed' : ''} {trail.tips ? 'trail-card' : ''}"
	data-difficulty={trail.difficulty}
	data-name={trail.dataName || trail.name}
	role={trail.tips ? 'button' : undefined}
	tabindex={trail.tips ? '0' : undefined}
	onclick={(e) => {
		if (onclick && !e.target.closest('a')) onclick(trail);
	}}
	onkeydown={(e) => {
		if (onclick && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) {
			e.preventDefault();
			onclick(trail);
		}
	}}
>
	<div class="card-title">
		{#if trail.coordinates && !trail.closed}
			<a class="map-link" href={trail.coordinates} target="_blank">
				{trail.name.replace(/ \(.*\)/, '')}
			</a>
		{:else}
			{trail.name}
		{/if}
	</div>
	<div class="card-meta">
		<span class="badge {diffBadgeClass(trail.difficulty)}">{diffLabel(trail.difficulty)}</span>
		{#if trail.permitRequired}
			<span class="badge badge-permit">Permit Required</span>
		{/if}
		{#if trail.closed}
			<span class="badge badge-closed">{typeof trail.closed === 'string' ? 'Closed (' + trail.closed + ')' : 'Closed'}</span>
		{/if}
		{#if trail.badges}
			{#each trail.badges.filter(b => !['Strenuous','Moderate','Easy','Permit Required','No Permit'].includes(b)) as badge}
				<span class="badge badge-info">{badge}</span>
			{/each}
		{/if}
		{#if !trail.permitRequired && !trail.closed}
			<span class="badge badge-free">No Permit</span>
		{/if}
	</div>
	<div class="card-desc">{trail.description}</div>
	<div class="card-stats">
		<div class="card-stat">
			<div class="val">{trail.distance}</div>
			<div class="lbl">Distance</div>
		</div>
		<div class="card-stat">
			<div class="val">{trail.elevationGain}</div>
			<div class="lbl">Elevation</div>
		</div>
		<div class="card-stat">
			<div class="val">{trail.time}</div>
			<div class="lbl">Time</div>
		</div>
		<div class="card-stat">
			<div class="val">{trail.shuttleStop || 'N/A'}</div>
			<div class="lbl">{trail.shuttleStopLabel || 'Shuttle'}</div>
		</div>
	</div>
	{#if trail.tips}
		<div class="card-expand-hint">Tap for details</div>
	{/if}
</div>
