// ===========================================================================
// THE BRAND CONTACT SHEET.
//
//   node scripts/brand/contact-sheet.mjs
//
// Writes Showcase/brand/logo-contact-sheet.png: the shipped mark at 16, 24,
// 32, 64, 128 and 512px, on the light ground and on the dark ground, so the
// founder judges it at the sizes it will actually be used rather than at the
// size a designer likes to show it at.
//
// IT ALSO PROVES THE SIZE RULE INSTEAD OF ASSERTING IT. The last block puts
// the three-arc file and the two-arc file side by side at a real 16px and a
// real 24px, captured at device scale factor 1 and then magnified NEAREST
// NEIGHBOUR. The magnifier is the one place in this project that does not use
// LANCZOS, deliberately: a smooth resample would blur away the exact mush the
// block exists to show. Those cells are a photograph of 16 real pixels, not a
// vector redrawn large.
//
// Rig: scripts/showcase/capture.mjs, per Showcase/STANDARDS.md section 3. Every
// awkward looking thing in it is a platform bug that has already cost an hour.
// House constants kept: device scale factor 2, 1280 CSS canvas so the shipped
// PNG is exactly 2560 device px wide, 64px padding, no webfont anywhere, no
// inline script in the template.
//
// Palette: the sheet is a NEW artefact so it uses the palette ratified 8 Aug
// 2026 (ground #F7F5F1, ink #1C1917, action #8A4B12, signal #E0A020 as a mark
// and never as a word). It does not touch scripts/showcase/templates/frame.html,
// which stays as STANDARDS section 4 leaves it.
// ===========================================================================

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureBatch } from '../showcase/capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const OUT = join(REPO, 'Showcase', 'brand', 'logo-contact-sheet.png');

const GROUND = '#F7F5F1';
const INK = '#1C1917';
const ACCENT = '#8A4B12';
const SIGNAL = '#E0A020';

const CANVAS = 1280;
const PAD = 64;
const ZOOM = 9;                 // magnification of the real small rasters
const PROOF_SIZES = [16, 24];
const HERO = 512;              // and it is rendered at exactly that

const FULL = 'logo.svg';
const SMALL = 'favicon.svg';

// The mark inlined, so a dark ground can be shown by swapping the ink. The
// shipped file itself carries the ink colour literally: the site has no dark
// surface for the mark today, and a prefers-color-scheme swap inside a file
// that is painted onto a permanently light header is a way to make the mark
// vanish for anyone whose OS is in dark mode.
function inline(file, size, onDark) {
  let s = readFileSync(join(REPO, 'public', file), 'utf8').trim();
  s = s.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  if (onDark) s = s.replaceAll(INK, GROUND);
  return s;
}

// ---------------------------------------------------------------------------
// PASS 1: the real small rasters, at device scale factor 1, then magnified.
// ---------------------------------------------------------------------------
async function magnifiers(work) {
  const cells = [];
  for (const file of [FULL, SMALL]) {
    for (const size of PROOF_SIZES) {
      for (const onDark of [false, true]) {
        cells.push({ file, size, onDark, name: `${file.replace('.svg', '')}-${size}-${onDark ? 'dark' : 'light'}` });
      }
    }
  }
  const CELL = 32;
  const html = `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{display:flex;width:${cells.length * CELL}px}
.c{width:${CELL}px;height:${CELL}px;display:flex;align-items:center;justify-content:center}
svg{display:block}
</style>${cells.map((c) => `<div class="c" style="background:${c.onDark ? INK : GROUND}">${inline(c.file, c.size, c.onDark)}</div>`).join('')}`;
  const page = join(work, 'proof.html');
  writeFileSync(page, html);
  const raw = join(work, 'proof.png');
  await captureBatch({
    dsf: 1, tileMaxCss: 2400,
    jobs: [{ file: page, out: raw, width: cells.length * CELL, height: CELL }],
  });
  // PIL, NEAREST, on purpose. See the header of this file.
  const script = `
from PIL import Image
im = Image.open(${JSON.stringify(raw)}).convert('RGB')
cells = ${JSON.stringify(cells.map((c) => c.name))}
if im.width < len(cells) * ${CELL}:
    raise SystemExit('proof strip is %d px wide, expected %d' % (im.width, len(cells) * ${CELL}))
for i, name in enumerate(cells):
    c = im.crop((i * ${CELL}, 0, (i + 1) * ${CELL}, ${CELL}))
    if len(c.getcolors(maxcolors=4096) or []) < 3:
        raise SystemExit('cell %s holds fewer than 3 colours, so nothing was rendered into it' % name)
    c.resize((${CELL} * ${ZOOM}, ${CELL} * ${ZOOM}), Image.Resampling.NEAREST).save(${JSON.stringify(work)} + '/' + name + '.png')
print('magnified %d cells' % len(cells))
`;
  execFileSync('python3', ['-c', script], { stdio: 'inherit' });
  return cells;
}

// ---------------------------------------------------------------------------
// PASS 2: the sheet itself.
// ---------------------------------------------------------------------------
function sheetHtml(cells) {
  const shipped = [[16, SMALL], [24, SMALL], [32, FULL], [64, FULL], [128, FULL]];
  const strip = (onDark) => shipped.map(([size, file]) => `
      <div class="cell">
        <div class="art" style="width:${size}px;height:${size}px">${inline(file, size, onDark)}</div>
        <div class="cap"><b>${size}px</b><span>${file}</span></div>
      </div>`).join('');

  // 512 means 512. The mark below is not scaled down to fit a nicer column.
  const hero = (onDark) => `
    <div class="hero ${onDark ? 'on-dark' : 'on-light'}">
      ${inline(FULL, HERO, onDark)}
      <div class="cap"><b>${HERO}px</b><span>${FULL}</span></div>
    </div>`;

  // The magnified PNG is 32 * ZOOM device px and is placed at half that in CSS
  // px, so at device scale factor 2 it lands 1:1 on the device grid. Any other
  // number would resample the very pixels this block exists to show.
  const proofCell = (file, size, onDark) => {
    const name = `${file.replace('.svg', '')}-${size}-${onDark ? 'dark' : 'light'}`;
    const c = cells.find((x) => x.name === name);
    if (!c) throw new Error(`no magnified cell for ${name}`);
    return `<div class="pcell"><img src="${name}.png" width="${(32 * ZOOM) / 2}" height="${(32 * ZOOM) / 2}" alt=""></div>`;
  };
  const proofRow = (onDark) => `
    <div class="prow">
      <div class="plab">${onDark ? 'dark ground' : 'light ground'}</div>
      ${PROOF_SIZES.map((s) => proofCell(FULL, s, onDark)).join('')}
      <div class="pgap"></div>
      ${PROOF_SIZES.map((s) => proofCell(SMALL, s, onDark)).join('')}
    </div>`;
  const proofSizes = () => `
    <div class="psize">
      <div class="plab"></div>
      ${PROOF_SIZES.map((s) => `<div class="pnum">${s}px</div>`).join('')}
      <div class="pgap"></div>
      ${PROOF_SIZES.map((s) => `<div class="pnum">${s}px</div>`).join('')}
    </div>`;

  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${CANVAS}px}
body{
  background:${GROUND};color:${INK};
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  padding:${PAD}px;
}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
h1{font-size:23px;font-weight:700;letter-spacing:-.02em;line-height:1.2}
.head{display:flex;align-items:center;gap:12px;padding-bottom:22px;border-bottom:1px solid #DED9D1}
.dot{width:11px;height:11px;border-radius:50%;background:${ACCENT};flex-shrink:0}
.tag{margin-left:auto;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#6B635B}
.sub{font-size:14px;line-height:1.55;color:#4A443E;max-width:78ch;padding:20px 0 26px}
h2{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6B635B;padding:26px 0 12px}
.panel{border:1px solid #DED9D1;border-radius:12px;overflow:hidden}
.band{display:flex;align-items:flex-end;gap:34px;padding:26px 30px}
.on-light{background:${GROUND}}
.on-dark{background:${INK};color:${GROUND}}
.cell{display:flex;flex-direction:column;align-items:center;gap:12px}
.art{display:flex;align-items:center;justify-content:center}
.cap{text-align:center;line-height:1.5}
.cap b{display:block;font-size:12px;font-weight:700}
.cap span{display:block;font-size:10.5px;color:#8A827A;font-family:ui-monospace,Menlo,monospace}
.on-dark .cap span{color:#9A928A}
.heroes{display:flex;gap:24px}
.hero{flex:1;display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px;border-radius:12px;border:1px solid #DED9D1}
.prow{display:flex;align-items:center;gap:14px;padding:10px 0}
.plab{width:104px;font-size:11px;color:#6B635B;font-family:ui-monospace,Menlo,monospace}
.pcell{width:${(32 * ZOOM) / 2}px;height:${(32 * ZOOM) / 2}px;border:1px solid #C9C2B8}
.pcell img{display:block;image-rendering:pixelated}
.pgap{width:26px}
.psize{display:flex;gap:14px;padding:2px 0 4px}
.pnum{width:${(32 * ZOOM) / 2}px;font-size:11px;font-weight:700;color:#4A443E;font-family:ui-monospace,Menlo,monospace}
.phead{display:flex;gap:14px;padding-top:4px}
.phead div{font-size:11px;font-weight:600;color:#6B635B}
.phead .a{width:104px}
.phead .b{width:${32 * ZOOM + 14}px}
.phead .c{width:26px}
.foot{margin-top:30px;padding-top:22px;border-top:1px solid #DED9D1;font-size:12.5px;line-height:1.65;color:#4A443E;max-width:80ch}
.foot b{color:${INK}}
.pill{display:inline-block;border:1px solid ${ACCENT};color:${ACCENT};border-radius:999px;
  padding:3px 11px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  font-family:ui-monospace,Menlo,monospace;margin-right:10px}
</style>

<div class="head">
  <span class="dot"></span>
  <h1>OraDiscuss brand mark</h1>
  <span class="tag mono">public/logo.svg and public/favicon.svg</span>
</div>

<p class="sub">The database, speaking. A cylinder whose bottom cap runs out into a speech tail and
returns to it, so the two readings share one outline rather than one being stuck onto the other. The
seams are cut as holes, so the mark sits on any surface without a plate behind it. The top face is the
only amber element: it is the disc the data is drawn from, and the O of Ora seen in perspective.</p>

<h2>As it ships</h2>
<div class="panel">
  <div class="band on-light">${strip(false)}</div>
  <div class="band on-dark">${strip(true)}</div>
</div>

<h2>Full size</h2>
<div class="heroes">${hero(false)}${hero(true)}</div>

<h2>The size rule, measured not asserted</h2>
<div class="phead">
  <div class="a"></div><div class="b">logo.svg, three arcs</div><div class="c"></div>
  <div class="b">favicon.svg, two arcs</div>
</div>
${proofSizes()}
${proofRow(false)}
${proofRow(true)}

<div class="foot">
  <span class="pill">real pixels</span>
  Every cell in the block above is a capture of the mark at a real <b>16px</b> and <b>24px</b>,
  taken at device scale factor 1 and then magnified nearest neighbour. Nothing is redrawn large.
  The three-arc form greys out below roughly 24px, which is why a second file exists:
  <b>favicon.svg</b> drops to two arcs and thickens the remaining seam, keeping the same body,
  the same tail and the same amber face. Ink <b>#1C1917</b>, signal <b>#E0A020</b> as a mark and
  never as a word. Oracle red is absent, and a guard measures that in these pixels rather than in
  the stylesheet.
</div>`;
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'odc-brand-sheet-'));
  try {
    const cells = await magnifiers(work);
    for (const f of [FULL, SMALL]) copyFileSync(join(REPO, 'public', f), join(work, f));
    const page = join(work, 'sheet.html');
    writeFileSync(page, sheetHtml(cells));
    mkdirSync(dirname(OUT), { recursive: true });
    const res = await captureBatch({
      dsf: 2, tileMaxCss: 2400,
      jobs: [{ file: page, out: OUT, width: CANVAS, height: 'full' }],
    });
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
