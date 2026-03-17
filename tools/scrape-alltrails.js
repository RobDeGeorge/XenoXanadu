#!/usr/bin/env node

/**
 * scrape-alltrails.js — Scrape AllTrails trail data via Wayback Machine.
 *
 * AllTrails blocks all direct access (Cloudflare + Datadome captchas).
 * But the Wayback Machine caches AllTrails pages including the rendered HTML
 * which contains trail stats in TrailStats CSS classes.
 *
 * Method:
 *   1. Query Wayback Machine CDX API for the latest cached snapshot
 *   2. Fetch the cached HTML
 *   3. Extract stats from TrailStats HTML elements + JSON-LD description
 *
 * Usage:
 *   node tools/scrape-alltrails.js <alltrails-url>
 *   node tools/scrape-alltrails.js --park <slug>
 *   node tools/scrape-alltrails.js --park <slug> --compare
 *   node tools/scrape-alltrails.js --park <slug> --update
 *
 * No browser needed! Pure HTTP requests via curl.
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, '../src/lib/data');

// ── Fetch from Wayback Machine ───────────────────────────────────────────

function curlFetch(url, timeout = 20) {
  try {
    return execSync(
      `curl -sL --compressed --max-time ${timeout} "${url}" -H "User-Agent: Mozilla/5.0"`,
      { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
    );
  } catch {
    return '';
  }
}

function getLatestSnapshot(allTrailsUrl) {
  // Strip https://www.alltrails.com/ to get path
  const path = allTrailsUrl.replace(/^https?:\/\/(www\.)?/, '');

  // Try exact URL first
  let result = curlFetch(
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(path)}&output=json&limit=1&fl=timestamp,original,statuscode&sort=reverse&filter=statuscode:200`, 15
  );
  try {
    const data = JSON.parse(result);
    if (data.length > 1) {
      const [timestamp, original] = data[1];
      // Only use if snapshot is recent enough to have TrailStats HTML (post-2020)
      if (parseInt(timestamp.substring(0, 4)) >= 2020) {
        return { timestamp, url: original.startsWith('http') ? original : allTrailsUrl };
      }
    }
  } catch {}

  // Try wildcard search to find URL variants (AllTrails uses --N suffixes)
  const basePath = path.replace(/\?.*$/, '');
  result = curlFetch(
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(basePath)}*&output=json&limit=10&fl=timestamp,original,statuscode&sort=reverse&filter=statuscode:200`, 15
  );
  try {
    const data = JSON.parse(result);
    // Find the most recent snapshot from 2020+ that matches the base trail
    for (let i = 1; i < data.length; i++) {
      const [timestamp, original] = data[i];
      // Skip URLs with extra path segments (different trails)
      const origPath = original.replace(/^https?:\/\/(www\.)?alltrails\.com/, '').split('?')[0];
      const baseTrailSlug = basePath.split('/').pop();
      const origSlug = origPath.split('/').pop();
      // Match if the slug starts with our base slug (e.g., "bright-angel-trail--11" matches "bright-angel-trail")
      if (origSlug.startsWith(baseTrailSlug) && parseInt(timestamp.substring(0, 4)) >= 2020) {
        return { timestamp, url: original.split('?')[0] };
      }
    }
  } catch {}

  return null;
}

function fetchCachedPage(allTrailsUrl, timestamp) {
  const waybackUrl = `https://web.archive.org/web/${timestamp}/${allTrailsUrl}`;
  return curlFetch(waybackUrl, 30);
}

// ── Parse trail stats from cached HTML ───────────────────────────────────

function parseTrailStats(html) {
  const result = {};

  // Method 1: Extract from TrailStats HTML elements
  // Pattern: statValueSm__XXX">VALUE<span>UNIT</span>
  // Labels: statLabel__XXX">LABEL<

  const statValues = [...html.matchAll(/statValue[^>]*>([^<]+)</g)].map(m => m[1].trim());
  const statLabels = [...html.matchAll(/statLabel[^>]*>([^<]+)</g)].map(m => m[1].trim());

  for (let i = 0; i < statLabels.length; i++) {
    const label = statLabels[i].toLowerCase();
    const value = statValues[i] || '';

    if (label === 'length' && value) {
      result.distance = value + ' mi';
    } else if (label === 'elevation gain' && value) {
      result.elevationGain = value.replace(/,/g, '') + ' ft';
    } else if (label === 'estimated time' && value) {
      result.time = value + ' hr';
    } else if (label.includes('out') && label.includes('back')) {
      result.routeType = 'Out & Back';
    } else if (label === 'loop') {
      result.routeType = 'Loop';
    } else if (label.includes('point to point')) {
      result.routeType = 'Point to Point';
    }
  }

  // Check for route type in labels (it appears as a label without a value)
  for (const label of statLabels) {
    const l = label.toLowerCase().replace(/&amp;/g, '&');
    if (l.includes('out') && l.includes('back')) result.routeType = 'Out & Back';
    else if (l === 'loop') result.routeType = 'Loop';
    else if (l.includes('point to point')) result.routeType = 'Point to Point';
  }

  // Method 2: Extract from JSON-LD description
  // Pattern: "this X.X-mile [type] trail ... [difficulty]"
  const descMatch = html.match(/"description"\s*:\s*"([^"]+mile[^"]+)"/i);
  if (descMatch) {
    const desc = descMatch[1];

    // Distance from description (backup)
    if (!result.distance) {
      const distMatch = desc.match(/([\d.]+)-mile/);
      if (distMatch) result.distance = distMatch[1] + ' mi';
    }

    // Route type from description
    if (!result.routeType) {
      if (/out-and-back/i.test(desc)) result.routeType = 'Out & Back';
      else if (/\bloop\b/i.test(desc)) result.routeType = 'Loop';
      else if (/point-to-point/i.test(desc)) result.routeType = 'Point to Point';
    }

    // Difficulty from description
    if (/highly challenging|challenging route/i.test(desc)) result.difficulty = 'Hard';
    else if (/moderately challenging/i.test(desc)) result.difficulty = 'Moderate';
    else if (/easy|generally considered an? easy/i.test(desc)) result.difficulty = 'Easy';
  }

  // Method 3: Extract difficulty from React/Next.js serialized data
  if (!result.difficulty) {
    // AllTrails difficulty ratings in their data
    if (html.includes('"difficultyRating":"HARD"') || html.includes('"difficultyRating":"hard"')) {
      result.difficulty = 'Hard';
    } else if (html.includes('"difficultyRating":"MODERATE"') || html.includes('"difficultyRating":"moderate"')) {
      result.difficulty = 'Moderate';
    } else if (html.includes('"difficultyRating":"EASY"') || html.includes('"difficultyRating":"easy"')) {
      result.difficulty = 'Easy';
    }
  }

  // Method 4: Rating from JSON-LD
  const ratingMatch = html.match(/"ratingValue"\s*:\s*([\d.]+)/);
  const reviewMatch = html.match(/"reviewCount"\s*:\s*(\d+)/);
  if (ratingMatch) result.rating = ratingMatch[1];
  if (reviewMatch) result.reviews = reviewMatch[1];

  return result;
}

// ── Scrape one trail ─────────────────────────────────────────────────────

function scrapeTrail(allTrailsUrl) {
  const snapshot = getLatestSnapshot(allTrailsUrl);
  if (!snapshot) {
    return { error: 'No recent Wayback Machine snapshot found' };
  }

  const fetchUrl = snapshot.url.startsWith('http') ? snapshot.url : allTrailsUrl;
  const html = fetchCachedPage(fetchUrl, snapshot.timestamp);
  if (!html || html.length < 1000) {
    return { error: 'Failed to fetch cached page' };
  }

  const stats = parseTrailStats(html);
  stats.snapshotDate = snapshot.timestamp.substring(0, 8); // YYYYMMDD
  stats.waybackUrl = `https://web.archive.org/web/${snapshot.timestamp}/${fetchUrl}`;
  return stats;
}

// ── Format for our JSON schema ───────────────────────────────────────────

function formatForSchema(scraped) {
  const difficultyMap = { 'Easy': 'easy', 'Moderate': 'moderate', 'Hard': 'strenuous' };
  const routeTypeMap = { 'Out & Back': 'Round Trip', 'Loop': 'Loop', 'Point to Point': 'One Way' };

  let elev = scraped.elevationGain;
  if (elev) {
    const num = parseInt(elev.replace(/[^0-9]/g, ''));
    elev = (num >= 1000 ? num.toLocaleString() : String(num)) + '\u2032';
  }

  return {
    distance: scraped.distance || '?',
    distanceType: routeTypeMap[scraped.routeType] || '?',
    elevationGain: elev || '?',
    difficulty: difficultyMap[scraped.difficulty] || '?',
    time: scraped.time || '?',
  };
}

// ── Load park data ───────────────────────────────────────────────────────

function loadPark(slug) {
  const file = resolve(DATA_DIR, `${slug}.json`);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function getTrailsWithAllTrails(park) {
  return (park.trails || [])
    .map((t, i) => ({
      index: i,
      name: t.name,
      distance: t.distance,
      elevationGain: t.elevationGain,
      distanceType: t.distanceType,
      difficulty: t.difficulty,
      time: t.time,
      url: t.links?.find(l => l.url?.includes('alltrails.com'))?.url || null
    }))
    .filter(t => t.url);
}

// ── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isCompare = args.includes('--compare');
const isUpdate = args.includes('--update');
const parkIndex = args.indexOf('--park');

if (args.length === 0) {
  console.log(`
  AllTrails Scraper (via Wayback Machine)
  ───────────────────────────────────────

  Fetches trail stats from Wayback Machine cached AllTrails pages.
  No browser needed — pure HTTP requests.

  Usage:
    node tools/scrape-alltrails.js <alltrails-url>          Single trail
    node tools/scrape-alltrails.js --park <slug>             All trails for a park
    node tools/scrape-alltrails.js --park <slug> --compare   Compare vs our data
    node tools/scrape-alltrails.js --park <slug> --update    Auto-fix mismatches

  Examples:
    node tools/scrape-alltrails.js https://www.alltrails.com/trail/us/utah/angels-landing-trail
    node tools/scrape-alltrails.js --park zion --compare
    node tools/scrape-alltrails.js --park grand-canyon --update
  `);
  process.exit(0);
}

if (parkIndex !== -1) {
  const slug = args[parkIndex + 1];
  if (!slug) { console.error('Error: --park requires a slug'); process.exit(1); }

  const park = loadPark(slug);
  const parkName = park.name?.replace(' National Park', '') || slug;
  const trails = getTrailsWithAllTrails(park);

  console.log(`\n  ${parkName} — ${trails.length} trails with AllTrails links\n`);
  console.log(`  ${'Trail'.padEnd(36)} ${'Distance'.padEnd(10)} ${'Elevation'.padEnd(10)} ${'Type'.padEnd(14)} ${'Diff'.padEnd(10)} Snapshot`);
  console.log(`  ${'─'.repeat(95)}`);

  const results = [];

  for (let i = 0; i < trails.length; i++) {
    const t = trails[i];
    const label = t.name.length > 34 ? t.name.substring(0, 31) + '...' : t.name.padEnd(34);
    process.stdout.write(`  ${label}  `);

    const scraped = scrapeTrail(t.url);
    const fmt = formatForSchema(scraped);
    results.push({ trail: t, scraped, formatted: fmt });

    if (scraped.error) {
      console.log(`ERROR: ${scraped.error}`);
    } else {
      const d = (fmt.distance || '—').padEnd(10);
      const e = (fmt.elevationGain || '—').padEnd(10);
      const r = (fmt.distanceType || '—').padEnd(14);
      const diff = (fmt.difficulty || '—').padEnd(10);
      const snap = scraped.snapshotDate || '—';
      console.log(`${d} ${e} ${r} ${diff} ${snap}`);
    }

    // Small delay between Wayback requests
    if (i < trails.length - 1) {
      execSync('sleep 1');
    }
  }

  if (isCompare || isUpdate) {
    console.log(`\n  ${'═'.repeat(70)}`);
    console.log(`  ${isUpdate ? 'AUTO-UPDATE' : 'COMPARISON'}: Our Data vs AllTrails`);
    console.log(`  ${'═'.repeat(70)}\n`);

    let matches = 0, mismatches = 0, unknown = 0, updated = 0;

    for (const r of results) {
      const { trail: t, formatted: f, scraped: s } = r;

      if (s.error) { console.log(`  ? ${t.name}: ${s.error}`); unknown++; continue; }

      const issues = [];

      // Compare distance
      if (f.distance !== '?' && f.distance !== t.distance) {
        const ourDist = parseFloat(t.distance);
        const theirDist = parseFloat(f.distance);
        const ratio = ourDist > 0 ? theirDist / ourDist : 99;
        issues.push({
          field: 'distance', ours: t.distance, theirs: f.distance,
          suspicious: ratio > 3 || ratio < 0.33
        });
      }

      // Compare elevation
      if (f.elevationGain !== '?') {
        const ourNum = parseInt((t.elevationGain || '').replace(/[^0-9]/g, ''));
        const theirNum = parseInt((f.elevationGain || '').replace(/[^0-9]/g, ''));
        if (ourNum !== theirNum) {
          const ratio = ourNum > 0 ? theirNum / ourNum : 99;
          issues.push({
            field: 'elevationGain', ours: t.elevationGain, theirs: f.elevationGain,
            suspicious: ratio > 5 || ratio < 0.2
          });
        }
      }

      if (f.distance === '?' && f.elevationGain === '?') {
        unknown++;
        console.log(`  ? ${t.name} — no stats found in cached page`);
      } else if (issues.length > 0) {
        mismatches++;
        console.log(`  ✗ ${t.name}`);
        for (const iss of issues) {
          const flag = iss.suspicious ? ' ⚠ SUSPICIOUS' : '';
          console.log(`      ${iss.field}: ours=${iss.ours}  alltrails=${iss.theirs}${flag}`);
          if (isUpdate && !iss.suspicious) {
            park.trails[t.index][iss.field] = iss.field === 'elevationGain'
              ? iss.theirs.replace(/'/g, '\u2032')
              : iss.theirs;
            updated++;
          }
        }
      } else {
        matches++;
        console.log(`  ✓ ${t.name}`);
      }
    }

    if (isUpdate && updated > 0) {
      const file = resolve(DATA_DIR, `${slug}.json`);
      writeFileSync(file, JSON.stringify(park, null, 2) + '\n');
      console.log(`\n  ✓ Updated ${updated} field(s) in ${slug}.json`);
    }

    console.log(`\n  Summary: ${matches} match, ${mismatches} mismatch, ${unknown} no data`);
    if (mismatches > 0 && !isUpdate) {
      console.log(`  Run with --update to auto-fix mismatches.`);
    }
    console.log();
  }

} else {
  // Single URL mode
  const url = args[0];
  console.log(`\n  Scraping: ${url}\n`);

  const scraped = scrapeTrail(url);
  const formatted = formatForSchema(scraped);

  if (scraped.error) {
    console.log(`  Error: ${scraped.error}\n`);
    process.exit(1);
  }

  console.log(`  AllTrails Data (from Wayback snapshot ${scraped.snapshotDate}):`);
  console.log(`    Distance:       ${scraped.distance || '?'}`);
  console.log(`    Elevation Gain: ${scraped.elevationGain || '?'}`);
  console.log(`    Route Type:     ${scraped.routeType || '?'}`);
  console.log(`    Difficulty:     ${scraped.difficulty || '?'}`);
  console.log(`    Time:           ${scraped.time || '?'}`);
  console.log(`    Rating:         ${scraped.rating || '?'} (${scraped.reviews || '?'} reviews)`);
  console.log(`\n  For our JSON schema:`);
  console.log(`  ${JSON.stringify(formatted, null, 4)}\n`);
}
