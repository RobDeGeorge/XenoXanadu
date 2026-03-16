#!/usr/bin/env node

/**
 * generate-park.js — Generate a park HTML page from template + data JSON.
 *
 * Usage:
 *   node tools/generate-park.js <slug>
 *   node tools/generate-park.js grand-canyon
 *
 * Reads:
 *   - tools/park-template.html (the HTML template)
 *   - data/<slug>.json (park data from scrape-nps.js)
 *
 * Writes:
 *   - parks/<slug>.html
 *
 * Requires: Node.js 18+
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape HTML special characters to prevent XSS in generated output.
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a single trail card HTML block.
 */
function generateTrailCard(trail, parkName) {
  const difficultyLower = (trail.difficulty || 'moderate').toLowerCase();
  const badgeClass = `badge-${difficultyLower}`;
  const permitBadge = trail.permitRequired
    ? '<span class="badge badge-permit">Permit Required</span>'
    : '<span class="badge badge-free">No Permit</span>';

  // Google Maps search link for the trailhead
  const mapQuery = encodeURIComponent(`${trail.name} ${parkName} National Park`);
  const mapLink = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;

  // Shuttle stop display
  const shuttleLabel = trail.shuttleStop || 'N/A';
  const shuttleLabelType = trail.shuttleStop ? 'Shuttle' : 'Access';

  return `
      <!-- ${trail.name} -->
      <div class="card" data-difficulty="${difficultyLower}" data-name="${escapeHtml(trail.name)}">
        <div class="card-title"><a class="map-link" href="${mapLink}" target="_blank">${escapeHtml(trail.name)}</a></div>
        <div class="card-meta">
          <span class="badge ${badgeClass}">${escapeHtml(trail.difficulty)}</span>
          ${permitBadge}
        </div>
        <div class="card-desc">${escapeHtml(trail.description)}</div>
        <div class="card-stats">
          <div class="card-stat"><div class="val">${escapeHtml(trail.distance || 'TBD')}</div><div class="lbl">Round Trip</div></div>
          <div class="card-stat"><div class="val">${escapeHtml(trail.elevationGain || 'TBD')}</div><div class="lbl">Elevation</div></div>
          <div class="card-stat"><div class="val">${escapeHtml(trail.time || 'TBD')}</div><div class="lbl">Time</div></div>
          <div class="card-stat"><div class="val">${escapeHtml(shuttleLabel)}</div><div class="lbl">${shuttleLabelType}</div></div>
        </div>
      </div>`;
}

/**
 * Generate a campground info card HTML block.
 */
function generateCampgroundCard(cg) {
  const reserveText = cg.reservations ? 'Reservations accepted' : 'First-come, first-served';
  const hookupText = cg.hookups ? 'RV hookups available' : 'No hookups';
  const bookLink = cg.bookingUrl
    ? `<p><a href="${escapeHtml(cg.bookingUrl)}" target="_blank">Book on Recreation.gov &rarr;</a></p>`
    : '';

  return `
      <div class="info-card">
        <h3>${escapeHtml(cg.name)}</h3>
        <p><strong>Sites:</strong> ${escapeHtml(String(cg.sites))} &bull; <strong>Fee:</strong> ${escapeHtml(cg.fee)} &bull; ${reserveText}</p>
        <p><strong>Season:</strong> ${escapeHtml(cg.season)} &bull; ${hookupText}</p>
        <p>${escapeHtml(cg.description)}</p>
        ${bookLink}
      </div>`;
}

/**
 * Generate unique section HTML blocks.
 */
function generateUniqueSections(sections) {
  if (!sections || sections.length === 0) return '';

  return sections.map(section => {
    const icon = section.icon || '⭐';
    const content = section.content || 'TODO: Add deep-dive content for this section.';

    return `
  <!-- ========== ${(section.title || '').toUpperCase()} ========== -->
  <div class="section" id="${escapeHtml(section.id)}">
    <div class="section-header">
      <span class="icon">${icon}</span>
      <h2>${escapeHtml(section.title)}</h2>
    </div>

    <!-- TODO: Replace this placeholder with detailed, actionable content -->
    <div class="info-row">
      <div class="info-card">
        <p>${escapeHtml(content)}</p>
      </div>
    </div>
  </div>`;
  }).join('\n');
}

/**
 * Generate nav links for unique sections.
 */
function generateUniqueNavLinks(sections) {
  if (!sections || sections.length === 0) return '';

  return sections.map(section => {
    const label = section.navLabel || section.title || section.id;
    return `    <a href="#${escapeHtml(section.id)}">${escapeHtml(label)}</a>`;
  }).join('\n');
}

/**
 * Generate alert HTML blocks.
 */
function generateAlerts(alerts) {
  if (!alerts || alerts.length === 0) return '';

  const iconMap = { danger: '⚠️', warn: '🔔', info: '📱' };
  const classMap = { danger: 'alert-danger', warn: 'alert-warn', info: 'alert-info' };

  return alerts.map(alert => {
    const level = alert.level || 'info';
    return `    <div class="alert ${classMap[level] || 'alert-info'}">
      <span class="alert-icon">${iconMap[level] || '📱'}</span>
      <div><strong>${escapeHtml(alert.title)}</strong> ${escapeHtml(alert.message)}</div>
    </div>`;
  }).join('\n');
}

/**
 * Generate map POI markers JavaScript array.
 */
function generateMapPOIs(pois) {
  if (!pois || pois.length === 0) {
    return '      // TODO: Add POI markers as [lat, lng, "Label", "description"] arrays';
  }

  return pois.map(poi =>
    `      [${poi.lat}, ${poi.lng}, "${escapeHtml(poi.label)}", "${escapeHtml(poi.description || '')}"]`
  ).join(',\n');
}

// ---------------------------------------------------------------------------
// Main generation flow
// ---------------------------------------------------------------------------

function generate(slug) {
  console.log(`\n=== Generating park page for: ${slug} ===\n`);

  // Resolve file paths
  const templatePath = resolve(__dirname, 'park-template.html');
  const dataPath = resolve(PROJECT_ROOT, 'data', `${slug}.json`);
  const parksDir = resolve(PROJECT_ROOT, 'parks');
  const outputPath = resolve(parksDir, `${slug}.html`);

  // Check template exists
  if (!existsSync(templatePath)) {
    console.error(`ERROR: Template not found at ${templatePath}`);
    process.exit(1);
  }

  // Check data exists
  if (!existsSync(dataPath)) {
    console.error(`ERROR: Data file not found at ${dataPath}`);
    console.error(`Run first: node tools/scrape-nps.js <nps-code>`);
    process.exit(1);
  }

  // Read files
  let template = readFileSync(templatePath, 'utf-8');
  const data = JSON.parse(readFileSync(dataPath, 'utf-8'));

  console.log(`  Park: ${data.name}`);
  console.log(`  Trails: ${(data.trails || []).length}`);
  console.log(`  Campgrounds: ${(data.camping || []).length}`);

  // ---------------------------------------------------------------------------
  // Generate dynamic content blocks
  // ---------------------------------------------------------------------------

  // Trail cards
  const trailCardsHtml = (data.trails || [])
    .map(t => generateTrailCard(t, data.name))
    .join('\n');

  // Campground cards
  const campgroundCardsHtml = (data.camping || [])
    .map(cg => generateCampgroundCard(cg))
    .join('\n');

  // Unique sections
  const uniqueSectionsHtml = generateUniqueSections(data.uniqueSections);
  const uniqueNavLinksHtml = generateUniqueNavLinks(data.uniqueSections);

  // Alerts (prepend to existing default alert)
  const alertsHtml = generateAlerts(data.alerts);

  // Map POIs
  const mapPOIsJs = generateMapPOIs(data.mapPOIs);

  // ---------------------------------------------------------------------------
  // Replace template variables
  // ---------------------------------------------------------------------------

  const replacements = {
    '{{PARK_NAME}}': data.name || 'TODO',
    '{{PARK_NAME_UPPER}}': (data.name || 'TODO').toUpperCase(),
    '{{PARK_SLUG}}': data.slug || slug,
    '{{NPS_CODE}}': data.npsCode || 'TODO',
    '{{PARK_EMOJI}}': data.parkEmoji || '🏞️',
    '{{HERO_IMAGE}}': data.heroImage || '',
    '{{AREA}}': data.area || 'TODO',
    '{{ELEVATION_RANGE}}': data.elevationRange || 'TODO',
    '{{TRAIL_COUNT}}': String((data.trails || []).length) + '+',
    '{{ENTRY_FEE}}': data.entryFee || 'TODO',
    '{{ANNUAL_VISITORS}}': data.annualVisitors || 'TODO',
    '{{COORDS_LAT}}': String((data.coords || [0, 0])[0]),
    '{{COORDS_LNG}}': String((data.coords || [0, 0])[1]),
    '{{GEAR_NOTES}}': data.gearNotes || 'TODO: Add park-specific gear notes.',
    '{{LAST_UPDATED}}': new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),

    // Quick links
    '{{QUICK_LINK_CONDITIONS}}': data.quickLinks?.conditions || `https://www.nps.gov/${data.npsCode}/planyourvisit/conditions.htm`,
    '{{QUICK_LINK_WEATHER}}': data.quickLinks?.weather || '#',
    '{{QUICK_LINK_PERMITS}}': data.quickLinks?.permits || `https://www.nps.gov/${data.npsCode}/planyourvisit/permits.htm`,
    '{{QUICK_LINK_SHUTTLE}}': data.quickLinks?.shuttle || '#',
    '{{SHUTTLE_HIDDEN}}': data.quickLinks?.shuttle ? '' : 'hidden',
    '{{QUICK_LINK_MAPS}}': data.quickLinks?.maps || `https://www.nps.gov/${data.npsCode}/planyourvisit/maps.htm`,
    '{{QUICK_LINK_CAMPGROUNDS}}': data.quickLinks?.campgrounds || 'https://www.recreation.gov/',
    '{{QUICK_LINK_ALERTS}}': data.quickLinks?.alerts || `https://www.nps.gov/${data.npsCode}/planyourvisit/conditions.htm`,
    '{{QUICK_LINK_PARK_SPECIFIC}}': data.quickLinks?.parkSpecific?.url || `https://www.nps.gov/${data.npsCode}/`,
    '{{QUICK_LINK_PARK_SPECIFIC_ICON}}': data.quickLinks?.parkSpecific?.icon || '🔗',
    '{{QUICK_LINK_PARK_SPECIFIC_LABEL}}': data.quickLinks?.parkSpecific?.label || 'Park Page',
  };

  // Apply simple variable replacements
  for (const [variable, value] of Object.entries(replacements)) {
    template = template.replaceAll(variable, value);
  }

  // Insert generated trail cards
  template = template.replace(
    /<!-- \{\{TRAIL_CARDS\}\} -->[\s\S]*?(?=<\/div>\s*<\/div>\s*\n\s*<!-- ={10})/,
    `<!-- Generated trail cards -->\n${trailCardsHtml}\n`
  );

  // Insert generated campground cards
  template = template.replace(
    /<!-- \{\{CAMPGROUND_CARDS\}\} -->[\s\S]*?(?=<\/div>\s*\n\s*<h3>Dispersed)/,
    `<!-- Generated campground cards -->\n${campgroundCardsHtml}\n    `
  );

  // Insert unique sections
  template = template.replace(
    /<!-- \{\{UNIQUE_SECTIONS\}\} -->[\s\S]*?(?=\n\s*<!-- ={10} TRANSPORTATION)/,
    `<!-- Generated unique sections -->\n${uniqueSectionsHtml}\n`
  );

  // Insert unique nav links
  template = template.replace(
    /<!-- \{\{NAV_UNIQUE_SECTIONS\}\} -->[\s\S]*?(?=\n\s*<!-- TODO: Add nav links)/,
    `<!-- Generated nav links -->\n${uniqueNavLinksHtml}\n`
  );

  // Insert map POIs into script block
  template = template.replace(
    /\/\/ TODO: Add POI markers[\s\S]*?(?=\n\s*\]\);)/,
    mapPOIsJs
  );

  // ---------------------------------------------------------------------------
  // Write output
  // ---------------------------------------------------------------------------

  if (!existsSync(parksDir)) {
    mkdirSync(parksDir, { recursive: true });
  }

  writeFileSync(outputPath, template, 'utf-8');

  console.log(`\n=== Done! ===`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Trail cards generated: ${(data.trails || []).length}`);
  console.log(`  Campground cards generated: ${(data.camping || []).length}`);
  console.log(`  Unique sections generated: ${(data.uniqueSections || []).length}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open parks/${slug}.html in a browser to verify`);
  console.log(`  2. Search for "TODO" and fill in all placeholders`);
  console.log(`  3. Add park-specific unique section content`);
  console.log(`  4. Run: node tools/validate-park.js ${slug}\n`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const slug = process.argv[2];

if (!slug) {
  console.error('Usage: node tools/generate-park.js <slug>');
  console.error('Example: node tools/generate-park.js grand-canyon');
  console.error('\nThe slug must match a data/<slug>.json file.');
  console.error('Run scrape-nps.js first if you haven\'t already.');
  process.exit(1);
}

generate(slug);
