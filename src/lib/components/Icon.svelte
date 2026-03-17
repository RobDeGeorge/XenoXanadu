<script>
	let { name = '', size = 20 } = $props();

	const icons = {
		'hiking-boot': '<path d="M3 14l1-5a2 2 0 0 1 2-2h2l1 2h3l1-1h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H3z" /><path d="M6 17h11a2 2 0 0 0 2-2" /><line x1="8" y1="9" x2="8" y2="7" />',
		'lightbulb': '<path d="M9 18h2m-3-1h4m-2 0v-2.5a4 4 0 1 0-4-4c0 1.5.8 2.8 2 3.5" /><circle cx="10" cy="7" r="4" fill="none" />',
		'backpack': '<rect x="5" y="6" width="10" height="12" rx="2" /><path d="M7 6V4a3 3 0 0 1 6 0v2" /><line x1="5" y1="10" x2="15" y2="10" /><rect x="8" y="11" width="4" height="3" rx="0.5" />',
		'utensils': '<path d="M6 2v6a2 2 0 0 0 2 2h0v8" /><line x1="6" y1="6" x2="6" y2="2" /><line x1="8" y1="2" x2="8" y2="6" /><path d="M14 2c0 0 2 1 2 4s-2 4-2 4v8" />',
		'tent': '<path d="M3 17L10 4l7 13" /><path d="M8 17v-4l2-3 2 3v4" /><line x1="1" y1="17" x2="19" y2="17" />',
		'clipboard': '<rect x="5" y="3" width="10" height="15" rx="1.5" /><path d="M7 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" /><line x1="7.5" y1="8" x2="12.5" y2="8" /><line x1="7.5" y1="11" x2="12.5" y2="11" /><line x1="7.5" y1="14" x2="10" y2="14" />',
		'calendar': '<rect x="3" y="4" width="14" height="13" rx="1.5" /><line x1="3" y1="8" x2="17" y2="8" /><line x1="7" y1="2" x2="7" y2="5" /><line x1="13" y1="2" x2="13" y2="5" /><circle cx="7" cy="12" r="0.5" fill="currentColor" /><circle cx="10" cy="12" r="0.5" fill="currentColor" /><circle cx="13" cy="12" r="0.5" fill="currentColor" />',
		'camera': '<rect x="2" y="5" width="16" height="11" rx="2" /><circle cx="10" cy="10.5" r="3" /><path d="M7 5l1-2h4l1 2" />',
		'gem': '<polygon points="10,2 16,7 10,18 4,7" /><line x1="4" y1="7" x2="16" y2="7" /><line x1="7" y1="7" x2="10" y2="2" /><line x1="13" y1="7" x2="10" y2="2" /><line x1="7" y1="7" x2="10" y2="18" /><line x1="13" y1="7" x2="10" y2="18" />',
		'car': '<path d="M3 13h14v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3z" /><path d="M5 13l1.5-5h7L15 13" /><circle cx="6" cy="15" r="1" fill="currentColor" /><circle cx="14" cy="15" r="1" fill="currentColor" /><line x1="3" y1="13" x2="17" y2="13" />',
		'phone': '<rect x="6" y="1" width="8" height="18" rx="2" /><line x1="6" y1="4" x2="14" y2="4" /><line x1="6" y1="15" x2="14" y2="15" /><circle cx="10" cy="17" r="0.5" fill="currentColor" />',
		'x-mark': '<circle cx="10" cy="10" r="8" /><line x1="7" y1="7" x2="13" y2="13" /><line x1="13" y1="7" x2="7" y2="13" />',
		'warning': '<path d="M10 2L1 18h18L10 2z" fill="none" /><line x1="10" y1="8" x2="10" y2="12" /><circle cx="10" cy="15" r="0.5" fill="currentColor" />',
		'ambulance': '<rect x="1" y="7" width="13" height="9" rx="1" /><path d="M14 10h3l2 3v3h-5" /><circle cx="5" cy="16" r="2" /><circle cx="16" cy="16" r="2" /><line x1="7" y1="9" x2="7" y2="13" /><line x1="5" y1="11" x2="9" y2="11" />',
		'bolt': '<polygon points="11,1 5,11 10,11 9,19 15,9 10,9" />',
		'wave': '<path d="M2 10c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0" fill="none" /><path d="M2 14c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0" fill="none" />',
		'sun-cloud': '<circle cx="7" cy="7" r="3" /><line x1="7" y1="1" x2="7" y2="2.5" /><line x1="7" y1="11.5" x2="7" y2="13" /><line x1="1" y1="7" x2="2.5" y2="7" /><line x1="11.5" y1="7" x2="13" y2="7" /><line x1="2.8" y1="2.8" x2="3.8" y2="3.8" /><line x1="10.2" y1="10.2" x2="11.2" y2="11.2" /><line x1="11.2" y1="2.8" x2="10.2" y2="3.8" /><line x1="3.8" y1="10.2" x2="2.8" y2="11.2" /><path d="M10 15a3 3 0 0 0-3-3H6a3 3 0 0 0 0 6h8a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 0-2.5 2" fill="none" />',
		'ticket': '<rect x="1" y="5" width="18" height="10" rx="1.5" /><path d="M1 9a2 2 0 0 1 0 2" /><path d="M19 9a2 2 0 0 0 0 2" /><line x1="7" y1="5" x2="7" y2="15" stroke-dasharray="2 2" />',
		'bus': '<rect x="3" y="3" width="14" height="13" rx="2" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="10" y1="3" x2="10" y2="10" /><circle cx="6" cy="14" r="1" fill="currentColor" /><circle cx="14" cy="14" r="1" fill="currentColor" /><line x1="3" y1="16" x2="5" y2="18" /><line x1="17" y1="16" x2="15" y2="18" />',
		'map': '<polygon points="1,4 7,2 13,4 19,2 19,16 13,18 7,16 1,18" fill="none" /><line x1="7" y1="2" x2="7" y2="16" /><line x1="13" y1="4" x2="13" y2="18" />',
		'red-circle': '<circle cx="10" cy="10" r="7" fill="currentColor" stroke="none" />',
		'hotel': '<rect x="3" y="5" width="14" height="13" rx="1" /><line x1="3" y1="9" x2="17" y2="9" /><rect x="8" y="13" width="4" height="5" /><line x1="7" y1="5" x2="7" y2="2" /><line x1="10" y1="5" x2="10" y2="2" /><line x1="13" y1="5" x2="13" y2="2" />',
		'campsite': '<path d="M10 2l8 14H2L10 2z" fill="none" /><path d="M6 16l4-7 4 7" fill="none" /><line x1="1" y1="16" x2="19" y2="16" />',
		'droplet': '<path d="M10 2C10 2 4 9 4 13a6 6 0 0 0 12 0c0-4-6-11-6-11z" />',
		'bicycle': '<circle cx="5" cy="14" r="3" /><circle cx="15" cy="14" r="3" /><path d="M5 14l3-6h4l3 6" /><line x1="8" y1="8" x2="12" y2="8" /><line x1="10" y1="8" x2="15" y2="14" /><line x1="12" y1="8" x2="12" y2="5" /><line x1="11" y1="5" x2="13" y2="5" />',
		'star': '<polygon points="10,2 12.5,7.5 18,8 14,12 15,18 10,15 5,18 6,12 2,8 7.5,7.5" />',
		'bell': '<path d="M10 2a1 1 0 0 1 1 1v1a5 5 0 0 1 4 5v3l2 2H3l2-2V9a5 5 0 0 1 4-5V3a1 1 0 0 1 1-1z" /><path d="M8 17a2 2 0 0 0 4 0" />',
		'mountain': '<path d="M2 17L7 6l3 5 3-8 5 14H2z" fill="none" /><path d="M7 11l2-1 2 1" />',
		'compass': '<circle cx="10" cy="10" r="8" /><polygon points="10,4 11.5,8.5 10,7.5 8.5,8.5" fill="currentColor" /><polygon points="10,16 8.5,11.5 10,12.5 11.5,11.5" fill="currentColor" /><circle cx="10" cy="10" r="1" />',
		'house': '<path d="M3 10l7-7 7 7" /><path d="M5 9v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" /><rect x="8" y="13" width="4" height="4" />'
	};
</script>

{#if icons[name]}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={size}
		height={size}
		viewBox="0 0 20 20"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="icon-svg"
		aria-hidden="true"
	>
		{@html icons[name]}
	</svg>
{:else}
	<span class="icon-fallback">{name}</span>
{/if}

<style>
	.icon-svg {
		display: inline-block;
		vertical-align: middle;
		flex-shrink: 0;
	}
	.icon-fallback {
		display: inline-block;
		vertical-align: middle;
	}
</style>
