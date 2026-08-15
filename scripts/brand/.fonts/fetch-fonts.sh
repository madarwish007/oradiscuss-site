#!/usr/bin/env bash
# Fetch the OFL variable fonts the editorial cover generator renders with, then
# bake the static weight instances it actually uses. The .ttf files are NOT
# committed (see .gitignore); this script + instance-fonts.py are the provenance,
# so the covers can be regenerated on any machine.
#
# Needs: curl, python3 with fonttools (pip install fonttools).
# Fonts are SIL OFL 1.1 (Sora, Archivo, JetBrains Mono) from the google/fonts repo.
set -euo pipefail
cd "$(dirname "$0")"

echo "downloading variable fonts from google/fonts..."
curl -fsSL -o Sora.ttf          "https://github.com/google/fonts/raw/main/ofl/sora/Sora%5Bwght%5D.ttf"
curl -fsSL -o Archivo.ttf       "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf"
curl -fsSL -o JetBrainsMono.ttf "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf"

echo "baking static weight instances..."
python3 instance-fonts.py

echo "done. now run:  node scripts/brand/editorial-covers.mjs"
