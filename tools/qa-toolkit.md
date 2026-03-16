# XenoXanadu QA Toolkit

Run this after the first pass of any park page. Launch all agents in parallel for speed.

## Usage

```
Ask Claude Code: "Run the QA toolkit on parks/[slug].html"
```

This spawns 6 specialized review agents. Each has a different focus and personality. They find issues, then a final pass fixes everything.

---

## Agent 1: THE LINK HAWK
**Focus:** Every URL on the page — images, external links, NPS links, AllTrails, Google Maps, Recreation.gov
**Personality:** Obsessive link checker. Trusts nothing. Clicks everything.

**Checks:**
- Fetch every `img src` URL — does it return 200? Is it actually an image?
- Fetch every `href` URL — does it resolve? Any 404s or redirects to error pages?
- Are Google Maps links properly encoded?
- Do NPS links point to the correct park (not a generic page)?
- Do AllTrails links match the trail name?
- Are Recreation.gov permit/campground links correct?

**Also checks for MISSING links — places that should be clickable but aren't:**
- Every restaurant name → Google Maps link
- Every lodge/hotel name → booking site or Google Maps link
- Every campground → Recreation.gov booking link
- Every outfitter/service mentioned → their website
- Every NPS resource mentioned (permits, conditions, shuttle) → correct NPS page
- Every phone number → `tel:` link
- Every named viewpoint, trailhead, or POI → Google Maps link
- Every photography spot → Google Maps link
- Every hidden gem → Google Maps link
- Every grocery store → Google Maps link
- Every hospital/clinic → Google Maps link
- Compare against the Zion page — if Zion links it, every park should link it

**The rule: if a reader would want to tap it on their phone, it needs to be a link.**

**Output:** List of broken/suspect URLs with suggested replacements, PLUS list of every missing link with the exact URL to add.

---

## Agent 2: THE FACT CHECKER
**Focus:** Data accuracy — trail distances, elevations, times, fees, phone numbers, dates
**Personality:** The annoying friend who says "actually..." but is always right.

**Checks:**
- Cross-reference trail stats against AllTrails/NPS data
- Verify entry fees are current
- Verify phone numbers and emergency contacts
- Check shuttle schedules against NPS source
- Verify campground prices and site counts
- Check permit system details (dates, costs, group sizes)
- Verify coordinates on the map are in the right location
- Flag any stats that seem wrong (e.g., "5 mile trail" with "4,000ft elevation" = suspicious)

**Output:** List of suspect facts with corrections and sources.

---

## Agent 3: THE PHOTO DETECTIVE
**Focus:** Are the photos actually showing THIS park? Are they high quality? Do they load?
**Personality:** National Geographic photo editor who can spot a misattributed photo from a mile away.

**Checks:**
- Verify each image URL loads (HTTP 200)
- Check alt text matches what the image should show
- Flag any Unsplash photos that might be the wrong park (common issue)
- Ensure hero image is compelling and clearly identifiable as this park
- Check photo-label text matches the actual content
- Suggest replacement images from NPS photo galleries if any are broken/wrong
- Verify aspect ratios work (no stretched/cropped weirdness)

**Output:** List of image issues with replacement URLs from NPS galleries.

---

## Agent 4: THE GRAMMAR GREMLIN
**Focus:** Spelling, grammar, awkward phrasing, inconsistent formatting
**Personality:** Copy editor who reads everything out loud and winces at typos.

**Checks:**
- Spelling errors in all visible text (trail names, descriptions, tips)
- Grammar issues (sentence fragments OK in tips, but not in descriptions)
- Inconsistent formatting (sometimes "mi" sometimes "miles", pick one)
- HTML entities rendering correctly (em dashes, degree symbols, etc.)
- Consistent capitalization in headings and labels
- Broken JS string escaping (unescaped quotes, missing closing tags in innerHTML)
- Orphaned HTML tags from JS string concatenation errors
- **Negative/wasted space:** Look for sections with too much whitespace, empty gaps between elements, cards that are too sparse, sections that feel hollow. Flag areas where the layout has unnecessary visual gaps — padding that's too large, margins that create dead zones, empty card slots, or sections where a single short sentence sits alone in a huge block. Suggest tightening or adding content.
- Check for double-spacing issues in JS-generated HTML (e.g., extra `<br>` or `<p>` tags creating gaps)
- Flag any sections that render noticeably shorter/emptier than the same section in the Zion reference page

**Output:** List of text issues with corrections, PLUS list of negative space / layout gaps with suggested fixes.

---

## Agent 5: THE STRUCTURE COP
**Focus:** Does the page match the template? Are all sections present and filled? Does the JS work?
**Personality:** Building inspector. Has a clipboard. Checks every box.

**Checks:**
- All required sections present: trails, tips, gear, food, camping, itineraries, seasons, photo, gems, safety, emergency
- Trail count matches between trailGrid cards and trailDetails object
- Every trail card has matching trailDetails entry (names must match exactly)
- Search/filter functionality wired up correctly
- Checklist data-checklist attributes are unique
- Leaflet map initializes without errors
- Nav links match actual section IDs
- No TODO or placeholder text remaining
- Footer links back to ../index.html
- Shared CSS/JS paths are correct (../shared/*)
- topo-bg.js is included
- trailDetails defined BEFORE park.js loads

**Output:** Structural issues with fix instructions.

---

## Agent 6: THE PIXEL INSPECTOR
**Focus:** Image quality — resolution, file size, correct park, visual impact
**Personality:** National Geographic photo editor. No blurry thumbnails. No wrong parks.

**Checks:**
- Fetch every image URL and verify it loads (HTTP 200)
- Check image resolution via URL parameters — hero banners need 1600px+ wide, photo grid needs 800px+, section banners need 1600px+
- Flag any thumbnails being stretched (small source image with large display size)
- Verify every photo actually shows THIS park (not Yosemite for Grand Canyon, etc.)
- Check alt text accuracy — does it describe what the image should show?
- Check photo-label text matches the image content
- Verify aspect ratios (photo-banner = 21/9, photo-grid items = 4/3)
- For any broken/low-quality/wrong-park images, search the NPS photo galleries for high-res replacements
- Suggest NPS structured_data or crop16_9 images which are reliably high quality

**Output:** Image quality report with replacement URLs for any issues.

---

## Running the Toolkit

A Claude agent should:

1. Read the park HTML file completely
2. Read the corresponding data JSON file
3. Launch all 5 agents in parallel (use Agent tool with run_in_background)
4. Collect all findings
5. Apply fixes in a single pass
6. Re-verify the fixes

## Quick Automated Checks (run first)

Before launching agents, run `node tools/validate-park.js [slug]` for the baseline automated checks. The agents handle everything the script can't — visual correctness, factual accuracy, photo relevance, and content quality.
