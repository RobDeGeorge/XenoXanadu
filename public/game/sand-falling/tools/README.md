# Ink icons pipeline

Turns a **photo of hand-drawn element symbols** into the tintable palette icons
in `index.html`. Re-runnable — redraw whenever you want nicer designs.

## Files
- `source-drawing.jpg` — the photo of your 5×5 symbol sheet (replace to redesign).
- `ink-icons.config.json` — crop boxes + options (the thing you tune).
- `build-ink-icons.py` — the tool (Pillow + numpy).

## Workflow
1. **Shoot** the 5×5 sheet, same element order as `config.json`'s `order`.
   Tips for a clean capture: flat, even light, dark pen, leave space between
   each symbol and its label. Save over `tools/source-drawing.jpg`
   (or point `source` at a new file).

2. **Tune the boxes:**
   ```
   python3 tools/build-ink-icons.py preview
   ```
   Writes `tools/_ruler.png` (photo + coordinate grid + current boxes drawn in
   green) and `tools/_preview.png` (extracted stamps, tinted, as they'll look).
   Edit `"boxes"` in the config — each is `[x0,y0,x1,y1]` in source pixels — until
   every symbol sits fully inside its box and **no printed label is included**.
   Repeat until the preview looks right.

3. **Bake into the app:**
   ```
   python3 tools/build-ink-icons.py inject
   ```
   Regenerates the `// >>> INK ICONS … <<<` block in `index.html`. Safe to
   re-run; it replaces the previous block.

## How it renders
Each stamp is a transparent PNG (alpha = ink), inlined as base64 and drawn with a
CSS mask over `background: currentColor`, so it tints to each element's color.
Only the 25 element icons are managed here; tool icons (brush/pause/…) stay as
inline SVG in `index.html`.

## Config knobs
- `cap` — max stamp size in px (default 88).
- `grow` — pads every box on top/left/right (never bottom, to avoid labels).
- `thicken` — dilate strokes N px to firm up faint/thin pen (default 0; try 1).
