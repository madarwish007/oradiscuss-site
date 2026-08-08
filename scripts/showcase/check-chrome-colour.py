#!/usr/bin/env python3
"""
NO ORACLE RED IN THE FRAME CHROME, MEASURED IN THE PIXELS.

Oracle red #C74634 is dropped entirely. That is a closed founder decision,
re-confirmed 8 Aug 2026: PRODUCT.md names Oracle's own marketing as an
anti-reference and the Terms disclaim affiliation, so borrowing Oracle's red
contradicts both. See section 4 of Showcase/STANDARDS.md.

This checks the DELIVERED PNG, not the CSS that produced it. A stylesheet can
be corrected while a red asset stays on disk, and a shipped image is what a
customer actually sees. It is also the only check that survives a template
being rewritten by a seat who never reads the template.

WHAT IS MEASURED, AND WHAT DELIBERATELY IS NOT.

Only the FRAME CHROME: the header strip above the artefact panel and the
caption strip below it. The artefact panel itself holds the pack's own output,
which is a dark surface with its own palette, and its CRIT badge #FF6B4A is
pack output rather than brand chrome. Scanning the whole image would flag that
and the guard would be turned off within a week.

The panel is FOUND, never assumed at a fixed row. Every row is reduced to its
mean luminance, and the longest run of dark rows is the panel. The frame
background sits near 247 and a panel row sits near 39, so the two do not
overlap. Every derived boundary is then sanity checked, loudly: a detector that
silently finds no panel would report "clean" for a fully red image, which is
exactly the asleep-guard failure this project has been bitten by before.

RED FAMILY is a hue band, not a hex match, because an antialiased edge of a red
dot is never the exact hex. Hue within 20 degrees of pure red, with enough
saturation and value to be a colour rather than a grey. The decided accent
#8A4B12 sits at hue 28.5 degrees and blends toward the near white frame
background keep that hue, so it clears the band with margin. The margin is
printed rather than assumed.

  python3 scripts/showcase/check-chrome-colour.py IMAGE [IMAGE...]

Exit 0 means every band was located, every band held rendered chrome, and no
band held a red family pixel. Exit 1 means a violation or a detection failure,
and both are printed.
"""

import json
import sys

from PIL import Image

# A row whose mean luminance is below this is inside the artefact panel. The
# measured gap is wide: frame background rows read 231 and up, panel rows read
# 39 and below.
PANEL_ROW_MEAN_MAX = 140

# Rows dropped on each side of the detected panel, so a rounded corner or the
# hairline's antialiasing is never counted as chrome.
PANEL_MARGIN_ROWS = 6

# Red family. Hue is degrees on the colour wheel, wrapping at 360.
RED_HUE_DEGREES = 20.0
MIN_SAT = 0.30
MIN_VAL = 0.20

# A pixel this dark counts as rendered ink. Each band must hold some, or the
# guard is looking at blank padding and measuring nothing.
INK_MEAN_MAX = 140
MIN_INK_PIXELS = 100


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
    """Degrees away from pure red, wrapping."""
    return min(hue, 360.0 - hue)


def is_colour(sat, val):
    return sat >= MIN_SAT and val >= MIN_VAL


def find_panel(img):
    """Longest run of dark rows, as (top, bottom) inclusive."""
    height = img.size[1]
    column = img.convert('L').resize((1, height), Image.Resampling.BOX)
    means = [column.getpixel((0, y)) for y in range(height)]
    best = None
    start = None
    for y in range(height + 1):
        dark = y < height and means[y] < PANEL_ROW_MEAN_MAX
        if dark and start is None:
            start = y
        elif not dark and start is not None:
            run = (y - start, start, y - 1)
            if best is None or run[0] > best[0]:
                best = run
            start = None
    if best is None:
        return None
    return best[1], best[2]


def band_report(img, box):
    """Colour census of one band. box is (left, top, right, bottom)."""
    crop = img.crop(box)
    colours = crop.getcolors(maxcolors=1 << 22)
    if colours is None:
        raise SystemExit('band has more distinct colours than the census allows')
    red = 0
    ink = 0
    closest = None
    for count, rgb in colours:
        hue, sat, val = hue_sat_val(rgb)
        if sum(rgb) / 3.0 < INK_MEAN_MAX:
            ink += count
        if not is_colour(sat, val):
            continue
        away = hue_from_red(hue)
        if closest is None or away < closest[0]:
            closest = (away, rgb)
        if away <= RED_HUE_DEGREES:
            red += count
    return {
        'pixels': crop.size[0] * crop.size[1],
        'red_family_pixels': red,
        'ink_pixels': ink,
        'closest_to_red': None if closest is None else {
            'degrees_from_red': round(closest[0], 1),
            'rgb': '#%02X%02X%02X' % closest[1],
        },
    }


def check(path):
    img = Image.open(path).convert('RGB')
    width, height = img.size
    problems = []

    panel = find_panel(img)
    if panel is None:
        return {'path': path, 'size': [width, height]}, [
            '%s: no artefact panel found at all, so this guard measured nothing' % path
        ]
    top, bottom = panel

    # Loud sanity checks on the detection itself.
    if bottom - top + 1 < height * 0.4:
        problems.append(
            '%s: the detected panel is %d of %d rows, which is too small to be the artefact. '
            'The band boundaries cannot be trusted.' % (path, bottom - top + 1, height)
        )
    header_end = top - PANEL_MARGIN_ROWS
    caption_start = bottom + 1 + PANEL_MARGIN_ROWS
    if header_end < 60:
        problems.append('%s: header strip is only %d rows tall' % (path, max(header_end, 0)))
    if height - caption_start < 60:
        problems.append('%s: caption strip is only %d rows tall' % (path, max(height - caption_start, 0)))
    if problems:
        return {'path': path, 'size': [width, height], 'panel_rows': [top, bottom]}, problems

    bands = {
        'header_strip': band_report(img, (0, 0, width, header_end)),
        'caption_strip': band_report(img, (0, caption_start, width, height)),
    }
    for name, b in bands.items():
        if b['ink_pixels'] < MIN_INK_PIXELS:
            problems.append(
                '%s: the %s holds %d ink pixels, so it is blank and this guard is measuring '
                'nothing there.' % (path, name, b['ink_pixels'])
            )
        if b['red_family_pixels']:
            problems.append(
                '%s: %d Oracle red family pixels in the %s. Oracle red #C74634 is dropped '
                'entirely and that is a closed founder decision, re-confirmed 8 Aug 2026. The '
                'showcase accent is #8A4B12. Fix the template, then re-run '
                'npm run build:showcase: the red is baked into this file, not only into the CSS. '
                'Nearest colour to red found here: %s at %s degrees from red.'
                % (path, b['red_family_pixels'], name,
                   b['closest_to_red']['rgb'] if b['closest_to_red'] else 'none',
                   b['closest_to_red']['degrees_from_red'] if b['closest_to_red'] else 'n/a')
            )
    return {
        'path': path,
        'size': [width, height],
        'panel_rows': [top, bottom],
        'header_strip_rows': [0, header_end],
        'caption_strip_rows': [caption_start, height],
        'bands': bands,
    }, problems


def main(argv):
    if not argv:
        raise SystemExit('usage: check-chrome-colour.py IMAGE [IMAGE...]')
    images = []
    problems = []
    for path in argv:
        report, found = check(path)
        images.append(report)
        problems.extend(found)
    out = {
        'checked': len(images),
        'rule': 'no pixel within %.0f degrees of pure red, at saturation %.2f and value %.2f or '
                'above, in the header strip or the caption strip of a shipped showcase image'
                % (RED_HUE_DEGREES, MIN_SAT, MIN_VAL),
        'images': images,
        'violations': problems,
    }
    sys.stdout.write(json.dumps(out, indent=2) + '\n')
    for p in problems:
        sys.stderr.write('CHROME COLOUR VIOLATION: %s\n' % p)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
