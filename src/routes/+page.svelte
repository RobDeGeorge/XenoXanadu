<script>
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import LeafletMap from '$lib/components/LeafletMap.svelte';
	import ParkCard from '$lib/components/ParkCard.svelte';
	import RegionFilters from '$lib/components/RegionFilters.svelte';
	import { parkIcon, parkPopup } from '$lib/helpers/map-helpers.js';

	let { data } = $props();
	let parks = $derived(data.parks);

	let searchQuery = $state('');
	let activeRegion = $state('all');

	let completeCount = $derived(parks.filter(p => p.status === 'complete').length);

	let filteredParks = $derived(() => {
		let sorted = parks.slice().sort((a, b) => {
			if (a.status === 'complete' && b.status !== 'complete') return -1;
			if (b.status === 'complete' && a.status !== 'complete') return 1;
			return a.name.localeCompare(b.name);
		});

		return sorted.filter(park => {
			if (activeRegion !== 'all' && park.region !== activeRegion) return false;
			if (searchQuery) {
				const q = searchQuery.toLowerCase();
				if (!park.name.toLowerCase().includes(q) && !park.state.toLowerCase().includes(q)) return false;
			}
			return true;
		});
	});

	function setupMap(L, map) {
		map.setView([39.8283, -98.5795], 4);

		parks.forEach(park => {
			const isComplete = park.status === 'complete';
			const color = isComplete ? '#c45d3e' : '#5a5348';
			const size = isComplete ? 18 : 12;
			const icon = parkIcon(L, color, size);

			const marker = L.marker(park.coords, { icon }).addTo(map);
			marker.bindPopup(parkPopup(park), { maxWidth: 220 });

			if (isComplete) {
				marker.setZIndexOffset(1000);
			}
		});
	}

	let searchTimeout;
	function handleSearch(e) {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchQuery = e.target.value;
		}, 150);
	}
</script>

<svelte:head>
	<title>XenoXanadu // US National Parks Field Guide</title>
	<meta name="description" content="Personal field guides for all 63 US national parks — trails, permits, gear, camping, food, safety, and insider tips." />
	<meta property="og:title" content="XenoXanadu // US National Parks Field Guide" />
	<meta property="og:description" content="Personal field guides for all 63 US national parks — trails, permits, gear, camping, food, safety, and insider tips." />
	<meta property="og:type" content="website" />
</svelte:head>

<Nav brand="XENOXANADU" links={[{ href: '#map', label: 'Map' }, { href: '#parks', label: 'All Parks' }]} />

<!-- HERO -->
<div class="landing-hero">
	<h1>XenoXanadu</h1>
	<p class="subtitle">US National Parks // Field Guides</p>
	<p class="tagline">Personal field guides with insider tips, trail details, gear lists, and everything you need to explore America's national parks. Built one park at a time.</p>
	<div class="landing-stats">
		<div class="landing-stat">
			<div class="value">63</div>
			<div class="label">National Parks</div>
		</div>
		<div class="landing-stat">
			<div class="value">{completeCount}</div>
			<div class="label">Guides Complete</div>
		</div>
		<div class="landing-stat">
			<div class="value">85M+</div>
			<div class="label">Annual Park Visits</div>
		</div>
	</div>
</div>

<!-- US MAP -->
<div class="map-section" id="map">
	<div class="map-container">
		<div class="map-header">
			<h2>All 63 National Parks</h2>
			<div class="map-legend">
				<span><span class="dot-complete"></span> Guide Available</span>
				<span><span class="dot-soon"></span> Coming Soon</span>
			</div>
		</div>
		<LeafletMap id="parkMap" height="500px" setup={setupMap} />
	</div>
</div>

<!-- PARK GRID -->
<div class="park-grid-section" id="parks">
	<div class="park-grid-header">
		<h2>Explore Parks</h2>
		<div class="park-search-wrap">
			<input type="text" class="park-search" placeholder="Search parks..." oninput={handleSearch} />
		</div>
	</div>
	<RegionFilters bind:activeRegion />
	<div class="park-grid">
		{#each filteredParks() as park (park.slug)}
			<ParkCard {park} />
		{:else}
			<div class="no-results">No parks match your search.</div>
		{/each}
	</div>
</div>

<Footer />
