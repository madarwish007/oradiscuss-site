#!/usr/bin/env python3
"""Bake static weight instances from the OFL variable fonts and give each a
UNIQUE family name, so resvg (which does not interpolate variable-font weights)
matches them unambiguously by family alone. Produces od-*.ttf next to the VFs."""
import os
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))

# (source VF, axis pins, unique family name, output file)
JOBS = [
    ("Sora.ttf",          {"wght": 800},              "OD Sora XBold",  "od-sora-xbold.ttf"),
    ("Sora.ttf",          {"wght": 700},              "OD Sora Bold",   "od-sora-bold.ttf"),
    ("Archivo.ttf",       {"wght": 400, "wdth": 100}, "OD Archivo",     "od-archivo.ttf"),
    ("Archivo.ttf",       {"wght": 500, "wdth": 100}, "OD Archivo Md",  "od-archivo-md.ttf"),
    ("JetBrainsMono.ttf", {"wght": 500},              "OD Mono Md",     "od-mono-md.ttf"),
    ("JetBrainsMono.ttf", {"wght": 700},              "OD Mono Bold",   "od-mono-bold.ttf"),
]


def rename(font, family):
    name = font["name"]
    ps = family.replace(" ", "")
    for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
        name.setName(family, 1, pid, eid, lid)   # Family
        name.setName("Regular", 2, pid, eid, lid)  # Subfamily
        name.setName(family, 4, pid, eid, lid)   # Full name
        name.setName(ps, 6, pid, eid, lid)       # PostScript
    # drop typographic family/subfamily so nothing competes with nameID 1
    for nid in (16, 17):
        name.removeNames(nameID=nid)


def main():
    for src, axes, family, out in JOBS:
        f = TTFont(f"{HERE}/{src}")
        instantiateVariableFont(f, axes, inplace=True)
        rename(f, family)
        f.save(f"{HERE}/{out}")
        print(f"{out:22s} <- {src} {axes}  family='{family}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
