# XenoXanadu Agent Playbook: Adding a New Park

> This guide is the single source of truth for any Claude agent (or human) adding a new national park page to the XenoXanadu field guide system. Follow every step in order. Do not skip validation.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Workflow](#step-by-step-workflow)
4. [Content Standards](#content-standards)
5. [Formatting Conventions](#formatting-conventions)
6. [Handling Park-Specific Sections](#handling-park-specific-sections)
7. [Definition of Done](#definition-of-done)
8. [Reference Files](#reference-files)

---

## Overview

Each park page is a self-contained, single-file HTML field guide that pulls in shared CSS and JS from `../shared/`. The workflow is: **scrape data -> generate starter page -> curate content -> validate -> integrate -> commit**.

Every page must feel like a knowledgeable friend's personal notes -- not a travel brochure. Readers should walk away knowing exactly what to pack, where to park, which trail to skip, and what mistake will ruin their trip.

---

## Prerequisites

- Node.js 18+ (for native `fetch`)
- NPS API key set as `NPS_API_KEY` environment variable (get one free at https://developer.nps.gov/)
- The park's NPS code (4-letter code, see `shared/parks-data.js`)
- Working knowledge of the park (research before writing)

---

## Step-by-Step Workflow

### Step 1: Scrape NPS Data

```bash
node tools/scrape-nps.js <nps-code>
# Example: node tools/scrape-nps.js grca
```

This pulls data from the NPS API and writes structured JSON to `data/<slug>.json`. Review the output for accuracy. The NPS API data is a starting point -- it is often incomplete or generic.

### Step 2: Generate Starter Page

```bash
node tools/generate-park.js <slug>
# Example: node tools/generate-park.js grand-canyon
```

This reads `data/<slug>.json` and `tools/park-template.html`, replaces template variables, generates trail cards and section stubs, and writes the result to `parks/<slug>.html`.

### Step 3: Curate Content

This is the most important step. The generated page has scaffolding; you need to fill it with genuinely useful content.

**For every section, ask: "Would I find this helpful standing at the trailhead with no cell service?"**

Work through every section in `tools/park-checklist.md`:

1. **Trails** -- Every trail needs: distance, elevation gain, time, difficulty, and at least 2 insider tips. Do not just restate NPS descriptions. Add: best time of day, parking tips, what most people get wrong, which viewpoint is overhyped.

2. **Park-specific unique sections** -- What makes THIS park unlike any other? Zion has The Narrows and Angels Landing deep-dives. Yellowstone would have Geothermal Safety and Wildlife Distances. Grand Canyon would have Rim-to-Rim Planning and River Permits. Add 2-3 unique sections.

3. **Food & Lodging** -- Name specific restaurants. "There are restaurants nearby" is useless. "Oscars Cafe in Springdale has massive portions and is open until 9pm" is useful.

4. **Photography** -- Specific locations, specific times, specific seasons. Include GPS coordinates or landmarks.

5. **Hidden Gems** -- Things not in the top-10 listicles. The trail everyone skips. The viewpoint with no crowd.

6. **Itineraries** -- Concrete, hour-by-hour plans for half-day, full-day, and multi-day visits. Include drive times between stops.

7. **Gear** -- Park-specific gear beyond the basics. Narrows needs neoprene socks. Death Valley needs extra radiator fluid.

8. **Safety** -- Specific to this park's hazards. Flash floods at Zion. Altitude sickness at Rocky Mountain. Bears at Glacier.

9. **Common Mistakes** -- The things first-timers always get wrong at this particular park.

10. **Map POIs** -- Add key points of interest to the Leaflet map with accurate coordinates.

### Step 4: Validate

```bash
node tools/validate-park.js <slug>
# Example: node tools/validate-park.js grand-canyon
```

Fix every issue. The validator checks:
- All required HTML sections are present
- JSON data matches the schema
- No TODO placeholders remain
- No empty sections
- Trail count in HTML matches data JSON

**The page is not done until the validator exits with code 0.**

### Step 5: Update Parks Data

In `shared/parks-data.js`, change the park's status from `"coming-soon"` to `"complete"`:

```javascript
{ name: "Grand Canyon", slug: "grand-canyon", ..., status: "complete" }
```

Verify the park appears correctly on the landing page map and that the card link works.

### Step 6: Commit

Stage and commit all changed files:
- `parks/<slug>.html`
- `data/<slug>.json`
- `shared/parks-data.js`

Use the commit message format: `feat: add <Park Name> field guide`

---

## Content Standards

### Tone

- **Knowledgeable insider**, not travel brochure
- Write like you are briefing a friend who is going next week
- Be opinionated: "Skip X, do Y instead" is better than "X and Y are both options"
- Use second person ("you") freely
- Okay to be blunt about dangers, crowds, and overrated spots

### Depth

- **Actionable over descriptive.** "Arrive before 6 AM to get parking at the Grotto" beats "The Grotto area can get crowded"
- Every tip should answer: when, where, how long, how much, or what to bring
- Include specific numbers: drive times, distances, costs, hours of operation
- Link to primary sources (NPS, Recreation.gov, USGS) not blog posts

### Quality Bar

- Every trail entry needs at least 2 insider tips
- Every section needs practical, park-specific information (no generic filler)
- All external links must point to official sources and be current
- Photography section must include specific times of day and seasons
- Itineraries must be hour-by-hour with realistic timing
- Gear section must include items specific to this park's conditions

---

## Formatting Conventions

### Emoji Usage

Emojis are used as section icons and visual markers. Follow the existing pattern:

| Context | Emoji |
|---------|-------|
| Trails section header | `🥾` |
| Insider tips header | `💡` |
| Gear header | `🎒` |
| Food header | `🍽` |
| Camping header | `⛺` |
| Itineraries header | `📋` |
| Seasons header | `📅` |
| Photography header | `📸` |
| Hidden gems header | `💎` |
| Scenic drives header | `🚗` |
| Offline maps header | `📱` |
| Maps & links header | `🗺` |
| Safety header | `⚠️` |
| Emergency header | `🚨` |
| Common mistakes header | `❌` |
| Alert: danger | `⚠️` |
| Alert: warning | `🔔` |
| Alert: info | `📱` |
| Quick link icons | Contextual (see template) |

### Heading Styles

- `<h2>` for main section titles (inside `.section-header`)
- `<h3>` for subsections within a section
- Section headers always include an icon span: `<span class="icon">EMOJI</span>`

### Link Patterns

- External links: always `target="_blank"`
- NPS links: `https://www.nps.gov/<nps-code>/...`
- Recreation.gov: `https://www.recreation.gov/...`
- Map links on trail names: `https://www.google.com/maps/search/?api=1&query=TRAIL+NAME+PARK+NAME`

### HTML Structure

- Each major section: `<div class="section" id="section-id">`
- Section comments: `<!-- ========== SECTION NAME ========== -->`
- Cards in grid: `<div class="card-grid">` containing `<div class="card">`
- Info rows: `<div class="info-row">` containing `<div class="info-card">`
- Alerts: `<div class="alert alert-danger|alert-warn|alert-info">`

### CSS Classes

All styling comes from `../shared/style.css` and `../shared/park-template.css`. Do not add inline styles except for the hero image banner (which needs a dynamic image URL). Do not add `<style>` blocks to park pages.

---

## Handling Park-Specific Sections

Every park has 2-3 things that make it unique. These get their own dedicated sections with deep-dive content, placed after the trail guide and before Insider Tips.

### How to Identify Unique Sections

Ask: "If someone has only 30 seconds, what do they NEED to know about this park that is different from every other park?"

### Examples

| Park | Unique Sections |
|------|----------------|
| Zion | The Narrows (deep-dive), Angels Landing (deep-dive) |
| Yellowstone | Geothermal Safety, Wildlife Viewing Distances, Old Faithful Timing |
| Grand Canyon | Rim-to-Rim Planning, Colorado River Permits, North vs South Rim |
| Glacier | Going-to-the-Sun Road, Grizzly Bear Protocol, Glacier Monitoring |
| Denali | Bus System, The Mountain (visibility stats), Backcountry Units |
| Acadia | Carriage Roads, Bar Island Tidal Crossing, Cadillac Sunrise Reservations |

### Implementation

Unique sections use the same `<div class="section" id="unique-id">` pattern. Add nav links for them. In the data JSON, define them under `uniqueSections`:

```json
"uniqueSections": [
  { "id": "narrows", "title": "The Narrows", "content": "..." },
  { "id": "angels", "title": "Angels Landing", "content": "..." }
]
```

---

## Definition of Done

A park page is complete when ALL of the following are true:

- [ ] `node tools/validate-park.js <slug>` exits with code 0
- [ ] All required sections are present and filled with park-specific content
- [ ] Zero TODO placeholders remain in the HTML
- [ ] All external links are working and point to official sources
- [ ] Every trail has distance, elevation, time, difficulty, and insider tips
- [ ] At least 2 park-specific unique sections exist with deep content
- [ ] Food section names specific restaurants/stores with practical details
- [ ] Photography section has specific locations, times, and seasons
- [ ] Itineraries are hour-by-hour with realistic timing
- [ ] Leaflet map has POI markers for key locations
- [ ] Page loads correctly in desktop browser
- [ ] Page is readable and functional on mobile (nav collapses, cards stack)
- [ ] `shared/parks-data.js` status updated to `"complete"`
- [ ] Park appears correctly on landing page map and card grid
- [ ] All files committed to repository

---

## Reference Files

| File | Purpose |
|------|---------|
| `tools/park-template.html` | HTML template with placeholder variables |
| `tools/data-schema.json` | JSON Schema for park data files |
| `tools/park-checklist.md` | Per-park completion checklist (copy for each new park) |
| `tools/scrape-nps.js` | NPS API data scraper |
| `tools/generate-park.js` | Page generator from template + data |
| `tools/validate-park.js` | Validates completed park against schema and requirements |
| `shared/parks-data.js` | Master list of all 63 parks with status |
| `shared/style.css` | Shared base styles |
| `shared/park-template.css` | Park page styles |
| `shared/park.js` | Shared park page JavaScript |
| `shared/map.js` | Leaflet map helper functions |
| `parks/zion.html` | Reference implementation (first complete park) |
| `data/zion.json` | Reference data file |
