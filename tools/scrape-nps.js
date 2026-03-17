#!/usr/bin/env node

/**
 * scrape-nps.js — Pull park data from the NPS API and write structured JSON.
 *
 * Usage:
 *   node tools/scrape-nps.js <nps-code>
 *   node tools/scrape-nps.js zion
 *   node tools/scrape-nps.js grca
 *
 * Requires:
 *   - Node.js 18+ (for native fetch)
 *   - NPS_API_KEY environment variable (get free key at https://developer.nps.gov/)
 *
 * Output:
 *   Writes structured JSON to src/lib/data/<slug>.json matching data-schema.json
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const API_KEY = process.env.NPS_API_KEY || 'DEMO_KEY_REPLACE_ME';
const API_BASE = 'https://developer.nps.gov/api/v1';

// Region mapping — matches parks-data.js conventions
const STATE_TO_REGION = {
  'Maine': 'Northeast', 'New Hampshire': 'Northeast', 'Vermont': 'Northeast',
  'Massachusetts': 'Northeast', 'Connecticut': 'Northeast', 'Rhode Island': 'Northeast',
  'New York': 'Northeast', 'New Jersey': 'Northeast', 'Pennsylvania': 'Northeast',
  'Virginia': 'Southeast', 'West Virginia': 'Southeast', 'Kentucky': 'Southeast',
  'Tennessee': 'Southeast', 'North Carolina': 'Southeast', 'South Carolina': 'Southeast',
  'Georgia': 'Southeast', 'Florida': 'Southeast', 'Alabama': 'Southeast',
  'Mississippi': 'Southeast', 'Louisiana': 'Southeast',
  'Ohio': 'Midwest', 'Indiana': 'Midwest', 'Michigan': 'Midwest',
  'Illinois': 'Midwest', 'Wisconsin': 'Midwest', 'Minnesota': 'Midwest',
  'Iowa': 'Midwest', 'Missouri': 'Midwest', 'North Dakota': 'Midwest',
  'South Dakota': 'Midwest', 'Nebraska': 'Midwest', 'Kansas': 'Midwest',
  'Arkansas': 'Midwest',
  'Montana': 'West', 'Wyoming': 'West', 'Colorado': 'West', 'Idaho': 'West',
  'Nevada': 'West', 'Oregon': 'West', 'Washington': 'West',
  'Utah': 'Southwest', 'Arizona': 'Southwest', 'New Mexico': 'Southwest',
  'Texas': 'Southwest',
  'California': 'West',
  'Alaska': 'Alaska',
  'Hawaii': 'Hawaii',
  'American Samoa': 'Pacific', 'US Virgin Islands': 'Pacific', 'Guam': 'Pacific',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a single NPS API endpoint with error handling and retries.
 */
async function fetchNPS(endpoint, params = {}) {
  params.api_key = API_KEY;
  const queryString = new URLSearchParams(params).toString();
  const url = `${API_BASE}${endpoint}?${queryString}`;

  console.log(`  Fetching: ${endpoint}...`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const json = await response.json();
    return json;
  } catch (error) {
    console.error(`  ERROR fetching ${endpoint}: ${error.message}`);
    return { data: [] };
  }
}

/**
 * Convert NPS difficulty strings to our standardized values.
 */
function normalizeDifficulty(raw) {
  if (!raw) return 'Moderate';
  const lower = raw.toLowerCase();
  if (lower.includes('easy') || lower.includes('slight')) return 'Easy';
  if (lower.includes('strenuous') || lower.includes('difficult') || lower.includes('very')) return 'Strenuous';
  return 'Moderate';
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Generate a URL-safe slug from a park name.
 */
function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Determine a suitable region for a state string (may contain multiple states).
 */
function getRegion(stateStr) {
  if (!stateStr) return 'West';
  // Take the first state if multiple
  const firstState = stateStr.split(',')[0].split('/')[0].trim();
  return STATE_TO_REGION[firstState] || 'West';
}

/**
 * Pick an appropriate emoji based on park description keywords.
 */
function pickEmoji(description, name) {
  const text = `${name} ${description}`.toLowerCase();
  if (text.includes('volcano') || text.includes('lava') || text.includes('geothermal')) return '🌋';
  if (text.includes('glacier') || text.includes('ice') || text.includes('snow')) return '🏔️';
  if (text.includes('cave') || text.includes('cavern')) return '🦇';
  if (text.includes('ocean') || text.includes('coast') || text.includes('island') || text.includes('marine')) return '🏝️';
  if (text.includes('desert') || text.includes('dune') || text.includes('sand') || text.includes('canyon')) return '🏜️';
  if (text.includes('forest') || text.includes('redwood') || text.includes('sequoia') || text.includes('tree')) return '🌲';
  if (text.includes('lake') || text.includes('river') || text.includes('water')) return '🌊';
  if (text.includes('mountain') || text.includes('peak') || text.includes('alpine')) return '⛰️';
  return '🏞️';
}

// ---------------------------------------------------------------------------
// Main scrape flow
// ---------------------------------------------------------------------------

async function scrape(parkCode) {
  console.log(`\n=== Scraping NPS data for park code: ${parkCode.toUpperCase()} ===\n`);

  // 1. Fetch park info (the most important call)
  const parkResponse = await fetchNPS('/parks', {
    parkCode,
    limit: 1,
  });

  if (!parkResponse.data || parkResponse.data.length === 0) {
    console.error(`\nERROR: No park found for code "${parkCode}". Check the NPS code and try again.`);
    console.error('Valid codes are listed at https://www.nps.gov/findapark/index.htm');
    process.exit(1);
  }

  const park = parkResponse.data[0];
  const parkName = park.fullName.replace(' National Park', '').replace(' National Parks', '');
  const slug = nameToSlug(parkName);
  const state = park.states.split(',').map(s => {
    // NPS returns state abbreviations; keep them if we can't resolve
    return s.trim();
  }).join(', ');

  console.log(`  Park: ${park.fullName}`);
  console.log(`  Slug: ${slug}`);
  console.log(`  State: ${state}\n`);

  // 2. Fetch additional data in parallel
  const [campgroundsRes, alertsRes, thingsToDoRes] = await Promise.all([
    fetchNPS('/campgrounds', { parkCode, limit: 50 }),
    fetchNPS('/alerts', { parkCode, limit: 20 }),
    fetchNPS('/thingstodo', { parkCode, limit: 100 }),
  ]);

  // ---------------------------------------------------------------------------
  // Process park info
  // ---------------------------------------------------------------------------

  const coords = [
    parseFloat(park.latitude) || 0,
    parseFloat(park.longitude) || 0,
  ];

  // Find a hero image from the park images array
  const heroImage = (park.images && park.images.length > 0)
    ? park.images[0].url
    : `https://www.nps.gov/${parkCode}/planyourvisit/images/hero.jpg`;

  // Entry fee — look for "private vehicle" fee
  let entryFee = 'Free';
  if (park.entranceFees && park.entranceFees.length > 0) {
    const vehicleFee = park.entranceFees.find(f =>
      f.title.toLowerCase().includes('vehicle') || f.title.toLowerCase().includes('private')
    ) || park.entranceFees[0];
    const cost = parseFloat(vehicleFee.cost);
    entryFee = cost > 0 ? `$${cost.toFixed(0)}` : 'Free';
  }

  // ---------------------------------------------------------------------------
  // Process things to do as trails (NPS thingstodo often includes hikes)
  // ---------------------------------------------------------------------------

  const trails = [];
  if (thingsToDoRes.data) {
    for (const thing of thingsToDoRes.data) {
      // Filter for hiking/walking activities
      const activities = (thing.activities || []).map(a => a.name.toLowerCase());
      const isHike = activities.some(a =>
        a.includes('hiking') || a.includes('walking') || a.includes('trail')
      ) || (thing.title || '').toLowerCase().includes('trail')
        || (thing.title || '').toLowerCase().includes('hike');

      if (!isHike) continue;

      const description = stripHtml(thing.shortDescription || thing.longDescription || '');
      const duration = thing.duration || '';
      const thingCoords = (thing.latitude && thing.longitude)
        ? [parseFloat(thing.latitude), parseFloat(thing.longitude)]
        : null;

      trails.push({
        name: thing.title || 'Unnamed Trail',
        difficulty: normalizeDifficulty(thing.activityDescription),
        distance: 'TODO',
        elevationGain: 'TODO',
        time: duration || 'TODO',
        description: description || 'TODO: Add description with insider tips.',
        tips: ['TODO: Add insider tip 1', 'TODO: Add insider tip 2'],
        links: [
          [thing.title, thing.url || `https://www.nps.gov/${parkCode}/planyourvisit/`]
        ],
        shuttleStop: null,
        permitRequired: false,
        coordinates: thingCoords,
      });
    }
  }

  // If we didn't get trails from thingstodo, add placeholder
  if (trails.length === 0) {
    console.log('  NOTE: No trail data found from NPS API. Adding placeholder trails.');
    trails.push({
      name: 'TODO: Add trails manually',
      difficulty: 'Moderate',
      distance: 'TODO',
      elevationGain: 'TODO',
      time: 'TODO',
      description: 'TODO: Research and add trail data from AllTrails, NPS site, and other sources.',
      tips: ['TODO: Add insider tip 1', 'TODO: Add insider tip 2'],
      links: [],
      shuttleStop: null,
      permitRequired: false,
      coordinates: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Process campgrounds
  // ---------------------------------------------------------------------------

  const camping = (campgroundsRes.data || []).map(cg => {
    const totalSites = parseInt(cg.campsites?.totalSites) || 0;
    const fees = cg.fees || [];
    const fee = fees.length > 0 ? `$${parseFloat(fees[0].cost).toFixed(0)}/night` : 'TODO';
    const hasReservations = (cg.reservationInfo || '').toLowerCase().includes('reserv');

    return {
      name: cg.name || 'Unknown Campground',
      sites: totalSites || 'TODO',
      fee,
      reservations: hasReservations,
      season: cg.operatingHours?.[0]?.description || 'TODO: Check seasonal availability',
      hookups: (cg.campsites?.electricalHookups || 0) > 0,
      description: stripHtml(cg.description) || 'TODO: Add campground description with practical tips.',
      bookingUrl: cg.reservationUrl || 'https://www.recreation.gov/',
      coordinates: (cg.latitude && cg.longitude)
        ? [parseFloat(cg.latitude), parseFloat(cg.longitude)]
        : null,
    };
  });

  // ---------------------------------------------------------------------------
  // Process alerts
  // ---------------------------------------------------------------------------

  const alerts = (alertsRes.data || []).map(alert => {
    let level = 'info';
    const cat = (alert.category || '').toLowerCase();
    if (cat.includes('danger') || cat.includes('closure')) level = 'danger';
    else if (cat.includes('caution') || cat.includes('warning')) level = 'warn';

    return {
      level,
      title: alert.title || 'Alert',
      message: stripHtml(alert.description) || '',
    };
  });

  // ---------------------------------------------------------------------------
  // Build output JSON
  // ---------------------------------------------------------------------------

  const parkData = {
    name: parkName,
    slug,
    state,
    region: getRegion(state),
    coords,
    npsCode: parkCode.toLowerCase(),
    area: 'TODO: Park area in mi²',
    elevationRange: 'TODO: Elevation range',
    annualVisitors: 'TODO: Annual visitors',
    entryFee,
    heroImage,
    parkEmoji: pickEmoji(park.description || '', parkName),
    quickLinks: {
      conditions: `https://www.nps.gov/${parkCode}/planyourvisit/conditions.htm`,
      weather: `https://forecast.weather.gov/MapClick.php?lon=${coords[1]}&lat=${coords[0]}`,
      permits: `https://www.nps.gov/${parkCode}/planyourvisit/permits.htm`,
      shuttle: null,
      maps: `https://www.nps.gov/${parkCode}/planyourvisit/maps.htm`,
      campgrounds: `https://www.recreation.gov/`,
      alerts: `https://www.nps.gov/${parkCode}/planyourvisit/conditions.htm`,
      parkSpecific: {
        url: `https://www.nps.gov/${parkCode}/`,
        label: 'TODO: Park-specific link',
        icon: '🔗',
      },
    },
    trails,
    camping,
    gearNotes: 'TODO: Add park-specific gear notes.',
    seasons: {
      best: 'TODO: Best months to visit',
      avoid: 'TODO: Worst months and why',
      notes: 'TODO: Additional seasonal info',
      spring: 'TODO: Spring conditions',
      summer: 'TODO: Summer conditions',
      fall: 'TODO: Fall conditions',
      winter: 'TODO: Winter conditions',
    },
    safety: {
      primaryHazards: ['TODO: Add primary hazard 1', 'TODO: Add primary hazard 2'],
      emergencyNumber: 'TODO: Park dispatch number',
      nearestHospital: {
        name: 'TODO: Hospital name',
        address: 'TODO: Hospital address',
        phone: 'TODO: Hospital phone',
        driveTime: 'TODO: Drive time from park',
      },
      visitorCenterPhone: 'TODO: Visitor center phone',
    },
    uniqueSections: [
      {
        id: 'TODO-unique-1',
        title: 'TODO: Unique Section 1',
        icon: '⭐',
        navLabel: 'TODO',
        content: 'TODO: Deep-dive content for what makes this park special.',
      },
      {
        id: 'TODO-unique-2',
        title: 'TODO: Unique Section 2',
        icon: '⭐',
        navLabel: 'TODO',
        content: 'TODO: Deep-dive content for another unique feature.',
      },
    ],
    alerts,
    mapPOIs: trails
      .filter(t => t.coordinates)
      .map(t => ({
        lat: t.coordinates[0],
        lng: t.coordinates[1],
        label: t.name,
        description: `${t.difficulty} — ${t.distance}`,
      })),
  };

  // ---------------------------------------------------------------------------
  // Write output
  // ---------------------------------------------------------------------------

  const dataDir = resolve(PROJECT_ROOT, 'src/lib/data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const outputPath = resolve(dataDir, `${slug}.json`);
  writeFileSync(outputPath, JSON.stringify(parkData, null, 2), 'utf-8');

  console.log(`\n=== Done! ===`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Trails scraped: ${trails.length}`);
  console.log(`  Campgrounds scraped: ${camping.length}`);
  console.log(`  Alerts scraped: ${alerts.length}`);
  console.log(`\nNext step: Review the JSON file and fill in TODO fields.`);
  console.log(`Then run: node tools/generate-park.js ${slug}\n`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const parkCode = process.argv[2];

if (!parkCode) {
  console.error('Usage: node tools/scrape-nps.js <nps-park-code>');
  console.error('Example: node tools/scrape-nps.js zion');
  console.error('Example: node tools/scrape-nps.js grca');
  console.error('\nFind park codes at: https://www.nps.gov/findapark/index.htm');
  process.exit(1);
}

if (API_KEY === 'DEMO_KEY_REPLACE_ME') {
  console.warn('\nWARNING: Using placeholder API key. Set NPS_API_KEY env variable for reliable access.');
  console.warn('Get a free key at: https://developer.nps.gov/\n');
}

scrape(parkCode.toLowerCase());
