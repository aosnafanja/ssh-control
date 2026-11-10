import struct, zlib, math

SIZE = 1024
R = 230  # corner radius

# ---- background gradient (rounded rect) ----
def rounded_rect_pixel(x, y):
    cx = min(max(x, R), SIZE - 1 - R)
    cy = min(max(y, R), SIZE - 1 - R)
    dx = x - cx
    dy = y - cy
    if dx * dx + dy * dy > R * R:
        return None
    return (x + y) / (2 * SIZE)  # gradient t in [0,1]

C0 = (0x0A, 0x84, 0xFF)   # #0A84FF
C1 = (0x5E, 0x5C, 0xE6)   # #5E5CE6

# ---- key glyph primitives (24-box coords) ----
# ring
RING = (7.5, 15.5, 5.5)
# shaft line
SHAFT = (21.0, 2.0, 11.4, 11.6)
# teeth polyline
TEETH = [(15.5, 7.5), (18.5, 10.5), (22.0, 7.0), (19.0, 4.0)]

SCALE = 22.0
STROKE = 1.7
CX = 512.0
CY = 512.0

def tx(gx, gy):
    return CX + (gx - 12.0) * SCALE, CY + (gy - 12.0) * SCALE

def dist_seg(px, py, x0, y0, x1, y1):
    dx = x1 - x0
    dy = y1 - y0
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return math.hypot(px - x0, py - y0)
    t = max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / l2))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))

# rasterize to coverage map (white)
cov = [[0.0] * SIZE for _ in range(SIZE)]

def stamp_circle(cx, cy, r):
    w = STROKE * SCALE / 2.0
    x0 = int(cx - r * SCALE - w) - 1; x1 = int(cx + r * SCALE + w) + 1
    y0 = int(cy - r * SCALE - w) - 1; y1 = int(cy + r * SCALE + w) + 1
    for y in range(max(0, y0), min(SIZE, y1 + 1)):
        for x in range(max(0, x0), min(SIZE, x1 + 1)):
            d = abs(math.hypot(x - cx, y - cy) - r * SCALE)
            a = w - d
            if a > 0:
                if a > 1: a = 1.0
                cov[y][x] = max(cov[y][x], a)

def stamp_line(x0, y0, x1, y1):
    w = STROKE * SCALE / 2.0
    x0s, y0s = tx(x0, y0)
    x1s, y1s = tx(x1, y1)
    bx0 = int(min(x0s, x1s) - w) - 1; bx1 = int(max(x0s, x1s) + w) + 1
    by0 = int(min(y0s, y1s) - w) - 1; by1 = int(max(y0s, y1s) + w) + 1
    for y in range(max(0, by0), min(SIZE, by1 + 1)):
        for x in range(max(0, bx0), min(SIZE, bx1 + 1)):
            d = dist_seg(x, y, x0s, y0s, x1s, y1s)
            a = w - d
            if a > 0:
                if a > 1: a = 1.0
                cov[y][x] = max(cov[y][x], a)

stamp_circle(*tx(*RING[:2]), RING[2])
stamp_line(*SHAFT)
for i in range(len(TEETH) - 1):
    stamp_line(TEETH[i][0], TEETH[i][1], TEETH[i + 1][0], TEETH[i + 1][1])

# ---- write PNG ----
raw = bytearray()
for y in range(SIZE):
    raw.append(0)  # filter type 0
    for x in range(SIZE):
        t = rounded_rect_pixel(x, y)
        if t is None:
            r = g = b = a = 0
        else:
            r = int(C0[0] + (C1[0] - C0[0]) * t)
            g = int(C0[1] + (C1[1] - C0[1]) * t)
            b = int(C0[2] + (C1[2] - C0[2]) * t)
            a = 255
            cv = cov[y][x]
            if cv > 0:
                r = int(r + (255 - r) * cv)
                g = int(g + (255 - g) * cv)
                b = int(b + (255 - b) * cv)
        raw += bytes((r, g, b, a))

def chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")

with open("/Users/aleksey/Desktop/LLM projects/My/SSH control/build/icon_1024.png", "wb") as f:
    f.write(png)
print("done", len(png), "bytes")
