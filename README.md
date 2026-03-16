# XenoXanadu

Personal field guides for all 63 US national parks. Built one park at a time.

**Live:** [xenoxanadu.com](https://xenoxanadu.com)

## Status

- 2 / 63 parks complete (Zion, Grand Canyon)
- 61 coming soon

## Stack

Static HTML/CSS/JS. No frameworks, no build step. Open `index.html` in a browser.

## Structure

```
index.html          Landing page with US map + park grid
parks/              One HTML file per park
shared/             CSS, JS, fonts shared across all pages
data/               Structured JSON data per park
tools/              Agent tooling for building new parks
```

## Adding a New Park

See `tools/AGENT-GUIDE.md` for the full workflow.
