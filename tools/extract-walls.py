"""Extract wall rectangles from a rendered 2D plan (walls are the thick near-black strokes).

Writes assets/model/<plan>.json: { "aspect": w/h, "rects": [[x, y, w, h], ...] } in 0..1 image units,
used by js/model3d.js to extrude the walls in WebGL.
usage: ~/tools-ai/venv/bin/python tools/extract-walls.py plan-2bhk-maid [preview.png]
"""
import json, sys
from PIL import Image

GRID = 688  # analysis width (the plan renders are 2752 px wide)
name = sys.argv[1]
im = Image.open(f'assets/img/{name}.jpg').convert('RGB')
W = GRID; H = round(im.height * GRID / im.width)
small = im.resize((W, H), Image.BOX)
px = small.load()
dark = [[False] * W for _ in range(H)]
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        dark[y][x] = max(r, g, b) < 70 and max(r, g, b) - min(r, g, b) < 30

# keep only big connected pieces (walls join into a frame; TVs, lamps and shadows are small islands)
seen = [[False] * W for _ in range(H)]
keep = [[False] * W for _ in range(H)]
for y in range(H):
    for x in range(W):
        if dark[y][x] and not seen[y][x]:
            stack, comp = [(x, y)], []
            seen[y][x] = True
            while stack:
                cx, cy = stack.pop(); comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < W and 0 <= ny < H and dark[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True; stack.append((nx, ny))
            if len(comp) > 400:
                for cx, cy in comp: keep[cy][cx] = True

# rows -> runs -> merge identical runs on consecutive rows into rectangles
open_rects = {}
rects = []
for y in range(H + 1):
    runs = set()
    if y < H:
        x = 0
        while x < W:
            if keep[y][x]:
                s = x
                while x < W and keep[y][x]: x += 1
                if x - s >= 2: runs.add((s, x))
            else:
                x += 1
    for key in list(open_rects):
        if key not in runs:
            y0 = open_rects.pop(key)
            if y - y0 >= 2 or key[1] - key[0] >= 6: rects.append((key[0], y0, key[1] - key[0], y - y0))
    for key in runs:
        open_rects.setdefault(key, y)

out = {'aspect': round(W / H, 5), 'rects': [[round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)] for x, y, w, h in rects]}
json.dump(out, open(f'assets/model/{name}.json', 'w'), separators=(',', ':'))
print(name, len(rects), 'rects')
if len(sys.argv) > 2:
    pv = Image.new('RGB', (W, H), 'white'); pp = pv.load()
    for x, y, w, h in rects:
        for yy in range(y, y + h):
            for xx in range(x, x + w): pp[xx, yy] = (20, 20, 20)
    pv.save(sys.argv[2])
