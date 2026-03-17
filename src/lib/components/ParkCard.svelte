<script>
	let { park } = $props();

	$effect(() => {});

	function regionClass(region) {
		return 'region-' + region.toLowerCase().replace(/\s+/g, '');
	}
</script>

{#if park.status === 'complete'}
	<a href="/parks/{park.slug}" class="park-card">
		<span class="park-card-status status-complete">Complete</span>
		<div class="park-card-name">{park.name}</div>
		<div class="park-card-state">{park.state}</div>
		<span class="park-card-region {regionClass(park.region)}">{park.region}</span>
	</a>
{:else}
	<div class="park-card coming-soon">
		<span class="park-card-status status-soon">Coming Soon</span>
		<div class="park-card-name">{park.name}</div>
		<div class="park-card-state">{park.state}</div>
		<span class="park-card-region {regionClass(park.region)}">{park.region}</span>
	</div>
{/if}
