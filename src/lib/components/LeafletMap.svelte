<script>
	import { onMount } from 'svelte';

	let { id = 'map', height = '500px', setup = () => {} } = $props();
	let mapEl;

	onMount(async () => {
		const L = (await import('leaflet')).default;
		await import('leaflet/dist/leaflet.css');

		const map = L.map(mapEl, {
			zoomControl: true,
			attributionControl: true
		});

		// Add dark tiles
		L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
			subdomains: 'abcd',
			maxZoom: 18
		}).addTo(map);

		// Call setup function with L and map
		setup(L, map);

		return () => {
			map.remove();
		};
	});
</script>

<div bind:this={mapEl} {id} style="height:{height};width:100%;background:var(--bg-accent);"></div>
