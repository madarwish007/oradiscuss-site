#!/usr/bin/env python3
"""
REMAP THE RETIRED RED TO WARM AMBER IN A HAND-MADE COVER, IN PLACE.

Some article covers are bespoke PNGs with no SVG or generator source (parchment
"DBA Field Notes" scenes, technical diagram covers). Recolouring them for the
Instrument Amber rebrand cannot go through a generator, and recreating the art
from scratch would lose the founder's hand-drawn illustration. So this shifts
ONLY the retired-red pixels to warm amber/gold and leaves every other pixel of
the drawing untouched: the purest "identity only" recolour.

HOW. Each pixel is converted to HSV. Greys, paper and near-blacks (low
saturation or low value) are left alone. A coloured pixel's distance from pure
red decides a feather weight: full shift inside the red band, ramping to zero by
45 degrees out, so anti-aliased edges transition smoothly instead of leaving a
red fringe. Shifted pixels rotate their hue by +33 degrees (red -> gold/amber),
which clears the brand guard's 20-degree red band by a comfortable margin, and
their value is nudged down slightly so the amber reads on a cream ground. Hue
rotation preserves the drawing's internal shading rather than flattening it to
one colour.

This is the exact transform used on 15 Aug 2026 for the four light covers
(oradiscuss-db-19-28-to-19-30-cover[.|-1920x764], cover-part3,
oradiscuss-zdt-oms-24108-cover-1920x764). Verify the result with
scripts/brand/check-brand-red.py (expect red_family_pixels == 0) and by eye.

  python3 scripts/brand/remap-cover-red.py IMAGE [IMAGE...]

The dark cartoon covers are NOT remapped this way: they are regenerated from
scripts/local-covers.mjs with a gold palette, because they have a source.
"""

import colorsys
import sys

from PIL import Image

SHIFT_DEGREES = 33.0     # red -> gold/amber; clears the 20-degree guard band
BAND_FULL = 18.0         # full shift within this many degrees of pure red
BAND_EDGE = 45.0         # feather ramps to zero by here
MIN_SAT = 0.22           # below this is paper/grey, left untouched
MIN_VAL = 0.15           # below this is near-black, left untouched
VALUE_DROP = 0.12        # slight darken of shifted pixels, for contrast on cream


def dist_from_red(hue_deg):
    return min(hue_deg, 360.0 - hue_deg)


def remap_pixel(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    if s < MIN_SAT or v < MIN_VAL:
        return (r, g, b)
    d = dist_from_red(h * 360.0)
    if d <= BAND_FULL:
        w = 1.0
    elif d >= BAND_EDGE:
        return (r, g, b)
    else:
        w = (BAND_EDGE - d) / (BAND_EDGE - BAND_FULL)
    nh = ((h * 360.0 + SHIFT_DEGREES * w) % 360.0) / 360.0
    nv = v * (1.0 - VALUE_DROP * w)
    nr, ng, nb = colorsys.hsv_to_rgb(nh, s, nv)
    return (round(nr * 255), round(ng * 255), round(nb * 255))


def remap_file(path):
    im = Image.open(path).convert('RGB')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            px[x, y] = remap_pixel(*px[x, y])
    im.save(path)
    return im.size


def main(argv):
    if not argv:
        raise SystemExit('usage: remap-cover-red.py IMAGE [IMAGE...]')
    for path in argv:
        size = remap_file(path)
        sys.stdout.write('remapped %s %dx%d\n' % (path, size[0], size[1]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
