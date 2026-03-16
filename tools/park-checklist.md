# Adding a New Park: [PARK NAME]

> Copy this file for each new park. Replace [PARK NAME] with the actual park name.
> Work through each phase in order. Do not skip to the next phase until all items in the current phase are checked.

## Phase 1: Data Collection

- [ ] Run `node tools/scrape-nps.js [park-code]` to pull NPS data
- [ ] Review raw data in `data/[slug].json` for accuracy
- [ ] Cross-reference NPS data with other sources (AllTrails, Reddit, YouTube)
- [ ] Research park-specific unique features (what makes this park unlike any other?)
- [ ] Identify 2-3 unique sections this park needs (e.g., Narrows deep-dive for Zion)
- [ ] Gather hero image URL (prefer NPS-hosted images)
- [ ] Verify park coordinates, NPS code, and basic stats

## Phase 2: Page Generation

- [ ] Run `node tools/generate-park.js [slug]` to create starter page
- [ ] Verify `parks/[slug].html` was created
- [ ] Open page in browser and confirm it loads without errors
- [ ] Confirm shared CSS/JS files are linking correctly

## Phase 3: Content Curation

### Trails
- [ ] Review and rewrite every trail description (no generic NPS copy)
- [ ] Add at least 2 insider tips per trail (best time, parking, what to skip, etc.)
- [ ] Verify distance, elevation, time, and difficulty for each trail
- [ ] Add permit info where applicable
- [ ] Add shuttle stop / access info for each trail
- [ ] Add trailhead coordinates for map markers

### Park-Specific Unique Sections
- [ ] Add unique section 1: _________________________ (title)
- [ ] Add unique section 2: _________________________ (title)
- [ ] Add unique section 3: _________________________ (title, if applicable)
- [ ] Add nav links for unique sections
- [ ] Each unique section has deep, actionable content (not just a paragraph)

### Food & Dining
- [ ] Add 4-6 specific restaurant recommendations near the park
- [ ] Include what to order, price range, hours if known
- [ ] Add in-park dining options (lodges, cafes, general stores)
- [ ] Add lodging recommendations (budget to splurge)
- [ ] Add grocery / supply stores with locations

### Photography
- [ ] Add 6-10 photography locations
- [ ] Each has: specific location, best time of day, best season
- [ ] Include composition tips or what lens to bring
- [ ] Note crowd levels at each spot

### Hidden Gems
- [ ] Add 4-8 lesser-known spots, trails, or experiences
- [ ] None of these should be in typical "top 10" lists for the park

### Itineraries
- [ ] Half-day / 1-day itinerary with hour-by-hour timing
- [ ] 2-day itinerary with day-by-day breakdown
- [ ] 3+ day itinerary for thorough exploration
- [ ] All include drive times between stops
- [ ] All have realistic timing (account for parking, crowds, breaks)

### Interactive Map
- [ ] Add key POI markers with accurate coordinates
- [ ] Include trailheads, visitor centers, campgrounds, viewpoints
- [ ] Each marker has a descriptive popup

### Gear
- [ ] Always-bring list reviewed (basics are pre-filled)
- [ ] Seasonal gear specific to this park added
- [ ] Park-specific gear items added (e.g., neoprene socks for water hikes)
- [ ] Gear notes paragraph written

### Seasons / When to Visit
- [ ] Best time to visit identified with reasoning
- [ ] Worst time identified with reasoning
- [ ] Season-by-season breakdown (weather, crowds, closures, activities)

### Safety
- [ ] All park-specific hazards documented
- [ ] Each hazard has actionable advice (what to do, not just what to avoid)
- [ ] Emergency contacts filled in (dispatch, visitor center, nearest hospital)

### Common Mistakes
- [ ] 6-10 park-specific mistakes first-timers make
- [ ] Each explains what to do instead

### Other Sections
- [ ] Transportation / shuttle info filled in
- [ ] Insider tips section has 8-12 actionable tips
- [ ] Scenic drives documented (if applicable)
- [ ] Offline maps section has specific app/download recommendations
- [ ] Maps & links section has all relevant official URLs
- [ ] Camping section has all campgrounds with fees, seasons, booking links
- [ ] Dispersed/BLM camping options documented

## Phase 4: Validation

- [ ] Run `node tools/validate-park.js [slug]` -- fix ALL issues
- [ ] Validator exits with code 0
- [ ] All required sections present and filled (no TODOs remain)
- [ ] All external links working (spot-check at least 5)
- [ ] Images loading correctly
- [ ] Test in browser (desktop) -- all sections render, nav works, map loads
- [ ] Test in browser (mobile) -- nav collapses, cards stack, text readable

## Phase 5: Integration

- [ ] Update `shared/parks-data.js` status from `"coming-soon"` to `"complete"`
- [ ] Verify park appears correctly on landing page map
- [ ] Verify park card links work on landing page
- [ ] Commit all changes:
  - `parks/[slug].html`
  - `data/[slug].json`
  - `shared/parks-data.js`
- [ ] Commit message: `feat: add [Park Name] field guide`

---

## Notes

_Use this space to track park-specific decisions, open questions, or items to revisit._

-
-
-
