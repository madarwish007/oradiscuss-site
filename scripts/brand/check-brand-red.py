#!/usr/bin/env python3
"""
NO ORACLE RED IN A BRAND ASSET, MEASURED IN THE PIXELS.

Oracle red #C74634 is dropped entirely. That is a closed founder decision,
re-confirmed 8 Aug 2026: PRODUCT.md names Oracle's own marketing as an
anti-reference and the Terms disclaim affiliation, so borrowing Oracle's red
contradicts both.

WHY PIXELS AND NOT A HEX SEARCH. A stylesheet can be corrected while a red
asset stays on disk, and a hex search only ever finds the exact string somebody
already thought to ban. #C84739 would pass a hex search and look identical.
RED FAMILY is therefore a HUE BAND: within 20 degrees of pure red, with enough
saturation and value to be a colour rather than a grey or a near black. The
margin is printed rather than assumed, so a future seat can see how close the
palette actually runs. For reference, measured: the ratified action #8A4B12
sits at 28.5 degrees and the signal #E0A020 at 40.0 degrees.

WHY THE CONTACT SHEET IS THE RASTER. logo.svg and favicon.svg are vectors, so
they have no pixels until something draws them.
Showcase/brand/logo-contact-sheet.png is both files drawn at 16, 24, 32, 64,
128 and 512px on the light ground and on the dark ground, which is a far wider
rasterisation than a single render would give, and it is itself a delivered
asset. Antialiased edges are included on purpose: an edge blend is where an
off-band colour would first appear.

THE ASLEEP CHECKS, because a guard nobody has watched fire is not a guard, and
an image of nothing holds no red at all. Every image must hold ink pixels AND
signal pixels, or the guard says so and fails instead of reporting clean.

  python3 scripts/brand/check-brand-red.py IMAGE [IMAGE...]

Exit 0 means every image held rendered ink and signal and no red family pixel.
Exit 1 means a violation or a detection failure, and both are printed. The JSON
report goes to stdout either way, so a caller can pin a known count.
"""

import json
import sys

from PIL import Image

# Red family.
RED_HUE_DEGREES = 20.0
MIN_SAT = 0.30
MIN_VAL = 0.20

# The signal, so the guard can prove the mark was actually drawn.
SIGNAL_HUE = 40.0
SIGNAL_TOLERANCE = 14.0

INK_MEAN_MAX = 140
MIN_INK_PIXELS = 200
MIN_SIGNAL_PIXELS = 200


def hue_sat_val(rgb):
    r, g, b = rgb
    mx, mn = max(r, g, b), min(r, g, b)
    val = mx / 255.0
    if mx == 0:
        return 0.0, 0.0, 0.0
    sat = (mx - mn) / mx
    if mx == mn:
        return 0.0, sat, val
    d = float(mx - mn)
    if mx == r:
        hue = 60.0 * (((g - b) / d) % 6.0)
    elif mx == g:
        hue = 60.0 * (((b - r) / d) + 2.0)
    else:
        hue = 60.0 * (((r - g) / d) + 4.0)
    return hue % 360.0, sat, val


def hue_from_red(hue):
    """Degrees away from pure red, wrapping at 360."""
    return min(hue, 360.0 - hue)


def census(path):
    img = Image.open(path).convert('RGB')
    colours = img.getcolors(maxcolors=1 << 24)
    if colours is None:
        raise SystemExit('%s has more distinct colours than the census allows' % path)
    red = 0
    ink = 0
    signal = 0
    closest = None
    worst = None
    for count, rgb in colours:
        hue, sat, val = hue_sat_val(rgb)
        if sum(rgb) / 3.0 < INK_MEAN_MAX:
            ink += count
        if not (sat >= MIN_SAT and val >= MIN_VAL):
            continue
        if abs(hue - SIGNAL_HUE) <= SIGNAL_TOLERANCE:
            signal += count
        away = hue_from_red(hue)
        if closest is None or away < closest[0]:
            closest = (away, rgb)
        if away <= RED_HUE_DEGREES:
            red += count
            if worst is None or count > worst[0]:
                worst = (count, rgb, away)
    return {
        'path': path,
        'size': list(img.size),
        'pixels': img.size[0] * img.size[1],
        'red_family_pixels': red,
        'ink_pixels': ink,
        'signal_pixels': signal,
        'closest_to_red': None if closest is None else {
            'degrees_from_red': round(closest[0], 1),
            'rgb': '#%02X%02X%02X' % closest[1],
        },
        'largest_red_run': None if worst is None else {
            'pixels': worst[0],
            'rgb': '#%02X%02X%02X' % worst[1],
            'degrees_from_red': round(worst[2], 1),
        },
    }


def check(path, scan_only=False):
    """scan_only skips the two anti-vacuity assertions.

    They exist so that a blank image, or one that is not the brand mark at all,
    fails loudly instead of reporting a reassuring zero. That is exactly right
    for public/logo.svg and the contact sheet, and exactly wrong for an article
    cover or an ACE badge, which are art rather than the mark and legitimately
    contain no amber face. Without this mode the register could only ever walk
    the root of public/, which is how thirteen branded article covers carrying
    the dropped red stayed outside every sweep. The red rule itself is NOT
    relaxed here: one implementation, one hue band, no second measurement that
    could quietly disagree with the first.
    """
    r = census(path)
    problems = []
    if scan_only:
        if r['red_family_pixels']:
            problems.append(
                '%s: %d Oracle red family pixels. Largest offending colour: %s at %s degrees '
                'from red, %d pixels.'
                % (path, r['red_family_pixels'],
                   r['largest_red_run']['rgb'], r['largest_red_run']['degrees_from_red'],
                   r['largest_red_run']['pixels']))
        return r, problems
    if r['ink_pixels'] < MIN_INK_PIXELS:
        problems.append(
            '%s: %d ink pixels, below %d. The image is blank or the mark did not render, '
            'so this guard is measuring nothing.' % (path, r['ink_pixels'], MIN_INK_PIXELS))
    if r['signal_pixels'] < MIN_SIGNAL_PIXELS:
        problems.append(
            '%s: %d signal pixels, below %d. The amber face of the mark is missing, so this '
            'guard is not looking at the brand mark at all.' % (path, r['signal_pixels'], MIN_SIGNAL_PIXELS))
    if r['red_family_pixels']:
        problems.append(
            '%s: %d Oracle red family pixels. Oracle red #C74634 is dropped ENTIRELY and that '
            'is a closed founder decision, re-confirmed 8 Aug 2026. The brand mark is ink '
            '#1C1917 with signal #E0A020, and the action colour is #8A4B12. The red is baked '
            'into this file, not only into the CSS, so fix the source and re-run '
            'npm run build:brand. Largest offending colour: %s at %s degrees from red, %d pixels.'
            % (path, r['red_family_pixels'],
               r['largest_red_run']['rgb'], r['largest_red_run']['degrees_from_red'],
               r['largest_red_run']['pixels']))
    return r, problems


def main(argv):
    scan_only = '--scan-only' in argv
    argv = [a for a in argv if a != '--scan-only']
    if not argv:
        raise SystemExit('usage: check-brand-red.py [--scan-only] IMAGE [IMAGE...]')
    images = []
    problems = []
    for path in argv:
        r, found = check(path, scan_only=scan_only)
        images.append(r)
        problems.extend(found)
    out = {
        'checked': len(images),
        'rule': 'no pixel within %.0f degrees of pure red at saturation %.2f and value %.2f or '
                'above, anywhere in a delivered brand asset'
                % (RED_HUE_DEGREES, MIN_SAT, MIN_VAL),
        'images': images,
        'violations': problems,
    }
    sys.stdout.write(json.dumps(out, indent=2) + '\n')
    for p in problems:
        sys.stderr.write('BRAND COLOUR VIOLATION: %s\n' % p)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
