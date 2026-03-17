<script>
	import { onMount } from 'svelte';

	onMount(() => {
		const sections = document.querySelectorAll('.section');

		// Add animation class (sections visible by default in SSR)
		sections.forEach(s => s.classList.add('animate-in'));

		const observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					entry.target.classList.add('revealed');
					observer.unobserve(entry.target);
				}
			});
		}, { threshold: 0.01, rootMargin: '0px 0px 50px 0px' });

		sections.forEach((section) => {
			observer.observe(section);
		});

		return () => observer.disconnect();
	});
</script>
