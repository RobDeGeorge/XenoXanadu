<script>
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import Alert from '$lib/components/Alert.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TrailCard from '$lib/components/TrailCard.svelte';
	import TrailModal from '$lib/components/TrailModal.svelte';
	import LeafletMap from '$lib/components/LeafletMap.svelte';
	import Checklist from '$lib/components/Checklist.svelte';
	import TempChart from '$lib/components/TempChart.svelte';
	import { addShuttleRoute } from '$lib/helpers/map-helpers.js';

	let { data } = $props();
	let park = $derived(data.park);

	// Trail filtering
	let searchQuery = $state('');
	let difficultyFilter = $state('all');
	let activeTrail = $state(null);

	let filteredTrails = $derived(() => {
		if (!park.trails) return [];
		return park.trails.filter(t => {
			if (difficultyFilter !== 'all' && t.difficulty !== difficultyFilter) return false;
			if (searchQuery) {
				const q = searchQuery.toLowerCase();
				if (!t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
			}
			return true;
		});
	});

	// Nav links from sections
	let navLinks = $derived(() => {
		const links = [];
		if (park.trails?.length) links.push({ href: '#trails', label: 'Trails' });
		if (park.uniqueSections) {
			park.uniqueSections.forEach(s => {
				links.push({ href: '#' + s.id, label: s.title });
			});
		}
		if (park.insiderTips?.length) links.push({ href: '#tips', label: 'Insider Tips' });
		if (park.gear) links.push({ href: '#gear', label: 'Gear' });
		if (park.food) links.push({ href: '#food', label: 'Food' });
		if (park.camping?.length) links.push({ href: '#camping', label: 'Camping' });
		if (park.itineraries?.length) links.push({ href: '#itineraries', label: 'Itineraries' });
		if (park.seasons) links.push({ href: '#seasons', label: 'Seasons' });
		if (park.photography?.length) links.push({ href: '#photo', label: 'Photos' });
		if (park.hiddenGems?.length) links.push({ href: '#gems', label: 'Hidden Gems' });
		if (park.scenicDrives?.length) links.push({ href: '#drives', label: 'Drives' });
		if (park.offlineMaps) links.push({ href: '#offline', label: 'Offline Maps' });
		if (park.commonMistakes?.length) links.push({ href: '#mistakes', label: 'Mistakes' });
		if (park.safety) links.push({ href: '#safety', label: 'Safety' });
		if (park.safety?.emergencyContacts || park.emergency) links.push({ href: '#emergency', label: 'Emergency' });
		return links;
	});

	// Hero stats
	let heroStats = $derived(() => {
		const stats = [];
		if (park.area) stats.push({ value: park.area, label: 'Park Area' });
		if (park.elevationRange) stats.push({ value: park.elevationRange, label: 'Elevation Range' });
		if (park.trails?.length) stats.push({ value: park.trails.length + '+', label: 'Trails Covered' });
		if (park.entryFee) stats.push({ value: park.entryFee, label: 'Vehicle / 7 Days' });
		if (park.annualVisitors) stats.push({ value: park.annualVisitors, label: 'Annual Visitors' });
		return stats;
	});

	// Quick links
	let quickLinksConfig = $derived(() => {
		const ql = park.quickLinks || {};
		const items = [];
		if (ql.conditions) items.push({ icon: 'bolt', label: 'Current Conditions', url: ql.conditions });
		if (ql.riverFlow) items.push({ icon: 'wave', label: 'River Flow', url: ql.riverFlow });
		if (ql.weather) items.push({ icon: 'sun-cloud', label: 'Weather', url: ql.weather });
		if (ql.permits) items.push({ icon: 'ticket', label: 'Permits', url: ql.permits });
		if (ql.shuttle) items.push({ icon: 'bus', label: 'Shuttle Schedule', url: ql.shuttle });
		if (ql.maps) items.push({ icon: 'map', label: 'Official Maps', url: ql.maps });
		if (ql.campgrounds) items.push({ icon: 'tent', label: 'Campground Booking', url: ql.campgrounds });
		if (ql.flashFlood) items.push({ icon: 'red-circle', label: 'Flash Flood Info', url: ql.flashFlood });
		if (ql.alerts) items.push({ icon: 'warning', label: 'Alerts', url: ql.alerts });
		if (ql.lodging) items.push({ icon: 'hotel', label: 'Lodging', url: ql.lodging });
		if (ql.phantomRanch) items.push({ icon: 'campsite', label: 'Phantom Ranch', url: ql.phantomRanch });
		return items;
	});

	// Get gallery images helper
	function getTrailPhotos() {
		if (!park.galleryImages) return [];
		if (Array.isArray(park.galleryImages)) return park.galleryImages.slice(0, 4);
		if (park.galleryImages.trailPhotos) return park.galleryImages.trailPhotos.slice(0, 4);
		return [];
	}

	// Shuttle map setup
	function setupShuttleMap(L, map) {
		const md = park.mapData;
		if (!md) return;
		map.setView(md.center, md.defaultZoom || 13);

		if (park.uniqueSections) {
			const shuttle = park.uniqueSections.find(s => s.id === 'shuttle');
			if (shuttle && md.canyonRouteCoords) {
				const cStops = (shuttle.canyonStops || []).map((s) => ({
					pos: s.coords, n: s.number, name: s.name, info: s.info || ''
				}));
				addShuttleRoute(L, map, cStops, md.canyonRouteCoords, '#00e5a0', 'Stop ', false);
			}
			if (shuttle && md.springdaleRouteCoords) {
				const sStops = (shuttle.springdaleStops || []).map((s) => ({
					pos: s.coords, n: s.number, name: s.name, info: s.info || ''
				}));
				addShuttleRoute(L, map, sStops, md.springdaleRouteCoords, '#c8a45a', 'Springdale ', true);
			}
			const allCoords = [...(md.canyonRouteCoords || []), ...(md.springdaleRouteCoords || [])];
			if (allCoords.length) {
				map.fitBounds(L.latLngBounds(allCoords).pad(0.08));
			}
		}
	}

	let searchTimeout;
	function handleTrailSearch(e) {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchQuery = e.target.value;
		}, 150);
	}

	function getGalleryObj(key) {
		if (park.galleryImages && !Array.isArray(park.galleryImages)) {
			return park.galleryImages[key] || null;
		}
		return null;
	}

	function seasonBadgeClass(tempRange) {
		if (!tempRange) return 'badge-easy';
		if (tempRange.includes('100') || tempRange.includes('105')) return 'badge-strenuous';
		if (tempRange.includes('85')) return 'badge-moderate';
		if (tempRange.includes('30') || tempRange.includes('20')) return 'badge-info';
		return 'badge-easy';
	}

	function getSectionHeroImg(section) {
		if (section.heroImage) return section.heroImage;
		// Map section IDs to galleryImages keys
		const heroMap = { narrows: 'narrowsHero', angels: 'angelsHero', 'rim-to-rim': 'rimToRimHero', 'phantom-ranch': 'phantomRanchHero' };
		const key = heroMap[section.id];
		return key ? getGalleryObj(key)?.src : null;
	}

	function getSectionHeroCaption(section) {
		if (section.heroCaption) return section.heroCaption;
		const heroMap = { narrows: 'narrowsHero', angels: 'angelsHero', 'rim-to-rim': 'rimToRimHero', 'phantom-ranch': 'phantomRanchHero' };
		const key = heroMap[section.id];
		return key ? getGalleryObj(key)?.caption : null;
	}

	function setDifficulty(level) {
		difficultyFilter = level;
		searchQuery = '';
	}

	let displayName = $derived(park.name?.replace(' National Park', '').toUpperCase());
	let parkSlug = $derived(park.slug);

	// Format camelCase keys to readable labels
	function formatLabel(key) {
		return key
			.replace(/([A-Z])/g, ' $1')
			.replace(/^./, s => s.toUpperCase())
			.trim();
	}

	// Get next park for "Explore more" CTA
	import { PARKS_DATA } from '$lib/data/parks-data.js';
	let otherParks = $derived(
		PARKS_DATA.filter(p => p.status === 'complete' && p.slug !== park.slug)
	);
</script>

<svelte:head>
	<title>{displayName} // Field Guide — XenoXanadu</title>
	<meta name="description" content="Personal field guide for {park.name} — trails, permits, gear, camping, food, safety, and insider tips." />
	<meta property="og:title" content="{displayName} // Field Guide — XenoXanadu" />
	<meta property="og:description" content="Personal field guide for {park.name} — trails, permits, gear, camping, food, safety, and insider tips." />
	<meta property="og:type" content="article" />
	{#if park.heroImage}
		<meta property="og:image" content={park.heroImage} />
	{/if}
</svelte:head>

<Nav brand={displayName} brandHref="/parks/{parkSlug}" homeLink={true} links={navLinks()} />

<TrailModal bind:trail={activeTrail} />

<!-- HERO -->
<div class="hero">
	<h1>{displayName}</h1>
	<p class="subtitle">Personal Field Guide // National Park</p>
	{#if park.lastUpdated}
		<p class="last-updated">Last updated {park.lastUpdated}</p>
	{/if}
	<div class="hero-stats">
		{#each heroStats() as stat}
			<div class="hero-stat">
				<div class="value">{stat.value}</div>
				<div class="label">{stat.label}</div>
			</div>
		{/each}
	</div>
</div>

<!-- HERO IMAGE -->
{#if park.heroImage}
	<div style="max-width:1200px;margin:0 auto;padding:0 24px 24px;">
		<div class="photo-banner">
			<img src={park.heroImage} alt={park.name} loading="eager" />
			{#if park.heroCaption}
				<div class="photo-caption">{park.heroCaption}</div>
			{/if}
		</div>
	</div>
{/if}

<!-- QUICK LINKS -->
{#if quickLinksConfig().length}
	<div class="quick-bar">
		{#each quickLinksConfig() as ql}
			<a href={ql.url} target="_blank" class="quick-btn">
				<span class="icon"><Icon name={ql.icon} size={16} /></span> {ql.label}
			</a>
		{/each}
	</div>
{/if}

<div class="container">

	<!-- ALERTS -->
	{#if park.alerts?.length}
		<div class="section" style="opacity:1;transform:none;">
			{#each park.alerts as alert}
				<Alert type={alert.type} icon={alert.icon} title={alert.title} message={alert.message} />
			{/each}
		</div>
	{/if}

	<!-- TRAILS -->
	{#if park.trails?.length}
		<div class="section" id="trails">
			<SectionHeader iconName="hiking-boot" title="Trail Guide" />

			{#if getTrailPhotos().length}
				<div class="photo-grid" style="margin-bottom:20px">
					{#each getTrailPhotos() as img}
						<div class="photo-item">
							<img src={img.src || img.url} alt={img.alt || img.label} loading="lazy" />
							<div class="photo-label">{img.label}</div>
						</div>
					{/each}
				</div>
			{/if}

			<div class="search-wrap">
				<input type="text" class="search-box" placeholder="Search trails..." oninput={handleTrailSearch} />
			</div>
			<div class="filter-bar">
				<button class="filter-btn" class:active={difficultyFilter === 'all'} onclick={() => setDifficulty('all')}>All</button>
				<button class="filter-btn" class:active={difficultyFilter === 'easy'} onclick={() => setDifficulty('easy')}>Easy</button>
				<button class="filter-btn" class:active={difficultyFilter === 'moderate'} onclick={() => setDifficulty('moderate')}>Moderate</button>
				<button class="filter-btn" class:active={difficultyFilter === 'strenuous'} onclick={() => setDifficulty('strenuous')}>Strenuous</button>
			</div>
			<div class="card-grid" id="trailGrid">
				{#each filteredTrails() as trail (trail.dataName || trail.name)}
					<TrailCard {trail} onclick={(t) => { if (t.tips) activeTrail = t; }} />
				{/each}
			</div>
		</div>
	{/if}

	<!-- UNIQUE SECTIONS -->
	{#if park.uniqueSections}
		{#each park.uniqueSections as section}
			<div class="section" id={section.id}>
				<SectionHeader icon={section.icon || ''} title={section.title} />

				<!-- Hero image (from section or galleryImages) -->
				{#if getSectionHeroImg(section)}
					<div class="photo-banner" style="aspect-ratio:21/8">
						<img src={getSectionHeroImg(section)} alt={section.title} loading="lazy" />
						{#if getSectionHeroCaption(section)}
							<div class="photo-caption">{getSectionHeroCaption(section)}</div>
						{/if}
					</div>
				{/if}

				<!-- Simple content string (Grand Canyon style) -->
				{#if section.content && typeof section.content === 'string'}
					<div class="detail-block">
						<p>{section.content}</p>
					</div>
				{/if}

				<!-- === NARROWS-STYLE === -->
				{#if section.flowWarning}
					<div class="alert alert-warn">
						<span class="alert-icon"><Icon name="droplet" /></span>
						<div>
							<strong>Always check river flow.</strong> {section.flowWarning.message || section.flowWarning}
							{#if section.flowWarning.flowCheckUrl}
								<a href={section.flowWarning.flowCheckUrl} target="_blank" style="color:var(--accent)">Check Flow &rarr;</a>
							{/if}
						</div>
					</div>
				{/if}

				{#if section.bottomUp || section.topDown}
					<div class="two-col">
						{#if section.bottomUp}
							<div class="detail-block border-accent">
								<h3>{section.bottomUp.title || 'Bottom-Up (No Permit)'}</h3>
								<p>{section.bottomUp.description || ''}</p>
								{#if section.bottomUp.milestones}
									<ul>
										{#each section.bottomUp.milestones as m}
											<li><strong>{m.name}</strong> ({m.distance}) — {m.note}</li>
										{/each}
									</ul>
								{/if}
								{#if section.bottomUp.highlights}
									<ul>
										{#each section.bottomUp.highlights as h}
											<li>{@html h}</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
						{#if section.topDown}
							<div class="detail-block border-cyan">
								<h3>{section.topDown.title || 'Top-Down (Permit Required)'}</h3>
								<p>{section.topDown.route || ''} — {section.topDown.direction || ''}</p>
								<ul>
									{#if section.topDown.distance}<li><strong>Distance:</strong> {section.topDown.distance}</li>{/if}
									{#if section.topDown.dayHikeTime}<li><strong>Day hike:</strong> {section.topDown.dayHikeTime}</li>{/if}
									{#if section.topDown.overnightCampsites}<li><strong>Overnight:</strong> {section.topDown.overnightCampsites} campsites</li>{/if}
									{#if section.topDown.permitUrl}<li><a href={section.topDown.permitUrl} target="_blank" style="color:var(--cyan)">Apply on recreation.gov &rarr;</a></li>{/if}
								</ul>
								{#if section.topDown.highlights}
									<ul>
										{#each section.topDown.highlights as h}
											<li>{@html h}</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				{#if section.gearRental}
					<div class="detail-block" style="margin-top:16px">
						<h3>Gear Rental (~{section.gearRental.priceRange || '$25-32'}/day)</h3>
						{#if section.gearRental.essentials}
							<ul>
								{#each section.gearRental.essentials as item}
									<li>{item}</li>
								{/each}
							</ul>
						{/if}
						{#if section.gearRental.outfitters?.length}
							<p style="margin-top:12px">
								<strong>Outfitters:</strong>
								{#each section.gearRental.outfitters as o, i}
									<a href={o.url} target="_blank" style="color:var(--cyan)">{o.name}</a>{i < section.gearRental.outfitters.length - 1 ? ' \u00B7 ' : ''}
								{/each}
							</p>
						{/if}
						{#if section.gearRental.description}
							<p>{@html section.gearRental.description}</p>
						{/if}
					</div>
				{/if}

				{#if section.bestTimes}
					<div class="detail-block" style="margin-top:16px">
						<h3>Best Times</h3>
						{#if Array.isArray(section.bestTimes)}
							<ul>
								{#each section.bestTimes as t}
									<li>{@html typeof t === 'string' ? t : '<strong>' + t.period + ':</strong> ' + t.note}</li>
								{/each}
							</ul>
						{:else}
							<p>{@html section.bestTimes}</p>
						{/if}
					</div>
				{/if}

				<!-- === ANGELS LANDING STYLE === -->
				{#if section.hike || section.permit}
					<div class="two-col">
						{#if section.hike}
							<div class="detail-block border-accent">
								<h3>The Hike</h3>
								<ul>
									{#if section.hike.distance}<li>{section.hike.distance}, {section.hike.elevationGain} gain, {section.hike.time}</li>{/if}
									{#if section.hike.start}<li>Start: {section.hike.start}</li>{/if}
									{#if section.hike.details}
										{#each section.hike.details as d}
											<li>{@html d}</li>
										{/each}
									{/if}
									{#if section.hike.highlights}
										{#each section.hike.highlights as h}
											<li>{@html h}</li>
										{/each}
									{/if}
								</ul>
							</div>
						{/if}
						{#if section.permit}
							<div class="detail-block border-purple">
								<h3>Permit System</h3>
								<p>{@html section.permit.description || ''}</p>
								{#if section.permit.seasonalLottery}
									<div class="table-wrap" style="margin-top:8px">
										<table>
											<thead><tr><th>Hike Dates</th><th>Apply</th><th>Results</th></tr></thead>
											<tbody>
											{#each section.permit.seasonalLottery as row}
												<tr><td>{row.hikeDates}</td><td>{row.applyOpens}–{row.applyCloses}</td><td>{row.results}</td></tr>
											{/each}
											</tbody>
										</table>
									</div>
								{/if}
								{#if section.permit.schedule}
									<div class="table-wrap" style="margin-top:8px">
										<table>
											<thead><tr><th>Dates</th><th>Apply</th><th>Results</th></tr></thead>
											<tbody>
											{#each section.permit.schedule as row}
												<tr><td>{row.dates}</td><td>{row.apply}</td><td>{row.results}</td></tr>
											{/each}
											</tbody>
										</table>
									</div>
								{/if}
								{#if section.permit.dayBeforeLottery}
									<p style="margin-top:12px"><strong>Day-Before:</strong> {section.permit.dayBeforeLottery.applyWindow}. {section.permit.dayBeforeLottery.note || ''}
										{#if section.permit.url}
											<a href={section.permit.url} target="_blank" style="color:var(--accent3)">Apply &rarr;</a>
										{/if}
									</p>
								{/if}
								{#if section.permit.dayBefore}
									<p style="margin-top:12px">{@html section.permit.dayBefore}</p>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- === SHUTTLE SYSTEM === -->
				{#if section.schedule2026}
					<div class="two-col">
						{#if section.springdaleStops}
							<div class="detail-block border-accent">
								<h3>Springdale Stops</h3>
								<ol>
									{#each section.springdaleStops as stop}
										<li><strong>{stop.name}</strong>{stop.info ? ' — ' + stop.info : ''}</li>
									{/each}
								</ol>
							</div>
						{/if}
						{#if section.canyonStops}
							<div class="detail-block border-cyan">
								<h3>Canyon Stops</h3>
								<ol>
									{#each section.canyonStops as stop}
										<li><strong>{stop.name}</strong>{stop.info ? ' — ' + stop.info : ''}</li>
									{/each}
								</ol>
							</div>
						{/if}
					</div>
					<div class="detail-block border-accent" style="margin-top:16px">
						<h3>2026 Schedule</h3>
						<div class="table-wrap">
							<table>
								<thead><tr><th>Period</th><th>First</th><th>Last</th></tr></thead>
								<tbody>
								{#each section.schedule2026 as row}
									<tr><td>{row.period}</td><td>{row.canyonFirstBus || row.first}</td><td>{row.lastOut || row.last}</td></tr>
								{/each}
								</tbody>
							</table>
						</div>
						{#if section.frequency}
							<p style="margin-top:8px;font-size:13px;color:var(--text-muted)">{section.frequency}</p>
						{/if}
					</div>
					{#if section.eBikeTip}
						<div class="alert alert-info" style="margin-top:16px">
							<span class="alert-icon"><Icon name="bicycle" /></span>
							<div><strong>E-Bike Tip:</strong> {section.eBikeTip}
								{#if section.eBikeRentals?.length}
									— Rentals:
									{#each section.eBikeRentals as r, i}
										<a href={r.url} target="_blank" style="color:var(--cyan)">{r.name}</a>{i < section.eBikeRentals.length - 1 ? ', ' : ''}
									{/each}
								{/if}
							</div>
						</div>
					{/if}
					<!-- Shuttle Map -->
					{#if park.mapData}
						<div class="detail-block" style="margin-top:16px;padding:0;overflow:hidden">
							<h3 style="padding:20px 20px 12px">Shuttle Map</h3>
							<p style="padding:0 20px 12px;font-size:12px;color:var(--text-muted)">
								<span style="display:inline-block;width:12px;height:12px;background:#00e5a0;border-radius:50%;vertical-align:middle;margin-right:4px"></span> Canyon
								<span style="display:inline-block;width:12px;height:12px;background:#c8a45a;border-radius:50%;vertical-align:middle;margin:0 4px"></span> Springdale
							</p>
							<LeafletMap id="shuttleMap" height="500px" setup={setupShuttleMap} />
						</div>
					{/if}
				{/if}
			</div>
		{/each}
	{/if}

	<!-- INSIDER TIPS -->
	{#if park.insiderTips?.length}
		<div class="section" id="tips">
			<SectionHeader iconName="lightbulb" title="Insider Tips" />
			<div class="tip-list">
				{#each park.insiderTips as tip}
					<div class="tip">
						<div class="tip-num">{tip.number}</div>
						<div class="tip-content">
							<strong>{tip.title}</strong>
							{#if tip.detail}
								{tip.detail}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- GEAR -->
	{#if park.gear}
		<div class="section" id="gear">
			<SectionHeader iconName="backpack" title="Gear Checklist" />
			<div class="two-col">
				{#if park.gear.always}
					<div class="detail-block border-accent">
						<h3>Always Bring</h3>
						<Checklist items={park.gear.always} storageKey="{parkSlug}-gear-always" />
					</div>
				{/if}
				<div>
					{#if park.gear.narrows}
						<div class="detail-block border-cyan">
							<h3>Narrows Gear</h3>
							<Checklist items={park.gear.narrows} storageKey="{parkSlug}-gear-narrows" />
						</div>
					{/if}
					{#if park.gear.seasonal}
						<div class="detail-block border-cyan">
							<h3>Seasonal</h3>
							<Checklist items={park.gear.seasonal} storageKey="{parkSlug}-gear-seasonal" />
						</div>
					{/if}
					{#if park.gear.angelsLanding}
						<div class="detail-block border-purple">
							<h3>Angels Landing</h3>
							<Checklist items={park.gear.angelsLanding} storageKey="{parkSlug}-gear-angels" />
						</div>
					{/if}
					{#if park.gear.belowRim}
						<div class="detail-block border-cyan">
							<h3>Below the Rim</h3>
							<Checklist items={park.gear.belowRim} storageKey="{parkSlug}-gear-belowrim" />
						</div>
					{/if}
					{#if park.gear.summer}
						<div class="detail-block border-accent">
							<h3>Summer Essentials</h3>
							<Checklist items={park.gear.summer} storageKey="{parkSlug}-gear-summer" />
						</div>
					{/if}
					{#if park.gear.winter}
						<div class="detail-block border-cyan">
							<h3>Winter Essentials</h3>
							<Checklist items={park.gear.winter} storageKey="{parkSlug}-gear-winter" />
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- FOOD & LODGING -->
	{#if park.food || park.lodging}
		<div class="section" id="food">
			<SectionHeader iconName="utensils" title="Food & Lodging" />

			{#if getGalleryObj('foodHero')}
				<div class="photo-banner" style="margin-bottom:24px">
					<img src={getGalleryObj('foodHero').src} alt={getGalleryObj('foodHero').alt} loading="lazy" />
					{#if getGalleryObj('foodHero').caption}<div class="photo-caption">{getGalleryObj('foodHero').caption}</div>{/if}
				</div>
			{/if}

			{#if park.food?.restaurants?.length}
				<div class="card-grid" style="margin-bottom:24px">
					{#each park.food.restaurants as r}
						<div class="card">
							<div class="card-title">{r.name}</div>
							<div class="card-meta"><span class="badge badge-moderate">{r.priceRange}</span></div>
							<div class="card-desc">{r.description}</div>
							{#if r.mapLink || r.url}
								<div class="card-links">
									{#if r.mapLink}<a href={r.mapLink} target="_blank">Map</a>{/if}
									{#if r.url}<a href={r.url} target="_blank">Website</a>{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			{#if park.food?.inPark?.length || park.lodging}
				<div class="detail-block">
					<h3>In-Park & Lodging</h3>
					<ul>
						{#if park.food?.inPark}
							{#each park.food.inPark as item}
								<li><strong>{item.name}</strong> — {item.description}{#if item.mapLink} <a href={item.mapLink} target="_blank" style="color:var(--accent)">Map</a>{/if}{#if item.url} <a href={item.url} target="_blank" style="color:var(--cyan)">Website</a>{/if}</li>
							{/each}
						{/if}
						{#if park.lodging?.inPark}
							{#each park.lodging.inPark as item}
								<li><strong>{item.name}</strong> ({item.price}) — {item.description}{#if item.mapLink} <a href={item.mapLink} target="_blank" style="color:var(--accent)">Map</a>{/if}{#if item.url} <a href={item.url} target="_blank" style="color:var(--cyan)">Website</a>{/if}</li>
							{/each}
						{/if}
						{#if Array.isArray(park.lodging)}
							{#each park.lodging as item}
								<li><strong>{item.name}</strong>{item.bookingNote ? ' (' + item.bookingNote + ')' : ''} — {item.description}{#if item.mapLink} <a href={item.mapLink} target="_blank" style="color:var(--accent)">Map</a>{/if}{#if item.url} <a href={item.url} target="_blank" style="color:var(--cyan)">Website</a>{/if}</li>
							{/each}
						{/if}
						{#if park.lodging?.nearPark}
							{#each park.lodging.nearPark as item}
								<li><strong>{item.name}</strong>{item.price ? ' (' + item.price + ')' : ''} — {item.description}{#if item.mapLink} <a href={item.mapLink} target="_blank" style="color:var(--accent)">Map</a>{/if}{#if item.url} <a href={item.url} target="_blank" style="color:var(--cyan)">Website</a>{/if}</li>
							{/each}
						{/if}
					</ul>
				</div>
			{/if}
			{#if park.food?.groceries?.length}
				<div class="detail-block" style="margin-top:16px">
					<h3>Groceries & Supplies</h3>
					<ul>
						{#each park.food.groceries as g}
							<li><strong>{g.name}</strong> — {g.description || [g.location, g.note].filter(Boolean).join(' — ')}{#if g.mapLink} <a href={g.mapLink} target="_blank" style="color:var(--accent)">Map</a>{/if}{#if g.url} <a href={g.url} target="_blank" style="color:var(--cyan)">Website</a>{/if}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if park.food?.waterRefillStations?.length}
				<div class="detail-block" style="margin-top:16px">
					<h3>Water Refill Stations</h3>
					<ul>
						{#each park.food.waterRefillStations as w}
							<li>{typeof w === 'string' ? w : w.name + (w.location ? ' — ' + w.location : '')}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	<!-- CAMPING -->
	{#if park.camping?.length}
		<div class="section" id="camping">
			<SectionHeader iconName="tent" title="Camping" />
			<div class="card-grid">
				{#each park.camping as camp}
					<div class="card {camp.status === 'closed' ? 'card-closed' : ''} {camp.type === 'NPS' ? 'border-accent' : 'border-cyan'}">
						<div class="card-title">{camp.name}</div>
						<div class="card-meta">
							<span class="badge badge-info">{camp.season || 'Seasonal'}</span>
							{#if camp.reservation}
								<span class="badge badge-permit">{camp.reservation}</span>
							{/if}
							{#if camp.status === 'closed'}
								<span class="badge badge-closed">Closed</span>
							{/if}
						</div>
						<div class="card-desc">{camp.description}{camp.tip ? ' ' + camp.tip : ''}</div>
						{#if camp.sites || camp.price}
							<div class="card-stats">
								{#if camp.price}
									<div class="card-stat">
										<div class="val">{camp.price}</div>
										<div class="lbl">Per Night</div>
									</div>
								{/if}
								{#if camp.sites}
									<div class="card-stat">
										<div class="val">{camp.sites}</div>
										<div class="lbl">Sites</div>
									</div>
								{/if}
							</div>
						{/if}
						{#if camp.mapLink || camp.bookingUrl}
							<div class="card-links">
								{#if camp.mapLink}<a href={camp.mapLink} target="_blank">Map</a>{/if}
								{#if camp.bookingUrl}<a href={camp.bookingUrl} target="_blank">Book</a>{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
			{#if park.campingNotes}
				<div class="detail-block" style="margin-top:16px">
					<h3>Camping Notes</h3>
					<ul>
						{#if Array.isArray(park.campingNotes)}
							{#each park.campingNotes as note}
								<li>{@html note}</li>
							{/each}
						{:else}
							{#each Object.entries(park.campingNotes || {}) as [key, value]}
								<li><strong>{key}:</strong> {value}</li>
							{/each}
						{/if}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	<!-- ITINERARIES -->
	{#if park.itineraries?.length}
		<div class="section" id="itineraries">
			<SectionHeader iconName="clipboard" title="Itineraries" />
			<div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
				{#each park.itineraries as itin, i}
					<div class="card {i === 0 ? 'border-accent' : i === 1 ? 'border-cyan' : 'border-green'}">
						<div class="card-title">{itin.name}</div>
						<div class="itinerary">
							{#each itin.items as item}
								<div class="itin-item">
									<div class="itin-time">{item.time}</div>
									<div class="itin-title">{item.title}</div>
									{#if item.description}
										<div class="itin-desc">{item.description}</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- SEASONS -->
	{#if park.seasons}
		<div class="section" id="seasons">
			<SectionHeader iconName="calendar" title="When to Visit" />
			{#if park.seasons.best}
				<div class="alert alert-info" style="margin-bottom:20px">
					<span class="alert-icon"><Icon name="star" /></span>
					<div><strong>Best time:</strong> {park.seasons.best}{park.seasons.avoid ? '. Avoid: ' + park.seasons.avoid : ''}</div>
				</div>
			{/if}
			{#if park.seasons.monthlyTemps}
				<TempChart data={park.seasons.monthlyTemps} source={park.seasons.tempSource || ''} />
			{/if}
			{#if park.seasons.details}
				<div class="card-grid">
					{#each park.seasons.details as s}
						<div class="card">
							<div class="card-title">{s.season}</div>
							<div class="card-meta"><span class="badge {seasonBadgeClass(s.tempRange)}">{s.tempRange}</span></div>
							<div class="card-desc">{s.description}</div>
						</div>
					{/each}
				</div>
			{/if}
			{#if park.seasons.freeEntranceDays2026}
				<div class="detail-block" style="margin-top:16px">
					<h3>Free Entrance Days 2026</h3>
					{#if Array.isArray(park.seasons.freeEntranceDays2026) && typeof park.seasons.freeEntranceDays2026[0] === 'string'}
						<p>{park.seasons.freeEntranceDays2026.join(' \u2022 ')}</p>
					{:else}
						<ul>
							{#each park.seasons.freeEntranceDays2026 as day}
								<li><strong>{day.date}:</strong> {day.name}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- PHOTOGRAPHY -->
	{#if park.photography?.length}
		<div class="section" id="photo">
			<SectionHeader iconName="camera" title="Photography Spots" />

			{#if getGalleryObj('photographyHero')}
				<div class="photo-banner" style="margin-bottom:20px">
					<img src={getGalleryObj('photographyHero').src} alt={getGalleryObj('photographyHero').alt} loading="lazy" />
					{#if getGalleryObj('photographyHero').caption}<div class="photo-caption">{getGalleryObj('photographyHero').caption}</div>{/if}
				</div>
			{/if}

			<div class="table-wrap">
				<table>
					<thead><tr><th>Location</th><th>Best Time</th><th>Notes</th><th></th></tr></thead>
					<tbody>
					{#each park.photography as spot}
						<tr>
							<td><strong>{spot.location}</strong></td>
							<td>{spot.bestTime}</td>
							<td>{spot.notes}</td>
							<td>{#if spot.mapLink}<a href={spot.mapLink} target="_blank" style="color:var(--accent)">Map</a>{/if}</td>
						</tr>
					{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<!-- HIDDEN GEMS -->
	{#if park.hiddenGems?.length}
		<div class="section" id="gems">
			<SectionHeader iconName="gem" title="Hidden Gems" />

			{#if getGalleryObj('hiddenGemPhotos')?.length}
				<div class="photo-grid" style="margin-bottom:20px">
					{#each getGalleryObj('hiddenGemPhotos') as img}
						<div class="photo-item">
							<img src={img.src} alt={img.alt || img.label} loading="lazy" />
							<div class="photo-label">{img.label}</div>
						</div>
					{/each}
				</div>
			{/if}

			<div class="tip-list">
				{#each park.hiddenGems as gem, i}
					<div class="tip">
						<div class="tip-num">{i + 1}</div>
						<div class="tip-content">
							<strong>{gem.name}</strong> — {gem.description}
							{#if gem.mapLink} <a href={gem.mapLink} target="_blank" style="color:var(--accent);font-size:13px">Map</a>{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- SCENIC DRIVES -->
	{#if park.scenicDrives?.length}
		<div class="section" id="drives">
			<SectionHeader iconName="car" title="Scenic Drives" />

			{#if getGalleryObj('scenicDrivePhotos')?.length}
				<div class="photo-grid" style="margin-bottom:20px">
					{#each getGalleryObj('scenicDrivePhotos') as img}
						<div class="photo-item">
							<img src={img.src} alt={img.alt || img.label} loading="lazy" />
							<div class="photo-label">{img.label}</div>
						</div>
					{/each}
				</div>
			{/if}

			<div class="card-grid">
				{#each park.scenicDrives as drive}
					<div class="card">
						<div class="card-title">{drive.name}</div>
						<div class="card-meta">
							{#if drive.distance}<span class="badge badge-info">{drive.distance}</span>{/if}
							{#if drive.time}<span class="badge badge-moderate">{drive.time}</span>{/if}
						</div>
						<div class="card-desc">{drive.description}</div>
						{#if drive.mapLink}
							<div class="card-links">
								<a href={drive.mapLink} target="_blank">Map</a>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- OFFLINE MAPS -->
	{#if park.offlineMaps}
		<div class="section" id="offline">
			<SectionHeader iconName="phone" title="Offline Maps & Downloads" />
			{#if park.offlineMaps.pdfMaps?.length}
				<div class="link-grid" style="margin-bottom:20px">
					{#each park.offlineMaps.pdfMaps as pdf}
						<a href={pdf.url} target="_blank" class="link-item">
							{pdf.name} {#if pdf.size}({pdf.size}){/if}
							<span class="arrow">&rarr;</span>
						</a>
					{/each}
				</div>
			{/if}
			{#if park.offlineMaps.apps?.length}
				<div class="card-grid">
					{#each park.offlineMaps.apps as app}
						<div class="card">
							<div class="card-title">{app.name}</div>
							<div class="card-meta"><span class="badge badge-info">{app.price}</span></div>
							<div class="card-desc">{app.description}</div>
						</div>
					{/each}
				</div>
			{/if}
			{#if park.offlineMaps.offlineChecklist?.length}
				<div class="detail-block" style="margin-top:16px">
					<h3>Download Checklist</h3>
					<Checklist items={park.offlineMaps.offlineChecklist} storageKey="{parkSlug}-offline" />
				</div>
			{/if}
		</div>
	{/if}

	<!-- COMMON MISTAKES -->
	{#if park.commonMistakes?.length}
		<div class="section" id="mistakes">
			<SectionHeader iconName="x-mark" title="Common Mistakes" />
			<div class="tip-list">
				{#each park.commonMistakes as mistake}
					<div class="tip">
						<div class="tip-num">{mistake.number}</div>
						<div class="tip-content">
							<strong>{mistake.title}</strong>
							{#if mistake.detail}
								{mistake.detail}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- SAFETY -->
	{#if park.safety}
		<div class="section" id="safety">
			<SectionHeader iconName="warning" title="Safety" />
			{#if park.safety.hazards}
				<!-- Zion-style nested object -->
				<div class="detail-block border-accent">
					<h3>Hazards</h3>
					<ul>
						{#each park.safety.hazards as h}
							<li>{@html typeof h === 'string' ? h : '<strong>' + (h.hazard || h.name || h.title) + ':</strong> ' + (h.details || h.description || h.detail)}</li>
						{/each}
					</ul>
				</div>
				{#if park.safety.wildlife}
					<div class="detail-block border-cyan" style="margin-top:16px">
						<h3>Wildlife</h3>
						<ul>
							{#each park.safety.wildlife as w}
								<li>{@html typeof w === 'string' ? w : '<strong>' + w.animal + ':</strong> ' + w.note}</li>
							{/each}
						</ul>
					</div>
				{/if}
			{:else if Array.isArray(park.safety)}
				<!-- Grand Canyon-style array -->
				<div class="detail-block border-accent">
					<h3>Hazards</h3>
					<ul>
						{#each park.safety as h}
							<li><strong>{h.hazard}:</strong> {h.details}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	<!-- EMERGENCY -->
	{#if park.safety?.emergencyContacts || park.emergency}
		<div class="section" id="emergency">
			<SectionHeader iconName="ambulance" title="Emergency & Practical Info" />
			{#if park.safety?.emergencyContacts}
				<div class="detail-block">
					<ul>
						{#each park.safety.emergencyContacts as c}
							<li><strong>{c.label || c.name}:</strong> {c.value || c.number}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if park.safety?.medical}
				<div class="detail-block" style="margin-top:16px">
					<h3>Medical</h3>
					<ul>
						{#each park.safety.medical as m}
							<li>{@html typeof m === 'string' ? m : '<strong>' + (m.label || m.name) + ':</strong> ' + (m.value || [m.phone, m.address, m.distance, m.description].filter(Boolean).join(' — '))}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if park.emergency}
				<div class="detail-block">
					<ul>
						{#if park.emergency.numbers}
							{#each park.emergency.numbers as n}
								<li><strong>{n.label}:</strong> {n.value}</li>
							{/each}
						{/if}
						{#if park.emergency.nearestHospital}
							<li><strong>Nearest Hospital:</strong> {park.emergency.nearestHospital}</li>
						{/if}
					</ul>
				</div>
			{/if}
			{#if park.safety?.practicalInfo}
				<div class="detail-block" style="margin-top:16px">
					<h3>Practical Info</h3>
					<ul>
						{#if Array.isArray(park.safety.practicalInfo)}
							{#each park.safety.practicalInfo as info}
								<li>{@html typeof info === 'string' ? info : '<strong>' + info.label + ':</strong> ' + info.value}</li>
							{/each}
						{:else}
							{#each Object.entries(park.safety.practicalInfo || {}) as [key, value]}
								<li>{@html '<strong>' + formatLabel(key) + ':</strong> ' + (typeof value === 'string' ? value : typeof value === 'object' ? [value.nearest, value.other].filter(Boolean).join(' / ') : value)}</li>
							{/each}
						{/if}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

</div>

<!-- EXPLORE MORE -->
{#if otherParks.length}
	<div class="container">
		<div class="section explore-more">
			<SectionHeader iconName="compass" title="Explore More Parks" />
			<div class="card-grid">
				{#each otherParks as op}
					<a href="/parks/{op.slug}" class="card explore-card">
						<div class="card-title">{op.name}</div>
						<div class="card-meta">
							<span class="badge badge-easy">Guide Available</span>
						</div>
						<div class="card-desc">{op.state}</div>
					</a>
				{/each}
				<a href="/" class="card explore-card">
					<div class="card-title">All 63 Parks</div>
					<div class="card-meta">
						<span class="badge badge-info">View Map</span>
					</div>
					<div class="card-desc">Browse the full collection</div>
				</a>
			</div>
		</div>
	</div>
{/if}

<Footer parkName={displayName} parkNpsUrl="https://www.nps.gov/{park.npsCode}/" />
