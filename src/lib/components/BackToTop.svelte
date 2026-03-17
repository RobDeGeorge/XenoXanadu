<script>
	import { onMount } from 'svelte';

	let visible = $state(false);

	onMount(() => {
		let ticking = false;

		function onScroll() {
			ticking = false;
			const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
			visible = scrollTop > 600;
		}

		function handleScroll() {
			if (!ticking) {
				requestAnimationFrame(onScroll);
				ticking = true;
			}
		}

		window.addEventListener('scroll', handleScroll);
		return () => window.removeEventListener('scroll', handleScroll);
	});

	function scrollToTop() {
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}
</script>

<button class="back-to-top" class:visible aria-label="Back to top" onclick={scrollToTop}>
	&uarr;
</button>
