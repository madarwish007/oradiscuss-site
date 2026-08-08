#!/usr/bin/env python3
"""Pixel work for the showcase rig: stitch tiles, crop pan frames, downscale.

Chrome hands back one PNG per viewport. Anything taller than the tile limit
arrives as several of them, and the last tile always overlaps the one before it
because a page cannot scroll past its own end. This trims by the scroll offset
Chrome actually reported rather than by the offset we asked for, which is the
difference between a seamless report and one with a repeated table row in it.

Every resize is LANCZOS. Nothing here invents pixels.

Subcommands:
  stitch <plan.json>                     tiles -> one PNG
  pan <src.png> <out-dir> <n> <w> <h>    slide a w x h window down src
  scale <src.png> <out.png> <width>      LANCZOS to an exact width
  dims <src.png>                         print "WIDTHxHEIGHT"
  diff <a.png> <b.png>                   fail unless every pixel matches
"""

import json
import sys
from pathlib import Path

from PIL import Image


def stitch(plan_path: str) -> None:
    plan = json.loads(Path(plan_path).read_text())
    dsf = plan["dsf"]
    out_w = plan["cssWidth"] * dsf
    out_h = plan["cssHeight"] * dsf
    canvas = Image.new("RGB", (out_w, out_h), (0, 0, 0))

    # A tile shows document rows [y, y + viewport), where y is the offset the
    # page REALLY scrolled to, not the one we asked for. The last tile is
    # always clamped, because a page cannot scroll past its own end, so it
    # overlaps the tile before it. Pasting each tile whole at its own real
    # offset makes that overlap harmless: the overlapping rows are the same
    # rows, so a later tile paints them again with identical pixels.
    #
    # This is the second version of this function. The first one tried to
    # trim each tile to the slice it was "meant to" contribute, mixed the
    # requested offset with the real one, and pasted the wrong 240 rows at the
    # bottom of the page. scripts/showcase/verify-tiling.mjs is what caught it.
    painted = 0
    for tile in plan["tiles"]:
        img = Image.open(tile["path"]).convert("RGB")
        # The scroll offset is fractional, so this rounds ONCE, in device
        # pixels. Rounding in CSS pixels upstream loses the half.
        top = round(tile["y"] * dsf)
        if top >= out_h:
            continue
        keep = min(img.height, out_h - top)
        canvas.paste(img.crop((0, 0, img.width, keep)), (0, top))
        painted = max(painted, top + keep)

    # The canvas height is the document height rounded UP, so up to one device
    # row at the very bottom lies past the end of the document and no tile ever
    # covered it. Extend the last painted row into it rather than leaving the
    # canvas fill showing as a hairline along the bottom edge.
    if painted < out_h:
        tail = canvas.crop((0, painted - 1, out_w, painted))
        for y in range(painted, out_h):
            canvas.paste(tail, (0, y))

    Path(plan["out"]).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(plan["out"], "PNG", optimize=True)
    print(f"stitch: {plan['out']} {out_w}x{out_h} from {len(plan['tiles'])} tile(s)")


def pan(src: str, out_dir: str, frames: int, width: int, height: int) -> None:
    img = Image.open(src).convert("RGB")
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    if img.width != width:
        raise SystemExit(f"pan: source is {img.width}px wide, window is {width}px. Refusing to crop sideways.")
    travel = max(0, img.height - height)
    written = []
    for i in range(frames):
        t = i / max(1, frames - 1)
        # ease in and out, so the pan starts and stops instead of snapping
        eased = t * t * (3 - 2 * t)
        top = round(travel * eased)
        frame = img.crop((0, top, width, top + height))
        path = str(Path(out_dir) / f"pan-{i:04d}.png")
        frame.save(path, "PNG")
        written.append(path)
    print(f"pan: {len(written)} frames {width}x{height} over {travel}px of travel")


def scale(src: str, out: str, width: int) -> None:
    img = Image.open(src).convert("RGB")
    height = round(img.height * width / img.width)
    height += height % 2  # even, because H.264 refuses odd dimensions
    img.resize((width, height), Image.LANCZOS).save(out, "PNG", optimize=True)
    print(f"scale: {out} {width}x{height}")


def dims(src: str) -> None:
    img = Image.open(src)
    print(f"{img.width}x{img.height}")


def diff(a_path: str, b_path: str) -> None:
    """Compare two captures by PIXELS, never by bytes.

    A Chrome encoded PNG and a PIL encoded PNG of the same image are different
    files. Only the pixels can be compared, and the answer has to be exact:
    'nearly the same' is how a stitch seam hides.
    """
    from PIL import ImageChops

    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        raise SystemExit(f"diff: sizes differ, {a.size} vs {b.size}")
    box = ImageChops.difference(a, b).getbbox()
    if box is not None:
        raise SystemExit(f"diff: pixels differ inside {box}")
    print(f"diff: identical, {a.width}x{a.height}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == "stitch":
        stitch(argv[2])
    elif cmd == "pan":
        pan(argv[2], argv[3], int(argv[4]), int(argv[5]), int(argv[6]))
    elif cmd == "scale":
        scale(argv[2], argv[3], int(argv[4]))
    elif cmd == "dims":
        dims(argv[2])
    elif cmd == "diff":
        diff(argv[2], argv[3])
    else:
        print(f"unknown subcommand: {cmd}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
