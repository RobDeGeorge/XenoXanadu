<script>
	let { activeRegion = $bindable('all') } = $props();

	const regions = ['all', 'Southwest', 'West', 'Midwest', 'Southeast', 'Northeast', 'Pacific', 'Alaska'];

	function setRegion(region) {
		activeRegion = region;
	}
</script>

<div class="region-filters">
	{#each regions as region}
		<button
			class="region-btn"
			class:active={activeRegion === region}
			onclick={() => setRegion(region)}
		>
			{region === 'all' ? 'All' : region}
		</button>
	{/each}
</div>
