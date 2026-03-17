<script>
	import '../app.css';
	import TopoBg from '$lib/components/TopoBg.svelte';
	import ScrollProgress from '$lib/components/ScrollProgress.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';
	import ScrollReveal from '$lib/components/ScrollReveal.svelte';

	let { children } = $props();
</script>

<ScrollProgress />
<TopoBg />
{@render children()}
<BackToTop />
<ScrollReveal />
