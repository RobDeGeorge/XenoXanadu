#!/usr/bin/env python3
"""
build-ink-icons.py — turn a photo of hand-drawn element symbols into the
tintable ink icons used by the Sand Garden palette.

WORKFLOW (re-run this any time you have a new/better drawing):
  1. Photograph your 5x5 sheet of symbols, drop it in as the `source` image
     (default tools/source-drawing.jpg), keeping the same element order.
  2. Tune the crop boxes:
         python3 tools/build-ink-icons.py preview
     This writes:
       tools/_ruler.png    -- the photo with a coordinate grid (read off x,y)
       tools/_preview.png  -- the extracted stamps, tinted, as they'll look
     Edit tools/ink-icons.config.json -> "boxes" until every symbol is fully
     inside its box and no printed label is included. Repeat preview.
  3. Bake them into the app (rewrites the generated INK block in index.html):
         python3 tools/build-ink-icons.py inject

Notes:
  * Only the 25 element icons are managed here. Tool icons (brush/pause/etc.)
    stay as inline SVG in index.html and are untouched.
  * Each stamp is a transparent PNG (alpha = ink). index.html renders it via a
    CSS mask with `background: currentColor`, so it tints to the element color.
  * The injected region is delimited by `>>> INK ICONS` / `<<< INK ICONS`
    markers and is fully regenerated on every `inject`, so re-running is safe.

Deps: Pillow + numpy (already present in this environment).
"""
import json, sys, os, io, base64, re
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
CFG  = os.path.join(HERE, "ink-icons.config.json")

GOLD = (255, 217, 122)
PANEL = (30, 26, 43)


def load_cfg():
    with open(CFG) as f:
        c = json.load(f)
    c["_source_path"] = os.path.join(ROOT, c["source"])
    c["_target_path"] = os.path.join(ROOT, c["target"])
    return c


def otsu(g):
    h, _ = np.histogram(g.ravel(), bins=256, range=(0, 256))
    tot = g.size; sm = np.dot(np.arange(256), h)
    sB = wB = 0.0; mx = 0.0; thr = 128
    for i in range(256):
        wB += h[i]
        if wB == 0:
            continue
        wF = tot - wB
        if wF == 0:
            break
        sB += i * h[i]
        mB = sB / wB; mF = (sm - sB) / wF
        v = wB * wF * (mB - mF) ** 2
        if v > mx:
            mx = v; thr = i
    return thr


def dilate(a, n):
    """Cheap binary-ish dilation to firm up thin/faint strokes."""
    for _ in range(n):
        p = np.pad(a, 1, mode="constant")
        a = np.maximum.reduce([
            p[1:-1, 1:-1], p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]
        ])
    return a


def stamp(gray, box, grow, thicken):
    x0, y0, x1, y1 = box
    # grow top/left/right only (never the bottom -> avoid the printed label)
    x0 = max(0, x0 - grow); y0 = max(0, y0 - grow); x1 = x1 + grow
    g = gray[y0:y1, x0:x1]
    t = otsu(g)
    ink = t - g; ink[ink < 0] = 0
    if ink.max() <= 0:
        return None
    a = (ink / ink.max()) ** 0.7
    a[a < 0.12] = 0
    if thicken:
        a = dilate(a, thicken)
    ys = np.where(a.max(axis=1) > 0.12)[0]
    xs = np.where(a.max(axis=0) > 0.12)[0]
    if len(ys) == 0 or len(xs) == 0:
        return None
    m = 3
    a = a[max(0, ys[0]-m):min(a.shape[0], ys[-1]+1+m),
          max(0, xs[0]-m):min(a.shape[1], xs[-1]+1+m)]
    return a


def to_png_alpha(a, cap):
    img = Image.fromarray((a * 255).astype(np.uint8), mode="L")
    sc = min(1.0, cap / max(img.size))
    if sc < 1.0:
        img = img.resize((max(1, int(img.width*sc)), max(1, int(img.height*sc))), Image.LANCZOS)
    rgba = Image.new("RGBA", img.size, (255, 255, 255, 0))
    rgba.putalpha(img)
    return rgba


def font(sz=13):
    for p in ("/usr/share/fonts/TTF/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def cmd_preview(c):
    im = Image.open(c["_source_path"]).convert("RGB")
    gray = np.asarray(im.convert("L")).astype(np.float32)

    # ruler overlay
    ru = im.copy(); d = ImageDraw.Draw(ru); W, H = ru.size
    for x in range(0, W, 50):
        d.line([(x, 0), (x, H)], fill=(255, 0, 0), width=1); d.text((x+1, 1), str(x), fill=(255, 0, 0))
    for y in range(0, H, 50):
        d.line([(0, y), (W, y)], fill=(0, 160, 255), width=1); d.text((1, y+1), str(y), fill=(0, 160, 255))
    for name, b in c["boxes"].items():
        d.rectangle(b, outline=(0, 255, 0), width=2)
    ru.save(os.path.join(HERE, "_ruler.png"))

    # tinted contact sheet
    order = c["order"]; cols = 5; cell = 150; pad = 14; lab = 20
    rows = (len(order) + cols - 1) // cols
    sheet = Image.new("RGB", (cols*cell, rows*(cell+lab)), PANEL)
    dr = ImageDraw.Draw(sheet); fnt = font()
    for k, name in enumerate(order):
        cx = (k % cols)*cell; cy = (k//cols)*(cell+lab)
        a = stamp(gray, c["boxes"][name], c["grow"], c["thicken"])
        if a is not None:
            rgba = to_png_alpha(a, c["cap"]); iw, ih = rgba.size
            boxpx = cell - 2*pad; sc = min(boxpx/iw, boxpx/ih)
            nw, nh = max(1, int(iw*sc)), max(1, int(ih*sc))
            rgba = rgba.resize((nw, nh), Image.LANCZOS)
            col = Image.new("RGBA", (nw, nh), GOLD + (0,)); col.putalpha(rgba.getchannel("A"))
            sheet.paste(col, (cx+(cell-nw)//2, cy+(cell-nh)//2), col)
        dr.text((cx+cell/2, cy+cell+3), name, fill=(200, 200, 200), font=fnt, anchor="ma")
    sheet.save(os.path.join(HERE, "_preview.png"))
    print("wrote tools/_ruler.png and tools/_preview.png")


def cmd_inject(c):
    im = Image.open(c["_source_path"]).convert("RGB")
    gray = np.asarray(im.convert("L")).astype(np.float32)
    ink = {}
    for name in c["order"]:
        a = stamp(gray, c["boxes"][name], c["grow"], c["thicken"])
        if a is None:
            raise SystemExit(f"no ink found for '{name}' — check its box")
        buf = io.BytesIO(); to_png_alpha(a, c["cap"]).save(buf, format="PNG", optimize=True)
        ink[name] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    kb = sum(len(v) for v in ink.values()) // 1024
    print(f"generated {len(ink)} stamps (~{kb}KB base64)")

    html = open(c["_target_path"]).read()
    lines = ",\n".join(f'  {n}: "{ink[n]}"' for n in c["order"])
    block = (
        "\n// >>> INK ICONS — generated by tools/build-ink-icons.py (do not edit by hand) >>>\n"
        "// Re-run after changing the drawing/config:  python3 tools/build-ink-icons.py inject\n"
        f"const INK = {{\n{lines}\n}};\n"
        "const inkIcon = uri =>\n"
        '  `<span class="inkicon" style="-webkit-mask-image:url(${uri});mask-image:url(${uri})"></span>`;\n'
        "// <<< INK ICONS <<<\n\n"
    )
    # Replace everything between the svgIcon helper and `const ICONS = {`.
    # This regenerates the INK block in place and also absorbs any earlier
    # hand-inserted version, so re-running is always safe.
    anchor = "${body}</svg>`;\n"
    li = html.index(anchor) + len(anchor)
    ci = html.index("const ICONS = {")
    html = html[:li] + block + html[ci:]
    open(c["_target_path"], "w").write(html)
    print(f"updated {c['target']}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "help"
    c = load_cfg()
    if mode == "preview":
        cmd_preview(c)
    elif mode == "inject":
        cmd_inject(c)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
