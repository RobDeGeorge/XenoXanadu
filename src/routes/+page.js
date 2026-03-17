import { PARKS_DATA } from '$lib/data/parks-data.js';

export function load() {
	return {
		parks: PARKS_DATA
	};
}
