# XenoXanadu — AI Agent Guide

## Project Overview

XenoXanadu is a static SvelteKit site providing personal field guides for US national parks. Currently 2 of 63 parks have complete guides (Zion, Grand Canyon). The site is hosted on GitHub Pages at xenoxanadu.com.

**Stack:** SvelteKit 5 + adapter-static, Leaflet maps, custom CSS (no framework), Svelte 5 runes

## Commands

```bash
npm run dev        # Dev server
npm run build      # Build static site
npm run preview    # Preview production build (port 4173)
```

## Trail Data Accuracy — CRITICAL

Trail stats (distance, elevation gain, time, route type) MUST match AllTrails data when the trail card has an AllTrails link. This is the #1 data quality requirement.

### Data priority rule
- **AllTrails link present** → AllTrails is the authoritative source
- **NPS link only** → NPS data is authoritative
- **Both links** → AllTrails takes priority

### Tools for verifying trail data

#### 1. AllTrails Scraper (Wayback Machine)
```bash
# Scrape a single trail
node tools/scrape-alltrails.js https://www.alltrails.com/trail/us/utah/angels-landing-trail

# Scrape all trails for a park and compare against our data
node tools/scrape-alltrails.js --park zion --compare

# Auto-fix mismatches (skips suspicious data automatically)
node tools/scrape-alltrails.js --park zion --update
```

**How it works:** AllTrails blocks all direct access (Cloudflare + Datadome captchas). This tool fetches cached pages from the Wayback Machine and parses trail stats from the `TrailStats` HTML classes and JSON-LD structured data. No browser needed — pure HTTP via curl.

**Hit rate:** ~40-60% of trails have usable Wayback snapshots. Run multiple times over days as Wayback crawls more pages. The tool tries URL variants automatically (e.g., `trail--11` suffixes AllTrails uses).

**Suspicious data detection:** If AllTrails returns a distance >3x different from ours, or elevation >5x different, it flags as "SUSPICIOUS" and skips auto-update. This prevents wrong-trail data from being applied.

#### 2. Trail Data Audit
```bash
# Audit one park
node tools/audit-trails.js zion

# Audit all parks
node tools/audit-trails.js --all
```

**What it checks:**
- Missing data (distance, elevation, time, difficulty)
- "Varies" placeholders that should be specific numbers
- Approximate `~` values that need verification
- Elevation/distance ratio sanity checks
- Missing source links (no AllTrails or NPS URL)
- Exit code 1 if any FAILs (use in CI/pre-commit)

#### 3. WebSearch fallback (for AI agents)

When the Wayback scraper returns "no data" for a trail, use WebSearch to find the AllTrails stats:

```
Search: alltrails "[trail name]" [park] distance elevation gain feet miles
```

AllTrails descriptions follow a standard format indexed by search engines:
`"This trail is X.X mi long with an elevation gain of X,XXX ft"`

### Workflow for adding a new park

1. Run `node tools/scrape-nps.js <nps-code>` to get base data from NPS API
2. Manually add insider tips, photos, unique sections, gear lists, etc.
3. For each trail with an AllTrails link, verify stats:
   - Run `node tools/scrape-alltrails.js --park <slug> --compare`
   - For trails the scraper missed, use WebSearch
4. Run `node tools/audit-trails.js <slug>` — must pass with 0 FAILs
5. Run `node tools/validate-park.js <slug>` — schema validation

## Project Structure

```
src/
  routes/
    +page.svelte              # Homepage (map + park grid)
    parks/[slug]/+page.svelte  # Park guide template (all parks use this)
  lib/
    data/
      parks-data.js            # Registry of all 63 parks (name, slug, coords, status)
      zion.json                # Complete park data
      grand-canyon.json         # Complete park data
    components/                # 15 Svelte components
    helpers/map-helpers.js     # Leaflet utilities
  app.css                      # All styles (no CSS framework)
tools/
  scrape-alltrails.js          # AllTrails data scraper (Wayback Machine)
  scrape-nps.js                # NPS API data fetcher
  validate-park.js             # Park schema validator
  audit-trails.js              # Trail data auditor
```

## Park Data Format

Each park is a JSON file in `src/lib/data/`. Key sections:
- `trails[]` — distance, elevationGain, difficulty, time, shuttleStop, tips, links
- `uniqueSections[]` — park-specific content (Narrows, Angels Landing, Shuttle, etc.)
- `insiderTips[]`, `gear{}`, `food{}`, `camping[]`, `itineraries[]`
- `seasons{}`, `photography[]`, `hiddenGems[]`, `scenicDrives[]`
- `safety{}` — hazards, wildlife, emergency contacts, practicalInfo

See existing park JSONs for the complete schema — `validate-park.js` enforces it.

## Key Conventions

- Only parks with `status: "complete"` in `parks-data.js` get prerendered
- The park page template (`parks/[slug]/+page.svelte`) handles ALL parks from JSON data
- Images use NPS.gov URLs directly (no self-hosting yet)
- Gear checklists persist to localStorage per park
- camelCase JSON keys in `practicalInfo` get formatted via `formatLabel()` for display
- Nav shows a home dot link (orange circle) on park pages for navigation back to homepage
