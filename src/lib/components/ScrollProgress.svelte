<script>
	import { onMount } from 'svelte';

	let width = $state(0);

	onMount(() => {
		let ticking = false;

		function onScroll() {
			ticking = false;
			const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
			const docHeight = document.documentElement.scrollHeight - window.innerHeight;
			if (docHeight > 0) {
				width = (scrollTop / docHeight) * 100;
			}
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
</script>

<div class="scroll-progress" style="width: {width}%"></div>
