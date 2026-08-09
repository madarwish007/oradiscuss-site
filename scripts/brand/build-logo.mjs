// ===========================================================================
// THE ORADISCUSS MARK: "THE DATABASE, SPEAKING".
//
// One command:  node scripts/brand/build-logo.mjs
// It writes public/logo.svg and public/favicon.svg. Nothing else authors them,
// and test/brand.test.js fails if either file drifts from what this emits, so
// the geometry below is the record rather than a comment about the record.
//
// THE DIRECTION, decided before this file existed and not re-opened here:
// a database cylinder that is ALSO a speech form, drawn as ONE object. Ora is
// the database, Discuss is the speaking. Chosen over a typographic wordmark
// and an abstract mark after nine rejected candidates across three rounds.
//
// HOW THE TWO READINGS ARE MADE TO SHARE A SILHOUETTE:
//
//  1. The tail is not a bubble stuck onto a cylinder. It LEAVES the bottom cap
//     at one angle and RETURNS to it at another, so it is a stretch of the same
//     closed outline. Remove it and the cylinder is still whole; add it and the
//     whole shape is a bubble. Nothing is layered.
//  2. The interior seams are cut as HOLES in that one path, never painted in
//     the ground colour, so the mark drops onto any surface without a plate
//     behind it. They are platter seams to a DBA and lines of speech to
//     everyone else, which is the pun, and they cost one path either way.
//  3. The tail leans toward the wordmark. In the header lockup the mark is
//     therefore saying the name that sits beside it.
//  4. The top face is the one amber element. It is the disc a database is
//     drawn from, and it is also the O of Ora seen in perspective.
//
// THE SIZE RULE, which is the known execution risk and is met by drawing two
// files rather than by scaling one: database cylinders are ubiquitous in
// developer tooling, so this lives or dies on the drawing, and a three-arc
// cylinder turns to mush below roughly 24px. logo.svg carries the three-arc
// form (top face plus two seams) for the header at 30px and up. favicon.svg
// carries TWO arcs (top face plus one seam), with a fatter seam and the same
// tail, for the 16px to 24px range. Both are proved as pixels, at every size
// and on both grounds, in Showcase/brand/logo-contact-sheet.png.
//
// COLOUR. Ink #1C1917 and signal #E0A020, from the palette ratified 8 Aug 2026.
// The signal is a MARK here and never carries a word, which is the rule it
// exists under: #E0A020 measures about 1.9:1 on the ground, so it is only ever
// read against ink mass, never floating on the page. Oracle red #C74634 is
// dropped entirely and that is a closed founder decision.
//
// NO LETTERING, NO RASTER, NO EXTERNAL FONT. An SVG that depends on a webfont
// renders differently everywhere. The name is carried by the wordmark beside
// the mark, in the site's own type.
//
// Convention below: SVG y grows downward, so for P(t) = (cx + rx cos t,
// cy + ry sin t) the angle t = 0 is the right edge, t = 90 is the BOTTOM of the
// cap, and t = 180 is the left edge.
// ===========================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const INK = '#1C1917';
export const SIGNAL = '#E0A020';

const BOX = 32;      // viewBox side, both files
const MARGIN = 1.6;  // clear space the art is fitted inside

const rad = (d) => (d * Math.PI) / 180;
const num = (v) => {
  const r = Number(v.toFixed(3));
  return Object.is(r, -0) ? 0 : r;
};
const P = (e, t) => [e.cx + e.rx * Math.cos(rad(t)), e.cy + e.ry * Math.sin(rad(t))];
const dP = (e, t) => [-e.rx * Math.sin(rad(t)), e.ry * Math.cos(rad(t))];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// An elliptical arc as cubics, one per 90 degrees or less. Exact enough that
// the cap, the seams and the amber face all sit on the same perspective.
function arc(e, t1, t2) {
  const span = t2 - t1;
  const steps = Math.max(1, Math.ceil(Math.abs(span) / 90));
  let out = '';
  for (let i = 0; i < steps; i++) {
    const a = t1 + (span * i) / steps;
    const b = t1 + (span * (i + 1)) / steps;
    const d = rad(b - a);
    const k = (Math.sin(d) * (Math.sqrt(4 + 3 * Math.tan(d / 2) ** 2) - 1)) / 3;
    const [x1, y1] = P(e, a); const [u1, v1] = dP(e, a);
    const [x2, y2] = P(e, b); const [u2, v2] = dP(e, b);
    out += `C${num(x1 + k * u1)} ${num(y1 + k * v1)} ${num(x2 - k * u2)} ${num(y2 - k * v2)} ${num(x2)} ${num(y2)}`;
  }
  return out;
}

const caps = (g) => [
  { cx: g.cx, cy: g.top, rx: g.rx, ry: g.ry },
  { cx: g.cx, cy: g.base, rx: g.rx, ry: g.ry },
];

function tailTip(g) {
  const [, bottom] = caps(g);
  const m = mid(P(bottom, g.tailFrom), P(bottom, g.tailTo));
  // Straight out of the cap in the cap's own frame, then leaned right so the
  // tail points at the wordmark rather than straight down.
  let d = [(m[0] - g.cx) / g.rx, (m[1] - g.base) / g.ry];
  const n0 = Math.hypot(d[0], d[1]);
  d = [d[0] / n0 + g.tailLean, d[1] / n0];
  const n1 = Math.hypot(d[0], d[1]);
  return [m[0] + (d[0] / n1) * g.tailLen, m[1] + (d[1] / n1) * g.tailLen];
}

// The outline: left wall up, over the top face, down the right wall, back
// along the bottom cap, and out through the tail on the way.
function outline(g) {
  const [top, bottom] = caps(g);
  const A1 = P(bottom, g.tailFrom);
  const A2 = P(bottom, g.tailTo);
  const tip = tailTip(g);
  const bow = (a, b, push) => {
    const m = mid(a, b);
    return `Q${num(m[0] + push * g.tailLen)} ${num(m[1])} ${num(b[0])} ${num(b[1])}`;
  };
  return `M${num(P(top, 180)[0])} ${num(P(top, 180)[1])}`
    + arc(top, 180, 360)
    + `L${num(g.cx + g.rx)} ${num(g.base)}`
    + arc(bottom, 0, g.tailFrom)
    + bow(A1, tip, g.tailBow)
    + bow(tip, A2, -g.tailBow)
    + arc(bottom, g.tailTo, 180)
    + 'Z';
}

// A seam, cut as a hole. Two nested half ellipses, so it keeps the cylinder's
// perspective instead of being a flat bar across the body.
function seam(g, y) {
  const outer = { cx: g.cx, cy: y, rx: g.rx, ry: g.ry };
  const inner = { cx: g.cx, cy: y - g.seam, rx: g.rx, ry: g.ry };
  return `M${num(P(outer, 180)[0])} ${num(P(outer, 180)[1])}`
    + arc(outer, 180, 0)
    + `L${num(P(inner, 0)[0])} ${num(P(inner, 0)[1])}`
    + arc(inner, 0, 180)
    + 'Z';
}

// ---------------------------------------------------------------------------
// Fit the art to the box. The bbox is taken from SAMPLED curve points, never
// from control points, because a control point sits outside the curve it
// steers and the mark would then be fitted to a shape that is not on screen.
// Both files share one transform by construction: the seams and the amber face
// are interior, so the two silhouettes are identical and so are their bboxes.
// ---------------------------------------------------------------------------
function samplePath(d) {
  const toks = d.match(/[MLCQZ]|-?\d*\.?\d+/g);
  const pts = []; let i = 0; let cur = [0, 0]; let cmd = null;
  const n = () => parseFloat(toks[i++]);
  const bez = (ctrl) => {
    for (let s = 0; s <= 24; s++) {
      const t = s / 24;
      const p = ctrl.map((q) => q.slice());
      for (let r = 0; r < ctrl.length - 1; r++) {
        for (let j = 0; j < p.length - 1 - r; j++) {
          p[j] = [p[j][0] + (p[j + 1][0] - p[j][0]) * t, p[j][1] + (p[j + 1][1] - p[j][1]) * t];
        }
      }
      pts.push(p[0]);
    }
  };
  while (i < toks.length) {
    if (/^[MLCQZ]$/.test(toks[i])) { cmd = toks[i++]; if (cmd === 'Z') continue; }
    if (cmd === 'M' || cmd === 'L') { cur = [n(), n()]; pts.push(cur); }
    else if (cmd === 'C') { const a = [n(), n()]; const b = [n(), n()]; const c = [n(), n()]; bez([cur, a, b, c]); cur = c; }
    else if (cmd === 'Q') { const a = [n(), n()]; const b = [n(), n()]; bez([cur, a, b]); cur = b; }
  }
  return pts;
}

function fit(g) {
  const pts = samplePath(outline(g));
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs); const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0; const h = Math.max(...ys) - y0;
  const s = (BOX - 2 * MARGIN) / Math.max(w, h);
  const tx = (BOX - w * s) / 2 - x0 * s;
  const ty = (BOX - h * s) / 2 - y0 * s;
  // Uniform scale plus translation maps ellipses to ellipses and preserves the
  // parametric angles, so transforming the PARAMETERS is exact and the emitted
  // numbers are the real ones rather than a wrapper transform.
  return {
    ...g,
    cx: g.cx * s + tx, top: g.top * s + ty, base: g.base * s + ty,
    rx: g.rx * s, ry: g.ry * s, seam: g.seam * s,
    tailLen: g.tailLen * s, face: g.face * s,
    seams: g.seams.map((y) => y * s + ty),
  };
}

// ---------------------------------------------------------------------------
// THE GEOMETRY. One body, two seam sets.
// ---------------------------------------------------------------------------
const BODY = {
  cx: 12.0, top: 6.4, base: 20.0, rx: 10.0, ry: 3.95,
  face: 1.85,          // how far the amber top face is inset from the rim
  tailFrom: 18,        // the tail leaves the bottom cap here
  tailTo: 72,          // and returns to it here
  tailLen: 7.6,
  tailLean: 0.36,
  tailBow: 0.12,
};

const FULL = fit({ ...BODY, seam: 2.05, seams: [11.6, 15.8] });
// The small variant is REDRAWN, not scaled down: one arc fewer and a seam a
// quarter thicker. At 16px a 32 unit grid is half a device pixel, so the full
// mark's two seams and the gap between them land inside two pixels and grey
// out. Same body, same tail, same amber face, so the two read as one family.
const SMALL = fit({ ...BODY, seam: 2.6, seams: [14.4] });

function render(g, label) {
  const d = [outline(g), ...g.seams.map((y) => seam(g, y))].join('');
  const f = { cx: g.cx, cy: g.top, rx: g.rx - g.face, ry: g.ry - g.face * (g.ry / g.rx) };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" role="img" aria-label="OraDiscuss">`
    + `<title>OraDiscuss</title>`
    + `<desc>${label}</desc>`
    + `<path fill="${INK}" fill-rule="evenodd" d="${d}"/>`
    + `<ellipse cx="${num(f.cx)}" cy="${num(f.cy)}" rx="${num(f.rx)}" ry="${num(f.ry)}" fill="${SIGNAL}"/>`
    + `</svg>\n`;
}

// Exported so test/brand.test.js can assert the reduction was actually applied
// rather than trusting a filename: same body, same tail, one seam fewer, and
// the surviving seam thicker.
export const GEOMETRY = { full: FULL, small: SMALL };

export const FILES = {
  'public/logo.svg': render(FULL,
    'A database cylinder whose bottom cap runs out into a speech tail, drawn as one outline. '
    + 'Three arcs: the top face and two seams. For 30px and up.'),
  'public/favicon.svg': render(SMALL,
    'The same mark reduced for small sizes: two arcs, the top face and one thicker seam. '
    + 'For 16px to 24px.'),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [rel, body] of Object.entries(FILES)) {
    const out = join(REPO, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
    process.stdout.write(`wrote ${rel} (${body.length} bytes)\n`);
  }
}
