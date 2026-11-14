"""Convert a screenshot PNG to a JPEG in the 300-350 KB band.

Binary-searches the quality (4:4:4 chroma, no subsampling, so flat UI areas
stay crisp) until the file lands in band, or settles on the closest quality
when the band cannot be reached. Prints the final size and quality.

Usage: python3 tojpeg.py <input.png> <output.jpg>
"""
import sys
from PIL import Image

LOW, HIGH = 300_000, 350_000


def encode(img, quality):
    import io

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, subsampling=0, optimize=True)
    return buf.getvalue()


def main():
    src, dst = sys.argv[1], sys.argv[2]
    img = Image.open(src).convert("RGB")
    lo, hi = 60, 96
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        data = encode(img, mid)
        if len(data) < LOW:
            best = (mid, data)
            lo = mid + 1
        elif len(data) > HIGH:
            hi = mid - 1
        else:
            best = (mid, data)
            break
    if best is None:
        # Nothing in band: take the largest under the cap, or the smallest over.
        under = encode(img, hi) if hi >= 60 else None
        over = encode(img, lo) if lo <= 96 else None
        if under is not None and len(under) <= HIGH:
            best = (hi, under)
        else:
            best = (lo, over)
    quality, data = best
    with open(dst, "wb") as fh:
        fh.write(data)
    print(f"{dst}: {len(data)} bytes at quality {quality}")


if __name__ == "__main__":
    main()
