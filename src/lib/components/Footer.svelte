<script>
	let { parkName = '', parkNpsUrl = '' } = $props();
</script>

<footer>
	{#if parkName}
		<p>{parkName} // Field Guide — Part of <a href="/" style="color:var(--accent);text-decoration:none;">XenoXanadu</a></p>
	{:else}
		<p>XENOXANADU &mdash; Personal Field Guides for US National Parks</p>
	{/if}
	<div class="footer-divider"></div>
	<p>Not affiliated with the National Park Service. Data sourced from NPS, USGS, and personal research.</p>
	<div class="footer-links">
		{#if parkNpsUrl}
			<a href={parkNpsUrl} target="_blank">{parkName} on NPS.gov</a>
		{:else}
			<a href="https://www.nps.gov" target="_blank">NPS.gov</a>
		{/if}
		<a href="https://www.recreation.gov" target="_blank">Recreation.gov</a>
		{#if parkName}
			<a href="/">All Parks</a>
		{/if}
	</div>
</footer>
