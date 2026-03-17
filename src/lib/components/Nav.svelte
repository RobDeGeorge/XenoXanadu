<script>
	let { brand = 'XENOXANADU', links = [], brandHref = '/', homeLink = false } = $props();
	let menuOpen = $state(false);

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	function closeMenu() {
		menuOpen = false;
	}
</script>

<nav>
	{#if homeLink}
		<a href="/" class="nav-home" aria-label="Home">
			<span class="dot"></span>
		</a>
	{/if}
	<a href={brandHref} class="nav-brand">
		{#if !homeLink}<span class="dot"></span>{/if}
		{brand}
	</a>
	<div class="nav-links" class:open={menuOpen}>
		{#each links as link}
			<a href={link.href} onclick={closeMenu}>{link.label}</a>
		{/each}
	</div>
	{#if menuOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="nav-overlay" onclick={closeMenu} onkeydown={closeMenu}></div>
	{/if}
	<button
		class="nav-toggle"
		aria-label="Toggle navigation"
		aria-expanded={menuOpen}
		onclick={toggleMenu}
	>
		{menuOpen ? '\u2715' : '\u2630'}
	</button>
</nav>
