"""Crop rentrée product photos into a square cadre that fills the card."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "storefront" / "public" / "img" / "materiel" / "rentree"
SKIP_DIRS = {"_preview"}
OUT_SIZE = 1200
PAD_RATIO = 0.08
THRESH = 24


def bg_color(im: Image.Image) -> tuple[int, int, int]:
    w, h = im.size
    pts = [
        (8, 8),
        (w - 9, 8),
        (8, h - 9),
        (w - 9, h - 9),
        (w // 2, 8),
        (w // 2, h - 9),
        (8, h // 2),
        (w - 9, h // 2),
    ]
    acc = [0, 0, 0]
    for x, y in pts:
        p = im.getpixel((min(max(x, 0), w - 1), min(max(y, 0), h - 1)))[:3]
        for i in range(3):
            acc[i] += p[i]
    n = len(pts)
    return tuple(c // n for c in acc)  # type: ignore[return-value]


def product_box(im: Image.Image) -> tuple[tuple[int, int, int], tuple[int, int, int, int]]:
    rgb = im.convert("RGB")
    w, h = rgb.size
    bg = bg_color(rgb)
    px = rgb.load()
    margin = max(6, min(w, h) // 80)
    minx, miny, maxx, maxy = w, h, 0, 0
    step = max(1, min(w, h) // 420)
    found = 0
    for y in range(margin, h - margin, step):
        for x in range(margin, w - margin, step):
            p = px[x, y]
            if max(abs(p[i] - bg[i]) for i in range(3)) > THRESH:
                found += 1
                if x < minx:
                    minx = x
                if y < miny:
                    miny = y
                if x > maxx:
                    maxx = x
                if y > maxy:
                    maxy = y
    if found < 80:
        return bg, (0, 0, w, h)
    return bg, (minx, miny, min(w, maxx + step), min(h, maxy + step))


def product_box_full(im: Image.Image, thresh: int = 8) -> tuple[int, int, int, int]:
    """Pixel-accurate bbox for white-studio group shots (no step sampling)."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    minx, miny, maxx, maxy = w, h, 0, 0
    bg = bg_color(rgb)
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if max(abs(p[i] - bg[i]) for i in range(3)) > thresh:
                if x < minx:
                    minx = x
                if y < miny:
                    miny = y
                if x > maxx:
                    maxx = x
                if y > maxy:
                    maxy = y
    if maxx <= minx:
        return (0, 0, w, h)
    return (minx, miny, maxx + 1, maxy + 1)


def fit_centered_wide(im: Image.Image, pad_ratio: float = 0.07) -> Image.Image:
    """Keep a wide product set fully visible and centered in a square."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    x0, y0, x1, y1 = product_box_full(rgb)
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    pad = max(48, int(pad_ratio * max(bw, bh)))
    side = max(bw, bh) + 2 * pad
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    ox = int(round(side / 2 - cx))
    oy = int(round(side / 2 - cy))
    canvas.paste(rgb, (ox, oy))
    out_size = min(OUT_SIZE, max(side, int(max(w, h) * 1.15)))
    if canvas.size[0] != out_size:
        canvas = canvas.resize((out_size, out_size), Image.Resampling.LANCZOS)
    return canvas


def fit_square(im: Image.Image) -> Image.Image:
    rgb = im.convert("RGB")
    w, h = rgb.size
    bg, (x0, y0, x1, y1) = product_box(rgb)
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    fill = (bw * bh) / (w * h)
    if w == h and fill >= 0.52:
        if w > OUT_SIZE:
            return rgb.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)
        return rgb

    pad = int(round(PAD_RATIO * max(bw, bh)))
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    side = max(x1 - x0, y1 - y0, 1)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left = int(round(cx - side / 2))
    top = int(round(cy - side / 2))
    canvas = Image.new("RGB", (side, side), bg)
    src = (max(0, left), max(0, top), min(w, left + side), min(h, top + side))
    canvas.paste(rgb.crop(src), (src[0] - left, src[1] - top))
    native_cap = min(OUT_SIZE, max(side, int(max(w, h) * 1.15)))
    out_size = min(OUT_SIZE, native_cap)
    if canvas.size[0] != out_size:
        canvas = canvas.resize((out_size, out_size), Image.Resampling.LANCZOS)
    return canvas


def save_image(im: Image.Image, dest: Path) -> None:
    ext = dest.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        im.save(dest, quality=90, optimize=True)
    elif ext == ".png":
        im.save(dest, optimize=True)
    else:
        im.save(dest)


def main() -> int:
    if not DEST.exists():
        print("missing", DEST, file=sys.stderr)
        return 1
    count = 0
    for path in sorted(DEST.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        src = Image.open(path)
        if path.name == "pack-enfant.jpg":
            out = fit_centered_wide(src)
        else:
            out = fit_square(src)
        save_image(out, path)
        print(f"cadre {path.relative_to(DEST)}  {src.size} -> {out.size}")
        count += 1
    print("ok", count, "photos")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
