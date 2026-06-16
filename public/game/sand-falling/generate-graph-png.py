#!/usr/bin/env python3
"""Generate a clean, precise element interaction graph PNG using only Pillow."""
from PIL import Image, ImageDraw, ImageFont
import math

# Same dark aesthetic as the app
BG = (20, 17, 29)
PANEL = (30, 26, 43)
INK = (232, 226, 244)
INK_DIM = (154, 146, 181)
ACCENT = (255, 217, 122)
EDGE = (46, 40, 64)

# Node data (same positions scaled for higher res image)
NODES = [
    {"id": "SPARKLE", "cat": "energy", "x": 180, "y": 310, "color": (255, 217, 122)},
    {"id": "WATER", "cat": "liquid", "x": 310, "y": 470, "color": (90, 167, 232)},
    {"id": "FIRE", "cat": "energy", "x": 470, "y": 250, "color": (255, 140, 74)},
    {"id": "PLANT", "cat": "life", "x": 790, "y": 360, "color": (95, 191, 110)},
    {"id": "SHADOW", "cat": "special", "x": 250, "y": 200, "color": (111, 101, 144)},
    {"id": "STONE", "cat": "solid", "x": 600, "y": 530, "color": (160, 156, 171)},
    {"id": "DREAM", "cat": "special", "x": 690, "y": 145, "color": (195, 166, 255)},
    {"id": "CRYSTAL", "cat": "solid", "x": 750, "y": 530, "color": (142, 228, 255)},
    {"id": "MUD", "cat": "liquid", "x": 400, "y": 575, "color": (160, 122, 82)},
    {"id": "LIGHTNING", "cat": "energy", "x": 340, "y": 180, "color": (246, 242, 155)},
    {"id": "HONEY", "cat": "liquid", "x": 530, "y": 620, "color": (232, 162, 61)},
    {"id": "VOID", "cat": "energy", "x": 530, "y": 380, "color": (154, 92, 240)},
    {"id": "ICE", "cat": "solid", "x": 640, "y": 420, "color": (191, 232, 255)},
    {"id": "LAVA", "cat": "energy", "x": 420, "y": 380, "color": (255, 107, 61)},
    {"id": "SEED", "cat": "life", "x": 860, "y": 470, "color": (217, 179, 108)},
    {"id": "ASH", "cat": "solid", "x": 900, "y": 575, "color": (168, 163, 173)},
    {"id": "WOOD", "cat": "wall", "x": 945, "y": 290, "color": (138, 138, 154)},
    {"id": "CLOUD", "cat": "special", "x": 160, "y": 135, "color": (168, 197, 224)},
    {"id": "BOUNCE", "cat": "special", "x": 200, "y": 575, "color": (255, 204, 102)},
    {"id": "BIRD", "cat": "special", "x": 860, "y": 180, "color": (107, 142, 35)},
    {"id": "VINE", "cat": "life", "x": 945, "y": 405, "color": (46, 139, 87)},
    {"id": "BRICK", "cat": "wall", "x": 1000, "y": 225, "color": (192, 57, 43)},
    {"id": "SALT", "cat": "solid", "x": 250, "y": 400, "color": (238, 241, 246)},
    {"id": "SALTWATER", "cat": "liquid", "x": 290, "y": 530, "color": (95, 168, 188)},
    {"id": "FISH", "cat": "special", "x": 360, "y": 640, "color": (255, 138, 76)},
]

# Selected high-signal edges (from, to, label, major)
EDGES = [
    ("WATER", "FIRE", "extinguishes", True),
    ("FIRE", "PLANT", "ignites", True),
    ("FIRE", "WOOD", "ignites", True),
    ("LAVA", "WATER", "boils", True),
    ("LAVA", "STONE", "melts→LAVA", True),
    ("LIGHTNING", "WATER", "electrifies", True),
    ("LIGHTNING", "PLANT", "ignites", True),
    ("ICE", "WATER", "freezes", True),
    ("SALT", "WATER", "dissolves", True),
    ("SEED", "WATER", "roots", True),
    ("SEED", "MUD", "roots", True),
    ("VOID", "LAVA", "eats", False),
    ("VOID", "FIRE", "eats", False),
    ("VOID", "PLANT", "eats", False),
    ("CLOUD", "WATER", "rains", True),
    ("SPARKLE", "SHADOW", "banishes", True),
    ("LAVA", "ICE", "melts", True),
    ("LAVA", "SPARKLE", "fuses", False),
    ("ICE", "PLANT", "frosts", False),
    ("SALTWATER", "FIRE", "evaporates", False),
    ("SEED", "FIRE", "pops", True),
    ("ASH", "WATER", "→MUD", False),
    ("MUD", "WATER", "drinks", False),
    ("PLANT", "WATER", "drinks", True),
    ("VINE", "WATER", "drinks", False),
    ("BIRD", "WOOD", "perches", False),
]

W, H = 1120, 760
img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# Try to use a nice font, fall back to default
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 13)
    font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 10)
    font_tiny = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 9)
except:
    font = ImageFont.load_default()
    font_small = font
    font_tiny = font

# Title
draw.text((W//2, 22), "SAND GARDEN — PRECISE ELEMENT INTERACTION GRAPH", font=font, fill=ACCENT, anchor="mt")

# Draw edges (major first so they read clearly, labels offset perpendicular)
for major_first in (False, True):
  for a_id, b_id, label, major in EDGES:
    if (major_first and not major) or (not major_first and major): continue
    a = next(n for n in NODES if n["id"] == a_id)
    b = next(n for n in NODES if n["id"] == b_id)
    color = (255, 217, 122) if major else (95, 85, 120)
    width = 2 if major else 1

    ax, ay, bx, by = a["x"], a["y"], b["x"], b["y"]

    # gentle manual curve approximation using 3 segments (keeps it simple + pretty)
    mx = (ax + bx) / 2 + (ay - by) * 0.06
    my = (ay + by) / 2 + (bx - ax) * 0.06
    pts = [(ax, ay), (mx, my), (bx, by)]
    for i in range(len(pts) - 1):
      draw.line([pts[i], pts[i+1]], fill=color, width=width)

    # arrowhead
    ang = math.atan2(by - ay, bx - ax)
    arr_len = 8.5
    draw.polygon([
        (bx, by),
        (bx - arr_len * math.cos(ang - 0.42), by - arr_len * math.sin(ang - 0.42)),
        (bx - arr_len * math.cos(ang + 0.42), by - arr_len * math.sin(ang + 0.42)),
    ], fill=color)

    # label offset to the side of the (curved) mid point
    mx, my = pts[1]
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy) or 1
    px, py = -dy / ln, dx / ln   # perpendicular
    off = 7.5 if major else 6
    lx, ly = mx + px * off, my + py * off - 3
    draw.text((lx, ly), label, font=font_tiny, fill=(195, 185, 215))

# Draw nodes
for n in NODES:
    r = 21 if n["cat"] in ("energy",) or n["id"] in ("LAVA", "FIRE", "VOID", "LIGHTNING") else 18
    # glow ring for hubs
    if n["id"] in ("FIRE", "LAVA", "LIGHTNING", "VOID"):
        draw.ellipse([n["x"]-r-5, n["y"]-r-5, n["x"]+r+5, n["y"]+r+5], outline=(60, 50, 80), width=3)

    draw.ellipse([n["x"]-r, n["y"]-r, n["x"]+r, n["y"]+r], fill=n["color"], outline=EDGE, width=2)
    draw.text((n["x"], n["y"]), n["id"], font=font_small, fill=BG, anchor="mm")

# Legend
legend_y = 700
cats = [
    ("Energy / Reactive", (255, 140, 74)),
    ("Liquids", (90, 167, 232)),
    ("Life / Growth", (95, 191, 110)),
    ("Solids & Powders", (160, 156, 171)),
    ("Special / Volatile", (195, 166, 255)),
    ("Structures / Walls", (138, 138, 154)),
]
x = 60
for name, col in cats:
    draw.rectangle([x, legend_y, x+14, legend_y+14], fill=col, outline=EDGE)
    draw.text((x+20, legend_y+1), name, font=font_tiny, fill=INK_DIM)
    x += 170

# Footer note
draw.text((W//2, H-18), "Thick arrows = major/common reactions  •  All rules extracted from update() switch  •  Edges = void (matter drains)", 
          font=font_tiny, fill=INK_DIM, anchor="ms")

img.save("element-interactions-precise.png", "PNG")
print("Wrote element-interactions-precise.png")