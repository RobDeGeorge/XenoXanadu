<script>
	import { onMount } from 'svelte';

	let { items = [], storageKey = '' } = $props();
	let checked = $state([]);

	onMount(() => {
		if (storageKey) {
			const saved = JSON.parse(localStorage.getItem('xenoxanadu-checklist-' + storageKey) || '[]');
			checked = saved;
		}
	});

	function toggle(index) {
		if (checked.includes(index)) {
			checked = checked.filter(i => i !== index);
		} else {
			checked = [...checked, index];
		}
		if (storageKey) {
			localStorage.setItem('xenoxanadu-checklist-' + storageKey, JSON.stringify(checked));
		}
	}
</script>

<ul class="checklist interactive" data-checklist={storageKey}>
	{#each items as item, i}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
		<li
			class:checked={checked.includes(i)}
			onclick={() => toggle(i)}
			onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i); } }}
			role="checkbox"
			aria-checked={checked.includes(i)}
			tabindex="0"
		>
			{@html item}
		</li>
	{/each}
</ul>
