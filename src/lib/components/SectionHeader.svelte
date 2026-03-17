<script>
	import Icon from './Icon.svelte';
	let { iconName = '', icon = '', title = '', tag = '' } = $props();

	const emojiToIcon = {
		'\uD83C\uDFD5\uFE0F': 'campsite',
		'\uD83C\uDFD5': 'campsite',
		'\uD83C\uDFE8': 'hotel',
		'\u26A0\uFE0F': 'warning',
		'\u26A0': 'warning',
		'\uD83D\uDD14': 'bell',
		'\uD83D\uDCF1': 'phone',
		'\uD83C\uDFD4\uFE0F': 'mountain',
		'\uD83C\uDFD4': 'mountain',
		'\uD83E\uDDED': 'compass',
		'\uD83C\uDFE0': 'house',
	};

	let resolvedIconName = $derived(iconName || emojiToIcon[icon] || '');
</script>

<div class="section-header">
	{#if resolvedIconName}<span class="icon"><Icon name={resolvedIconName} /></span>
	{:else if icon}<span class="icon">{icon}</span>{/if}
	<h2>{title}</h2>
	{#if tag}<span class="tag">{tag}</span>{/if}
</div>
