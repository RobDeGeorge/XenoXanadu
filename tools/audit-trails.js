#!/usr/bin/env node

/**
 * audit-trails.js — Cross-reference trail data against known sources.
 *
 * Usage:
 *   node tools/audit-trails.js <slug>
 *   node tools/audit-trails.js zion
 *   node tools/audit-trails.js --all
 *
 * What it does:
 *   1. Reads park JSON data
 *   2. For each trail, extracts our recorded stats
 *   3. Outputs a structured audit report for manual verification
 *   4. Flags common data issues (missing elevation, "Varies" values, suspicious numbers)
 *
 * Data priority rules:
 *   - If trail has AllTrails link → AllTrails data is authoritative
 *   - If trail has NPS link only → NPS data is authoritative
 *   - If trail has both → AllTrails takes priority
 *
 * Requires: Node.js 18+
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, '../src/lib/data');

// ── Helpers ──────────────────────────────────────────────────────────────

function loadPark(slug) {
  const file = resolve(DATA_DIR, `${slug}.json`);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function getSource(trail) {
  if (!trail.links) return 'none';
  const hasAllTrails = trail.links.some(l => l.url?.includes('alltrails.com'));
  const hasNPS = trail.links.some(l => l.url?.includes('nps.gov'));
  if (hasAllTrails) return 'AllTrails';
  if (hasNPS) return 'NPS';
  return 'none';
}

function getAllTrailsUrl(trail) {
  if (!trail.links) return null;
  const link = trail.links.find(l => l.url?.includes('alltrails.com'));
  return link?.url || null;
}

function parseDistance(str) {
  if (!str) return null;
  const match = str.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

function parseElevation(str) {
  if (!str) return null;
  // Handle ranges like "70–580"
  const rangeMatch = str.match(/([\d,]+)\s*[–-]\s*([\d,]+)/);
  if (rangeMatch) return parseInt(rangeMatch[2].replace(/,/g, ''));
  const match = str.match(/([\d,]+)/);
  return match ? parseInt(match[1].replace(/,/g, '')) : null;
}

// ── Validation checks ───────────────────────────────────────────────────

function auditTrail(trail, parkName) {
  const issues = [];
  const warnings = [];
  const source = getSource(trail);
  const allTrailsUrl = getAllTrailsUrl(trail);

  // Check for missing data
  if (!trail.distance) issues.push('Missing distance');
  if (!trail.elevationGain) issues.push('Missing elevation gain');
  if (!trail.time) issues.push('Missing time estimate');
  if (!trail.difficulty) issues.push('Missing difficulty');

  // Check for vague/placeholder values
  if (trail.elevationGain === 'Varies' || trail.elevationGain === 'varies') {
    issues.push('Elevation gain is "Varies" — should be a specific number');
  }
  if (trail.distance?.includes('Varies')) {
    issues.push('Distance is "Varies" — should be a specific number');
  }

  // Check for tilde/approximate markers (not necessarily wrong, but flag)
  if (trail.elevationGain?.startsWith('~')) {
    warnings.push('Elevation gain is approximate (~) — verify against source');
  }

  // Check distance sanity
  const dist = parseDistance(trail.distance);
  const elev = parseElevation(trail.elevationGain);

  if (dist && elev) {
    // Flag if elevation gain seems too high for distance (>1000ft/mi avg for strenuous)
    const ratio = elev / dist;
    if (ratio > 1200 && trail.difficulty !== 'strenuous') {
      warnings.push(`High elevation/distance ratio (${Math.round(ratio)} ft/mi) for ${trail.difficulty} trail`);
    }
    // Flag if elevation gain seems too low for strenuous trails
    if (trail.difficulty === 'strenuous' && elev < 500 && dist < 5) {
      warnings.push('Low elevation gain for strenuous rating');
    }
  }

  // Check if "Round Trip" distance seems like a one-way distance
  if (trail.distanceType === 'Round Trip' && dist && dist > 20) {
    warnings.push(`Very long round trip (${dist} mi) — verify this isn't a one-way distance`);
  }

  // Check for no source link at all
  if (source === 'none') {
    warnings.push('No AllTrails or NPS link — data cannot be independently verified');
  }

  return {
    name: trail.name,
    park: parkName,
    source,
    allTrailsUrl,
    distance: trail.distance,
    distanceType: trail.distanceType,
    elevationGain: trail.elevationGain,
    time: trail.time,
    difficulty: trail.difficulty,
    issues,
    warnings,
    status: issues.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'OK'
  };
}

// ── Report formatting ────────────────────────────────────────────────────

function printReport(results, parkName) {
  const fails = results.filter(r => r.status === 'FAIL');
  const warns = results.filter(r => r.status === 'WARN');
  const oks = results.filter(r => r.status === 'OK');

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  TRAIL AUDIT: ${parkName.toUpperCase()}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  Total: ${results.length} trails | ✓ ${oks.length} OK | ⚠ ${warns.length} WARN | ✗ ${fails.length} FAIL\n`);

  // Print table header
  console.log('  %-35s %-12s %-10s %-10s %-10s %-8s', 'Trail', 'Distance', 'Elev Gain', 'Time', 'Source', 'Status');
  console.log(`  ${'─'.repeat(85)}`);

  for (const r of results) {
    const statusIcon = r.status === 'OK' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
    const name = r.name.length > 33 ? r.name.substring(0, 30) + '...' : r.name;
    console.log(`  ${statusIcon} %-33s %-12s %-10s %-10s %-10s`, name, r.distance || '?', r.elevationGain || '?', r.time || '?', r.source);

    for (const issue of r.issues) {
      console.log(`    ✗ ${issue}`);
    }
    for (const warning of r.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }

  // Print verification URLs
  console.log(`\n  VERIFICATION LINKS (open in browser to manually check):`);
  console.log(`  ${'─'.repeat(60)}`);
  for (const r of results) {
    if (r.allTrailsUrl) {
      console.log(`  ${r.name}:`);
      console.log(`    ${r.allTrailsUrl}`);
    }
  }

  console.log(`\n${'═'.repeat(70)}\n`);

  return fails.length;
}

// ── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node tools/audit-trails.js <slug> | --all');
  console.log('Example: node tools/audit-trails.js zion');
  process.exit(0);
}

let slugs;
if (args[0] === '--all') {
  // Find all complete park JSON files
  const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  slugs = files.map(f => f.replace('.json', ''));
} else {
  slugs = [args[0]];
}

let totalFails = 0;

for (const slug of slugs) {
  try {
    const park = loadPark(slug);
    if (!park.trails?.length) {
      console.log(`No trails found for ${slug}`);
      continue;
    }

    const results = park.trails.map(t => auditTrail(t, park.name));
    totalFails += printReport(results, park.name);
  } catch (err) {
    console.error(`Error loading ${slug}: ${err.message}`);
    totalFails++;
  }
}

process.exit(totalFails > 0 ? 1 : 0);
