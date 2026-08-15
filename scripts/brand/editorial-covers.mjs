/*
  EDITORIAL ARTICLE COVERS for oradiscuss.com - the site's own visual identity.

  The founder rejected illustration covers ("remove/replace with the same visual
  identity of the website"). The site is a light, warm, TYPE-ONLY editorial system
  with zero illustration, so these covers are pure typography on warm paper: the
  real logo mark, a JetBrains Mono kicker, a Sora 800 headline, an Archivo dek, an
  amber rule, a ghosted monospace keyword as texture. No cartoons, no diagrams.

  Data-driven (req: covers/courses must be updatable): every cover is one row in
  COVERS. Re-run to regenerate. Copy discipline (req: no invented claims): the
  HEADLINE is a verbatim excerpt of the article's own title; the DEK is drawn from
  the article's frontmatter `description` (some verbatim prefixes, some tightened
  to fit one or two lines). No claim is invented; the full title->headline and
  description->dek mapping is handed to the founder for approval.

  Rendering: the real site faces are Sora / Archivo / JetBrains Mono. Their OFL
  variable fonts are fetched by fetch-fonts.sh and baked into unique-family static
  weights by instance-fonts.py (resvg does not interpolate variable weights). We
  render with @resvg/resvg-js handing it those exact files - no fontconfig, fully
  deterministic. A self-test refuses to write if the faces did not load distinctly.

    node scripts/brand/editorial-covers.mjs                 # writes into public/images/blog
    ODC_COVER_OUT=/some/dir node scripts/brand/editorial-covers.mjs   # elsewhere (iteration)
*/
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FONTDIR = path.join(HERE, '.fonts');
const BLOG = process.env.ODC_COVER_OUT || path.join(REPO, 'public', 'images', 'blog');
const SCALE = 2; // supersample then downscale for crisp text edges

const FONT_FILES = [
  'od-sora-xbold', 'od-sora-bold', 'od-archivo', 'od-archivo-md', 'od-mono-md', 'od-mono-bold',
].map((n) => path.join(FONTDIR, `${n}.ttf`));

/* unique family names baked by instance-fonts.py */
const F = {
  soraXB: 'OD Sora XBold', soraB: 'OD Sora Bold',
  arch: 'OD Archivo', archMd: 'OD Archivo Md',
  monoMd: 'OD Mono Md', monoB: 'OD Mono Bold',
};

/* Instrument Amber palette (matches src/styles/global.css) */
const C = {
  ground: '#F7F5F1', panel: '#EFEAE2',
  ink: '#1C1917', ink2: '#4A443D', ink3: '#6A6156',
  amber: '#8A4B12', gold: '#E0A020', goldHi: '#EBB84D',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Rough per-glyph advance in em, for greedy wrapping without a text-measuring API. */
function widthEm(str, tracking = 0) {
  let w = 0;
  for (const ch of str) {
    if ('iIl|.,\':;!'.includes(ch)) w += 0.30;
    else if ('ftjr()[]-'.includes(ch)) w += 0.42;
    else if ('mwMW'.includes(ch)) w += 0.92;
    else if (ch === ' ') w += 0.30;
    else if (ch >= 'A' && ch <= 'Z') w += 0.70;
    else w += 0.55;
    w += tracking;
  }
  return w;
}
function wrap(text, fontSize, maxPx, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const trial = cur ? cur + ' ' + word : word;
    if (widthEm(trial) * fontSize <= maxPx || !cur) cur = trial;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[.,;:]?$/, '') + '…';
    return kept;
  }
  return lines;
}
function fitHeadline(title, maxPx, maxLines, sizes) {
  for (const fs of sizes) {
    const lines = wrap(title, fs, maxPx, 99);
    if (lines.length <= maxLines) return { fs, lines };
  }
  const fs = sizes[sizes.length - 1];
  return { fs, lines: wrap(title, fs, maxPx, maxLines) };
}

/* Real OraDiscuss mark (database cylinder + speech tail) scaled to boxH px at x,y. */
function logoMark(x, y, boxH) {
  const s = boxH / 32;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path fill="${C.ink}" fill-rule="evenodd" d="M2.551 6.294C2.551 3.719 7.915 1.6 14.434 1.6C20.952 1.6 26.317 3.719 26.317 6.294L26.317 22.454C26.317 22.947 26.12 23.436 25.735 23.904Q28.675 27.152 29.448 30.4Q22.693 28.659 18.106 26.918C14.491 27.382 10.524 27.134 7.449 26.251C4.375 25.369 2.551 23.955 2.551 22.454ZM2.551 12.473C2.551 15.047 7.915 17.166 14.434 17.166C20.952 17.166 26.317 15.047 26.317 12.473L26.317 10.037C26.317 12.612 20.952 14.73 14.434 14.73C7.915 14.73 2.551 12.612 2.551 10.037ZM2.551 17.463C2.551 20.038 7.915 22.157 14.434 22.157C20.952 22.157 26.317 20.038 26.317 17.463L26.317 15.027C26.317 17.602 20.952 19.721 14.434 19.721C7.915 19.721 2.551 17.602 2.551 15.027Z"/>
    <ellipse cx="14.434" cy="6.294" rx="9.684" ry="3.825" fill="${C.gold}"/>
  </g>`;
}

function renderSVG(c) {
  const W = c.w, H = c.h;
  const k = H / 1080;
  const ML = Math.round(132 * (W / 1920));
  const MR = ML;
  const colW = W - ML - MR;

  const markH = Math.round(50 * k);
  const mastY = Math.round(92 * k);
  const wordSize = Math.round(22 * k);

  const kw = (c.keyword || '').toUpperCase();
  const kwFs = Math.max(120 * k, Math.min(340 * k, (W * 0.60) / (widthEm(kw, 0.02) || 1)));
  const kwY = H + kwFs * 0.46;

  const eyeSize = Math.round(25 * k);
  const eyeTrack = 5 * k;
  const hlMax = colW * 0.99;
  const hlSizes = [116, 100, 88, 78, 68, 60, 52].map((n) => Math.round(n * k));
  const { fs: hlFs, lines: hlLines } = fitHeadline(c.headline, hlMax, 4, hlSizes);
  const hlLH = Math.round(hlFs * 1.05);
  const ruleH = Math.round(6 * k);
  const ruleW = Math.round(94 * (W / 1920));
  const dekSize = Math.round(30 * k);
  const dekLH = Math.round(dekSize * 1.36);
  const dekLines = c.dek ? wrap(c.dek, dekSize, colW * 0.94, 2) : [];

  const gap1 = Math.round(28 * k);
  const gap2 = Math.round(40 * k);
  const gap3 = Math.round(32 * k);
  const blockH = eyeSize + gap1 + hlLines.length * hlLH + gap2 + ruleH +
    (dekLines.length ? gap3 + dekLines.length * dekLH : 0);

  const contentTop = Math.round(H * 0.30);
  const contentBot = H - Math.round(150 * k);
  let y = contentTop + Math.max(0, (contentBot - contentTop - blockH) / 2);
  y = Math.max(y, mastY + markH + Math.round(58 * k));

  const eyeBaseline = y + eyeSize;
  const hy = eyeBaseline + gap1 + hlFs * 0.80;
  const headlineTspans = hlLines
    .map((ln, i) => `<text x="${ML}" y="${Math.round(hy + i * hlLH)}" font-family="${F.soraXB}" font-size="${hlFs}" letter-spacing="${(-0.02 * hlFs).toFixed(1)}" fill="${C.ink}">${esc(ln)}</text>`)
    .join('\n  ');
  const ruleY = Math.round(hy + (hlLines.length - 1) * hlLH + hlFs * 0.30 + gap2);
  const dekTop = ruleY + ruleH + gap3 + dekSize;
  const dekTspans = dekLines
    .map((ln, i) => `<text x="${ML}" y="${Math.round(dekTop + i * dekLH)}" font-family="${F.arch}" font-size="${dekSize}" fill="${C.ink2}">${esc(ln)}</text>`)
    .join('\n  ');

  const footY = H - Math.round(62 * k);
  const footSize = Math.round(21 * k);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="88%" cy="8%" r="72%">
      <stop offset="0%" stop-color="${C.gold}" stop-opacity="0.15"/>
      <stop offset="55%" stop-color="${C.gold}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dots" width="${Math.round(46 * k)}" height="${Math.round(46 * k)}" patternUnits="userSpaceOnUse">
      <circle cx="1.4" cy="1.4" r="1.4" fill="${C.ink}" fill-opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.ground}"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="${W - MR}" y="${Math.round(kwY)}" text-anchor="end" font-family="${F.monoB}" font-size="${Math.round(kwFs)}" letter-spacing="${(0.02 * kwFs).toFixed(1)}" fill="${C.ink}" fill-opacity="0.038">${esc(kw)}</text>
  <rect x="0" y="0" width="${Math.round(7 * (W / 1920))}" height="${H}" fill="${C.amber}"/>
  ${logoMark(ML, mastY, markH)}
  <text x="${ML + markH * 1.15}" y="${mastY + markH * 0.72}" font-family="${F.monoMd}" font-size="${wordSize}" letter-spacing="${(3 * k).toFixed(1)}" fill="${C.ink2}">ORADISCUSS</text>
  <text x="${ML}" y="${Math.round(eyeBaseline)}" font-family="${F.monoB}" font-size="${eyeSize}" letter-spacing="${eyeTrack.toFixed(1)}" fill="${C.amber}">${esc(c.eyebrow)}</text>
  ${headlineTspans}
  <rect x="${ML}" y="${ruleY}" width="${ruleW}" height="${ruleH}" fill="${C.amber}"/>
  ${dekTspans}
  <text x="${ML}" y="${footY}" font-family="${F.monoMd}" font-size="${footSize}" letter-spacing="${(2 * k).toFixed(1)}" fill="${C.ink3}">ORADISCUSS.COM</text>
  ${c.tag ? `<text x="${W - MR}" y="${footY}" text-anchor="end" font-family="${F.monoMd}" font-size="${footSize}" letter-spacing="${(2 * k).toFixed(1)}" fill="${C.ink3}">${esc(c.tag)}</text>` : ''}
</svg>`;
}

function resvgPng(svg, W) {
  const r = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: F.arch },
    fitTo: { mode: 'width', value: W * SCALE },
  });
  return Buffer.from(r.render().asPng());
}
async function toPng(c) {
  const big = resvgPng(renderSVG(c), c.w);
  // Mitchell kernel: no ringing/overshoot. lanczos3 overshoots at the sharp
  // amber/ground edges and can ring a lone pixel into the red hue band (the
  // brand-red guard is zero-tolerance), so downscale ringing-free.
  return sharp(big).resize(c.w, c.h, { fit: 'fill', kernel: 'mitchell' }).png({ compressionLevel: 9 }).toBuffer();
}

/* self-test: our faces must load distinctly (else resvg fell back to one face) */
function assertFontsLoaded() {
  const mk = (fam) => `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="110"><rect width="700" height="110" fill="#fff"/><text x="10" y="78" font-family="${fam}" font-size="58">Rgy AWR il1 {}</text></svg>`;
  const [xb, b, ar, mono] = [F.soraXB, F.soraB, F.arch, F.monoMd].map((f) => resvgPng(mk(f), 700));
  const same = (a, c) => Buffer.compare(a, c) === 0;
  if (same(xb, b) || same(xb, ar) || same(xb, mono) || same(ar, mono)) {
    throw new Error('FONT SELF-TEST FAILED: the OD static faces did not all render distinctly -> run fetch-fonts.sh then instance-fonts.py.');
  }
  console.log('font self-test ok: Sora XBold / Sora Bold / Archivo / Mono all distinct');
}

const COVERS = [
  { file: 'awr-is-talking-are-you-listening.png', w: 1920, h: 1080,
    eyebrow: 'PERFORMANCE · DBA', keyword: 'AWR', tag: 'DBA',
    headline: 'AWR is Talking, Are You Actually Listening?',
    dek: 'How to read an AWR report as a conversation rather than a symptom lookup.' },
  { file: 'bidirectional-replication-12c.png', w: 1920, h: 1080,
    eyebrow: 'GOLDENGATE · REPLICATION', keyword: 'GoldenGate', tag: 'GOLDENGATE',
    headline: 'Configuring Bidirectional Replication using Oracle GoldenGate 12c',
    dek: 'Extract, DataPump and Replicat on Oracle 12.1 and Solaris 11.2 SPARC.' },
  { file: 'dbcs-to-exacs-migration-untold-story.png', w: 1920, h: 1080,
    eyebrow: 'MIGRATION · OCI', keyword: 'ExaCS', tag: 'OCI',
    headline: 'Moving from DBCS to ExaCS: The Things Nobody Puts in the Migration Guide',
    dek: 'Lessons from migrating production Oracle databases from DBCS to Exadata Cloud Service.' },
  { file: 'enable-disable-options-with-chopt.png', w: 1920, h: 1080,
    eyebrow: 'LICENSING · DBA', keyword: 'chopt', tag: 'DBA',
    headline: 'Enabling/Disabling Database Options in Oracle Enterprise Edition with chopt',
    dek: 'Disable unlicensed Enterprise Edition options and avoid licensing surprises.' },
  { file: 'fix-ora-01017-asmsnmp-missing.png', w: 1920, h: 1080,
    eyebrow: 'TROUBLESHOOTING · DBA', keyword: 'ORA-01017', tag: 'DBA',
    headline: 'Fix ORA-01017: ASMSNMP User Missing After Grid Infrastructure Install',
    dek: 'Why DBCA fails with ORA-01017 after an 11.2.0.4 Grid Infrastructure install, and the fix.' },
  { file: 'gc-buffer-busy-acquired-rac.png', w: 1920, h: 1080,
    eyebrow: 'RAC · PERFORMANCE', keyword: 'RAC', tag: 'DBA',
    headline: 'gc buffer busy acquired: The RAC Wait Event That Ruined My Weekend',
    dek: 'How an application optimisation concentrated hot blocks and doubled transaction times.' },
  { file: 'online-partition-dbms-redefinition.png', w: 1920, h: 1080,
    eyebrow: 'PARTITIONING · DBA', keyword: 'REDEF', tag: 'DBA',
    headline: 'How to Partition a Large Table Online in Oracle Without Downtime',
    dek: 'Converting a 20TB monolithic table to range-interval partitioned IOT, online.' },
  { file: 'rman-backup-progress-monitoring.png', w: 1920, h: 1080,
    eyebrow: 'BACKUP & RECOVERY · SCRIPTS', keyword: 'RMAN', tag: 'SCRIPTS',
    headline: 'Oracle RMAN Backup Progress Monitoring',
    dek: 'Two practical SQL scripts: compression ratio, percent complete, estimated finish time.' },
  { file: 'oradiscuss-db-19-28-to-19-30-cover.png', w: 1920, h: 800,
    eyebrow: 'OEM 24ai UPGRADE · PART 1 OF 3', keyword: 'OMR', tag: 'OCI',
    headline: 'From RU5 to RU8: Patching the OMR Database on OCI',
    dek: 'Your detailed guide to upgrade OEM RU5 to RU8 correctly, without huge downtime.' },
  { file: 'oradiscuss-zdt-oms-24108-cover-1920x764.png', w: 1920, h: 764,
    eyebrow: 'OEM 24ai UPGRADE · PART 2 OF 3', keyword: 'ZDT', tag: 'OCI',
    headline: 'Upgrading the OMS to 24.1.0.8 using ZDT',
    dek: 'The second part of the upgrade guide for OMS to 24ai R1 RU8, released this April.' },
  { file: 'cover-part3.png', w: 1920, h: 764,
    eyebrow: 'OEM 24ai UPGRADE · PART 3 OF 3', keyword: 'AGENTS', tag: 'OCI',
    headline: 'Updating the Agents from RU5 to RU8, One Estate, One Version',
    dek: 'The mass agent update via OEM Agent Patching, off-peak batching across DEV, UAT, PROD.' },
];

async function main() {
  assertFontsLoaded();
  const thumbs = [];
  for (const c of COVERS) {
    const png = await toPng(c);
    await sharp(png).toFile(path.join(BLOG, c.file));
    thumbs.push(png);
    console.log(`wrote ${c.file}  ${c.w}x${c.h}`);
  }
  /* contact sheet for review */
  const cols = 3, cellW = 600, cellH = 360, pad = 16;
  const rows = Math.ceil(thumbs.length / cols);
  const sheetW = cols * cellW + (cols + 1) * pad;
  const sheetH = rows * cellH + (rows + 1) * pad;
  const comps = [];
  for (let i = 0; i < thumbs.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const t = await sharp(thumbs[i]).resize(cellW - 24, cellH - 24, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
    comps.push({ input: t, left: pad + col * (cellW + pad) + 12, top: pad + row * (cellH + pad) + 12 });
  }
  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#d8d3cb' } })
    .composite(comps).png()
    .toFile(path.join(FONTDIR, 'contact-sheet.png'));
  console.log('wrote contact-sheet.png');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
