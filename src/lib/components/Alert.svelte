<script>
	import Icon from './Icon.svelte';
	let { type = 'info', icon = '', title = '', message = '' } = $props();

	const emojiToIcon = {
		'\u26A0\uFE0F': 'warning',
		'\u26A0': 'warning',
		'\uD83D\uDD14': 'bell',
		'\uD83D\uDCF1': 'phone',
		'\uD83D\uDCA7': 'droplet',
		'\uD83D\uDEB2': 'bicycle',
		'\u2B50': 'star',
	};

	let iconName = $derived(emojiToIcon[icon] || '');
</script>

<div class="alert alert-{type}">
	{#if iconName}
		<span class="alert-icon"><Icon name={iconName} /></span>
	{:else if icon}
		<span class="alert-icon">{icon}</span>
	{/if}
	<div><strong>{title}</strong> {message}</div>
</div>
