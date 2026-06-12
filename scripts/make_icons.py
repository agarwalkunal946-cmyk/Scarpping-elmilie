import os
import struct
import zlib


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
SCALE = 4


def blend(dst, src):
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    a = sa / 255
    out_a = sa + da * (1 - a)
    if out_a == 0:
        return (0, 0, 0, 0)
    return (
        int(sr * a + dr * (1 - a)),
        int(sg * a + dg * (1 - a)),
        int(sb * a + db * (1 - a)),
        int(out_a),
    )


def set_px(img, w, h, x, y, color):
    if 0 <= x < w and 0 <= y < h:
        idx = (y * w + x) * 4
        img[idx:idx + 4] = bytes(blend(tuple(img[idx:idx + 4]), color))


def rect(img, w, h, x0, y0, x1, y1, color):
    for y in range(max(0, y0), min(h, y1)):
        for x in range(max(0, x0), min(w, x1)):
            set_px(img, w, h, x, y, color)


def rounded_rect(img, w, h, x0, y0, x1, y1, radius, color):
    r2 = radius * radius
    for y in range(max(0, y0), min(h, y1)):
        for x in range(max(0, x0), min(w, x1)):
            cx = x0 + radius if x < x0 + radius else x1 - radius - 1 if x >= x1 - radius else x
            cy = y0 + radius if y < y0 + radius else y1 - radius - 1 if y >= y1 - radius else y
            if (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2:
                set_px(img, w, h, x, y, color)


def gradient_rounded_rect(img, w, h, x0, y0, x1, y1, radius):
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0)
        color = (
            int(8 * (1 - t) + 18 * t),
            int(104 * (1 - t) + 160 * t),
            int(142 * (1 - t) + 118 * t),
            255,
        )
        rounded_rect(img, w, h, x0, y, x1, y + 1, radius, color)


def line(img, w, h, x0, y0, x1, y1, thickness, color):
    dx = x1 - x0
    dy = y1 - y0
    steps = max(abs(dx), abs(dy), 1)
    for i in range(steps + 1):
        x = int(x0 + dx * i / steps)
        y = int(y0 + dy * i / steps)
        rect(img, w, h, x - thickness, y - thickness, x + thickness + 1, y + thickness + 1, color)


def downsample(img, w, h, scale):
    out_w = w // scale
    out_h = h // scale
    out = bytearray(out_w * out_h * 4)
    area = scale * scale
    for y in range(out_h):
      for x in range(out_w):
        sums = [0, 0, 0, 0]
        for yy in range(scale):
          for xx in range(scale):
            idx = ((y * scale + yy) * w + (x * scale + xx)) * 4
            for c in range(4):
              sums[c] += img[idx + c]
        out_idx = (y * out_w + x) * 4
        out[out_idx:out_idx + 4] = bytes(int(v / area) for v in sums)
    return out, out_w, out_h


def write_png(path, img, w, h):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        row = img[y * w * 4:(y + 1) * w * 4]
        raw.extend(row)

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)


def make_icon(size):
    w = h = size * SCALE
    img = bytearray(w * h * 4)
    u = size * SCALE / 32

    def p(value):
        return int(round(value * u))

    gradient_rounded_rect(img, w, h, p(1), p(1), p(31), p(31), p(6))

    white = (255, 255, 255, 235)
    soft = (255, 255, 255, 95)
    gold = (247, 180, 61, 255)
    navy = (21, 42, 66, 255)

    # Report sheet.
    rounded_rect(img, w, h, p(5), p(5), p(23), p(25), p(3), white)
    rect(img, w, h, p(8), p(9), p(20), p(11), navy)
    rect(img, w, h, p(8), p(14), p(20), p(16), soft)
    rect(img, w, h, p(8), p(19), p(17), p(21), soft)

    # Export arrow.
    line(img, w, h, p(22), p(18), p(29), p(18), max(1, p(0.8)), gold)
    line(img, w, h, p(26), p(14), p(30), p(18), max(1, p(0.8)), gold)
    line(img, w, h, p(26), p(22), p(30), p(18), max(1, p(0.8)), gold)

    # Small globe/export arc.
    line(img, w, h, p(7), p(28), p(25), p(28), max(1, p(0.6)), (255, 255, 255, 150))

    final, out_w, out_h = downsample(img, w, h, SCALE)
    path = os.path.join(ASSETS, f"icon{size}.png")
    write_png(path, final, out_w, out_h)


def main():
    os.makedirs(ASSETS, exist_ok=True)
    for size in (16, 32, 48, 128):
        make_icon(size)


if __name__ == "__main__":
    main()
