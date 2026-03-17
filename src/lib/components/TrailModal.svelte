<script>
	import { onMount } from 'svelte';

	let { trail = $bindable(null) } = $props();

	let open = $derived(trail !== null);

	function close() {
		trail = null;
		document.body.style.overflow = '';
	}

	$effect(() => {
		if (trail) {
			document.body.style.overflow = 'hidden';
		}
	});

	onMount(() => {
		function handleKeydown(e) {
			if (e.key === 'Escape' && trail) close();
		}
		document.addEventListener('keydown', handleKeydown);
		return () => document.removeEventListener('keydown', handleKeydown);
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="trail-modal-overlay" class:open onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
	<div class="trail-modal">
		<button class="trail-modal-close" aria-label="Close" onclick={close}>&times;</button>
		{#if trail}
			<div class="trail-modal-title">{trail.name}</div>
			<div class="trail-modal-meta">
				{#each trail.badges || [] as badge}
					{@const cls = badge.toLowerCase().includes('easy') ? 'badge-easy' : badge.toLowerCase().includes('moderate') ? 'badge-moderate' : badge.toLowerCase().includes('strenuous') ? 'badge-strenuous' : badge.toLowerCase().includes('permit') ? 'badge-permit' : 'badge-info'}
					<span class="badge {cls}">{badge}</span>
				{/each}
			</div>
			<div class="trail-modal-stats">
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
				{#if trail.shuttleStop}
					<div class="card-stat">
						<div class="val">{trail.shuttleStop}</div>
						<div class="lbl">{trail.shuttleStopLabel || 'Shuttle'}</div>
					</div>
				{/if}
			</div>
			{#if trail.tips?.length}
				<ul class="trail-modal-tips">
					{#each trail.tips as tip}
						<li>{@html tip}</li>
					{/each}
				</ul>
			{/if}
			{#if trail.links?.length}
				<div class="trail-modal-links">
					{#each trail.links as link}
						<a href={link.url} target="_blank">{link.label} &rarr;</a>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
