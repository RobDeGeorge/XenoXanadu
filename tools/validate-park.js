#!/usr/bin/env node

/**
 * validate-park.js — Validate a completed park page against the schema and content requirements.
 *
 * Usage:
 *   node tools/validate-park.js <slug>
 *   node tools/validate-park.js grand-canyon
 *
 * Checks:
 *   - parks/<slug>.html exists
 *   - data/<slug>.json exists and validates against schema
 *   - All required HTML sections are present
 *   - Trail count in HTML matches data JSON
 *   - No TODO placeholders remaining
 *   - No empty sections
 *   - Completion percentage
 *
 * Exit codes:
 *   0 = All checks pass
 *   1 = Issues found (see output for details)
 *
 * Requires: Node.js 18+
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Validation checks
// ---------------------------------------------------------------------------

/** All issues found during validation. */
const issues = [];
const warnings = [];
const passed = [];

function fail(message) {
  issues.push(message);
}

function warn(message) {
  warnings.push(message);
}

function pass(message) {
  passed.push(message);
}

/**
 * Required HTML section IDs that every park page must have.
 */
const REQUIRED_SECTIONS = [
  { id: 'trails',        label: 'Trail Guide' },
  { id: 'shuttle',       label: 'Transportation / Shuttle' },
  { id: 'tips',          label: 'Insider Tips' },
  { id: 'gear',          label: 'Gear Checklist' },
  { id: 'food',          label: 'Food & Lodging' },
  { id: 'camping',       label: 'Camping' },
  { id: 'itineraries',   label: 'Itineraries' },
  { id: 'seasons',       label: 'When to Visit' },
  { id: 'photo',         label: 'Photography Spots' },
  { id: 'gems',          label: 'Hidden Gems' },
  { id: 'drives',        label: 'Scenic Drives' },
  { id: 'offline-maps',  label: 'Offline Maps' },
  { id: 'maps',          label: 'Maps & Links' },
  { id: 'safety',        label: 'Safety' },
  { id: 'emergency',     label: 'Emergency Contacts' },
  { id: 'mistakes',      label: 'Common Mistakes' },
];

/**
 * Required fields in the data JSON (based on data-schema.json).
 */
const REQUIRED_JSON_FIELDS = ['name', 'slug', 'state', 'region', 'coords', 'npsCode'];

/**
 * Fields that should not contain TODO values in a finished park.
 */
const SHOULD_NOT_BE_TODO = [
  'area', 'elevationRange', 'annualVisitors', 'entryFee', 'heroImage', 'gearNotes',
];

/**
 * Valid region values.
 */
const VALID_REGIONS = ['Southwest', 'West', 'Midwest', 'Southeast', 'Northeast', 'Pacific', 'Alaska', 'Hawaii'];

/**
 * Valid difficulty values.
 */
const VALID_DIFFICULTIES = ['Easy', 'Moderate', 'Strenuous'];

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

function validate(slug) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  VALIDATING: ${slug}`);
  console.log(`${'='.repeat(60)}\n`);

  const htmlPath = resolve(PROJECT_ROOT, 'parks', `${slug}.html`);
  const dataPath = resolve(PROJECT_ROOT, 'data', `${slug}.json`);

  // -------------------------------------------------------------------------
  // Check 1: Files exist
  // -------------------------------------------------------------------------

  console.log('--- File Existence ---');

  if (!existsSync(htmlPath)) {
    fail(`HTML file missing: parks/${slug}.html`);
    console.log(`  FAIL  parks/${slug}.html does not exist`);
  } else {
    pass('HTML file exists');
    console.log(`  PASS  parks/${slug}.html exists`);
  }

  if (!existsSync(dataPath)) {
    fail(`Data file missing: data/${slug}.json`);
    console.log(`  FAIL  data/${slug}.json does not exist`);
    // Cannot continue without data file
    printSummary();
    process.exit(1);
  } else {
    pass('Data file exists');
    console.log(`  PASS  data/${slug}.json exists`);
  }

  // -------------------------------------------------------------------------
  // Check 2: JSON is valid and parseable
  // -------------------------------------------------------------------------

  console.log('\n--- Data JSON Validation ---');

  let data;
  try {
    const rawJson = readFileSync(dataPath, 'utf-8');
    data = JSON.parse(rawJson);
    pass('JSON is valid and parseable');
    console.log('  PASS  JSON is valid');
  } catch (err) {
    fail(`JSON parse error: ${err.message}`);
    console.log(`  FAIL  JSON parse error: ${err.message}`);
    printSummary();
    process.exit(1);
  }

  // Check required fields
  for (const field of REQUIRED_JSON_FIELDS) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      fail(`Missing required JSON field: ${field}`);
      console.log(`  FAIL  Missing required field: ${field}`);
    } else {
      pass(`Required field present: ${field}`);
      console.log(`  PASS  Field present: ${field}`);
    }
  }

  // Check region validity
  if (data.region && !VALID_REGIONS.includes(data.region)) {
    fail(`Invalid region "${data.region}". Must be one of: ${VALID_REGIONS.join(', ')}`);
    console.log(`  FAIL  Invalid region: ${data.region}`);
  }

  // Check coords format
  if (data.coords) {
    if (!Array.isArray(data.coords) || data.coords.length !== 2) {
      fail('coords must be an array of [lat, lng]');
      console.log('  FAIL  Invalid coords format');
    } else if (typeof data.coords[0] !== 'number' || typeof data.coords[1] !== 'number') {
      fail('coords values must be numbers');
      console.log('  FAIL  coords values must be numbers');
    } else {
      pass('coords format valid');
      console.log(`  PASS  coords: [${data.coords[0]}, ${data.coords[1]}]`);
    }
  }

  // Check NPS code format
  if (data.npsCode && !/^[a-z]{4}$/.test(data.npsCode)) {
    fail(`npsCode "${data.npsCode}" must be exactly 4 lowercase letters`);
    console.log(`  FAIL  Invalid npsCode format: ${data.npsCode}`);
  }

  // Check fields that should not be TODO
  for (const field of SHOULD_NOT_BE_TODO) {
    const value = data[field];
    if (typeof value === 'string' && value.includes('TODO')) {
      warn(`Field "${field}" still contains TODO: "${value}"`);
      console.log(`  WARN  ${field} still has TODO placeholder`);
    }
  }

  // -------------------------------------------------------------------------
  // Check 3: Trail data validation
  // -------------------------------------------------------------------------

  console.log('\n--- Trail Data Validation ---');

  const trails = data.trails || [];
  console.log(`  INFO  ${trails.length} trails in data JSON`);

  if (trails.length === 0) {
    fail('No trails defined in data JSON');
    console.log('  FAIL  No trails found');
  }

  let trailsWithTodo = 0;
  let trailsMissingTips = 0;

  for (const trail of trails) {
    if (!trail.name) {
      fail('Trail missing name');
    }
    if (!trail.difficulty || !VALID_DIFFICULTIES.includes(trail.difficulty)) {
      warn(`Trail "${trail.name}" has invalid difficulty: "${trail.difficulty}"`);
    }
    if (trail.distance && trail.distance.includes('TODO')) trailsWithTodo++;
    if (trail.elevationGain && trail.elevationGain.includes('TODO')) trailsWithTodo++;
    if (trail.time && trail.time.includes('TODO')) trailsWithTodo++;
    if (!trail.tips || trail.tips.length < 2) trailsMissingTips++;
    if (trail.tips && trail.tips.some(t => t.includes('TODO'))) trailsMissingTips++;
  }

  if (trailsWithTodo > 0) {
    warn(`${trailsWithTodo} trail fields still have TODO placeholders`);
    console.log(`  WARN  ${trailsWithTodo} trail data fields are TODO`);
  } else if (trails.length > 0) {
    pass('All trail data fields filled');
    console.log('  PASS  All trail data fields filled');
  }

  if (trailsMissingTips > 0) {
    warn(`${trailsMissingTips} trails are missing insider tips (need at least 2 per trail)`);
    console.log(`  WARN  ${trailsMissingTips} trails need insider tips`);
  } else if (trails.length > 0) {
    pass('All trails have insider tips');
    console.log('  PASS  All trails have insider tips');
  }

  // -------------------------------------------------------------------------
  // Check 4: HTML section validation
  // -------------------------------------------------------------------------

  let html = '';
  if (existsSync(htmlPath)) {
    html = readFileSync(htmlPath, 'utf-8');

    console.log('\n--- HTML Section Validation ---');

    for (const section of REQUIRED_SECTIONS) {
      // Check for id="section-id" in the HTML
      const regex = new RegExp(`id=["']${section.id}["']`);
      if (regex.test(html)) {
        pass(`Section present: ${section.label}`);
        console.log(`  PASS  Section: ${section.label} (id="${section.id}")`);
      } else {
        fail(`Missing required section: ${section.label} (id="${section.id}")`);
        console.log(`  FAIL  Missing section: ${section.label} (id="${section.id}")`);
      }
    }

    // Check for unique sections from data
    if (data.uniqueSections && data.uniqueSections.length > 0) {
      console.log('\n--- Unique Sections ---');
      for (const section of data.uniqueSections) {
        const regex = new RegExp(`id=["']${section.id}["']`);
        if (regex.test(html)) {
          pass(`Unique section present: ${section.title}`);
          console.log(`  PASS  Unique section: ${section.title} (id="${section.id}")`);
        } else {
          warn(`Unique section defined in data but missing in HTML: ${section.title} (id="${section.id}")`);
          console.log(`  WARN  Unique section missing from HTML: ${section.title}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Check 5: Trail count in HTML vs data
    // -----------------------------------------------------------------------

    console.log('\n--- Trail Count Match ---');

    // Count trail cards in HTML (look for data-difficulty attribute on card divs)
    const htmlTrailCards = (html.match(/data-difficulty=/g) || []).length;
    const dataTrailCount = trails.length;

    console.log(`  INFO  Trails in HTML: ${htmlTrailCards}`);
    console.log(`  INFO  Trails in data: ${dataTrailCount}`);

    if (htmlTrailCards === dataTrailCount) {
      pass('Trail count matches between HTML and data');
      console.log('  PASS  Trail count matches');
    } else {
      warn(`Trail count mismatch: HTML has ${htmlTrailCards}, data has ${dataTrailCount}`);
      console.log('  WARN  Trail count mismatch');
    }

    // -----------------------------------------------------------------------
    // Check 6: TODO placeholders in HTML
    // -----------------------------------------------------------------------

    console.log('\n--- TODO Placeholders ---');

    const todoMatches = html.match(/TODO[:\s]/g) || [];
    const todoCount = todoMatches.length;

    if (todoCount === 0) {
      pass('No TODO placeholders in HTML');
      console.log('  PASS  No TODO placeholders found');
    } else {
      fail(`${todoCount} TODO placeholders still present in HTML`);
      console.log(`  FAIL  ${todoCount} TODO placeholders remain`);

      // Show first few TODO locations for context
      const lines = html.split('\n');
      let shown = 0;
      for (let i = 0; i < lines.length && shown < 5; i++) {
        if (/TODO[:\s]/.test(lines[i])) {
          console.log(`         Line ${i + 1}: ${lines[i].trim().substring(0, 80)}...`);
          shown++;
        }
      }
      if (todoCount > 5) {
        console.log(`         ... and ${todoCount - 5} more`);
      }
    }

    // -----------------------------------------------------------------------
    // Check 7: Empty sections
    // -----------------------------------------------------------------------

    console.log('\n--- Empty Section Check ---');

    let emptySections = 0;
    for (const section of REQUIRED_SECTIONS) {
      // Extract section content between this section's id and the next section marker
      const sectionRegex = new RegExp(
        `id=["']${section.id}["'][\\s\\S]*?(?=<div class=["']section["']|<!-- BACK TO TOP|$)`
      );
      const match = html.match(sectionRegex);

      if (match) {
        const sectionContent = match[0];
        // Strip HTML tags, whitespace, and common boilerplate
        const textContent = sectionContent
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Check if section has meaningful content (more than just the header)
        // A section with only a header + empty structure will have very little text
        const wordCount = textContent.split(/\s+/).filter(w => w.length > 2).length;

        if (wordCount < 15) {
          warn(`Section "${section.label}" appears to have very little content (${wordCount} words)`);
          console.log(`  WARN  Sparse section: ${section.label} (~${wordCount} words)`);
          emptySections++;
        }
      }
    }

    if (emptySections === 0) {
      pass('All sections have content');
      console.log('  PASS  All sections have content');
    }

    // -----------------------------------------------------------------------
    // Check 8: Essential HTML structure
    // -----------------------------------------------------------------------

    console.log('\n--- HTML Structure ---');

    const structureChecks = [
      { pattern: /<nav>/, label: 'Navigation bar' },
      { pattern: /class=["']hero["']/, label: 'Hero section' },
      { pattern: /class=["']quick-bar["']/, label: 'Quick access bar' },
      { pattern: /id=["']parkMap["']/, label: 'Interactive map container' },
      { pattern: /<footer>/, label: 'Footer' },
      { pattern: /id=["']trailModal["']/, label: 'Trail detail modal' },
      { pattern: /shared\/park\.js/, label: 'Shared park.js script link' },
      { pattern: /shared\/map\.js/, label: 'Shared map.js script link' },
      { pattern: /shared\/style\.css/, label: 'Shared style.css link' },
      { pattern: /shared\/park-template\.css/, label: 'Shared park-template.css link' },
      { pattern: /leaflet/, label: 'Leaflet library' },
    ];

    for (const check of structureChecks) {
      if (check.pattern.test(html)) {
        pass(`Structure: ${check.label}`);
        console.log(`  PASS  ${check.label}`);
      } else {
        fail(`Missing structure: ${check.label}`);
        console.log(`  FAIL  Missing: ${check.label}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Check 9: Unique sections count
  // -------------------------------------------------------------------------

  console.log('\n--- Unique Sections Count ---');

  const uniqueSections = data.uniqueSections || [];
  if (uniqueSections.length >= 2) {
    pass(`${uniqueSections.length} unique sections defined`);
    console.log(`  PASS  ${uniqueSections.length} unique sections defined`);
  } else if (uniqueSections.length === 1) {
    warn('Only 1 unique section defined (recommend at least 2)');
    console.log('  WARN  Only 1 unique section (recommend 2-3)');
  } else {
    fail('No unique sections defined (need at least 2 park-specific sections)');
    console.log('  FAIL  No unique sections defined');
  }

  // -------------------------------------------------------------------------
  // Check 10: Safety and emergency data
  // -------------------------------------------------------------------------

  console.log('\n--- Safety & Emergency Data ---');

  if (data.safety) {
    if (data.safety.emergencyNumber && !data.safety.emergencyNumber.includes('TODO')) {
      pass('Emergency number provided');
      console.log('  PASS  Emergency number provided');
    } else {
      warn('Emergency dispatch number is TODO or missing');
      console.log('  WARN  Emergency number missing');
    }

    if (data.safety.nearestHospital?.name && !data.safety.nearestHospital.name.includes('TODO')) {
      pass('Nearest hospital info provided');
      console.log('  PASS  Nearest hospital info provided');
    } else {
      warn('Nearest hospital info is TODO or missing');
      console.log('  WARN  Nearest hospital info missing');
    }

    const hazards = data.safety.primaryHazards || [];
    const realHazards = hazards.filter(h => !h.includes('TODO'));
    if (realHazards.length >= 2) {
      pass(`${realHazards.length} safety hazards documented`);
      console.log(`  PASS  ${realHazards.length} safety hazards documented`);
    } else {
      warn('Fewer than 2 safety hazards documented');
      console.log('  WARN  Need more safety hazard documentation');
    }
  } else {
    fail('No safety data in JSON');
    console.log('  FAIL  No safety data found');
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  printSummary();
}

function printSummary() {
  const total = passed.length + issues.length + warnings.length;
  const passRate = total > 0 ? Math.round((passed.length / total) * 100) : 0;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  VALIDATION SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Passed:   ${passed.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Failures: ${issues.length}`);
  console.log(`  Score:    ${passRate}% (${passed.length}/${total})`);
  console.log(`${'='.repeat(60)}`);

  if (issues.length > 0) {
    console.log('\n  FAILURES (must fix):');
    issues.forEach((issue, i) => {
      console.log(`    ${i + 1}. ${issue}`);
    });
  }

  if (warnings.length > 0) {
    console.log('\n  WARNINGS (should fix):');
    warnings.forEach((w, i) => {
      console.log(`    ${i + 1}. ${w}`);
    });
  }

  if (issues.length === 0 && warnings.length === 0) {
    console.log('\n  All checks passed! Park page is ready.');
  } else if (issues.length === 0) {
    console.log('\n  No failures, but warnings should be addressed before marking complete.');
  } else {
    console.log(`\n  Fix ${issues.length} failure(s) before marking this park as complete.`);
  }

  console.log('');

  // Exit code: 0 = valid, 1 = issues found
  if (issues.length > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const slug = process.argv[2];

if (!slug) {
  console.error('Usage: node tools/validate-park.js <slug>');
  console.error('Example: node tools/validate-park.js grand-canyon');
  process.exit(1);
}

validate(slug);
