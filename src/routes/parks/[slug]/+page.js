import { error } from '@sveltejs/kit';
import { PARKS_DATA } from '$lib/data/parks-data.js';

// Tell SvelteKit which slugs to prerender
export function entries() {
	return PARKS_DATA
		.filter(p => p.status === 'complete')
		.map(p => ({ slug: p.slug }));
}

export async function load({ params }) {
	const { slug } = params;

	// Verify slug is a known complete park
	const parkMeta = PARKS_DATA.find(p => p.slug === slug && p.status === 'complete');
	if (!parkMeta) {
		error(404, 'Park not found');
	}

	// Dynamic import of park JSON
	let parkData;
	try {
		const module = await import(`$lib/data/${slug}.json`);
		parkData = module.default;
	} catch {
		error(404, 'Park data not found');
	}

	return { park: parkData };
}
