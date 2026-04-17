// Local cartoon-style cover generator for oradiscuss.com articles.
// Writes 7 hand-coded SVG scenes, rasterises each to a 1920x1080 PNG via
// sharp, and drops the PNGs into ~/Downloads/oradiscuss_images/.
//
// Palette (must stay consistent across all 7 to feel like a series):
//   --bg        #0d0c0a   deep charcoal
//   --bg2       #1a1614   lifted charcoal
//   --bg3       #2b2623   warm slate
//   --red       #c74634   Oracle red (primary accent)
//   --red-hi    #e86454   lighter red (highlights / rim)
//   --cream     #faf7f2   warm off-white (highlight edges)
//   --line      #3a3532   subtle stroke

import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const OUT = path.join(homedir(), 'Downloads', 'oradiscuss_images');
await mkdir(OUT, { recursive: true });

const W = 1920;
const H = 1080;

// ---------- Shared SVG fragments ----------

const DEFS = `
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1a1614"/>
    <stop offset="100%" stop-color="#0d0c0a"/>
  </linearGradient>
  <radialGradient id="spot" cx="50%" cy="55%" r="55%">
    <stop offset="0%" stop-color="#c74634" stop-opacity="0.28"/>
    <stop offset="60%" stop-color="#c74634" stop-opacity="0"/>
  </radialGradient>
  <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
    <circle cx="28" cy="28" r="1.3" fill="#3a3532"/>
  </pattern>
  <linearGradient id="redcard" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#e86454"/>
    <stop offset="100%" stop-color="#c74634"/>
  </linearGradient>
  <linearGradient id="creamgrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#faf7f2"/>
    <stop offset="100%" stop-color="#e8e3dd"/>
  </linearGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="14"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="softshadow" x="-20%" y="-20%" width="140%" height="140%">
    <feOffset dx="0" dy="18"/>
    <feGaussianBlur stdDeviation="22"/>
    <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.45 0"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
`;

const BACKGROUND = `
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#grid)" opacity="0.35"/>
<rect width="${W}" height="${H}" fill="url(#spot)"/>
<rect x="0" y="0" width="14" height="${H}" fill="#c74634"/>
`;

// Top-right Od mark
const OD_MARK = `
<g transform="translate(${W - 180}, 80)">
  <rect width="100" height="100" rx="18" fill="#c74634"/>
  <text x="50" y="68" text-anchor="middle"
        font-family="Inter, Helvetica, sans-serif" font-size="48" font-weight="800"
        fill="#ffffff" letter-spacing="-1.4">Od</text>
  <rect x="26" y="76" width="48" height="5" rx="2" fill="#ffffff" opacity="0.9"/>
</g>
`;

const WATERMARK = `
<text x="80" y="${H - 60}" font-family="Inter, Helvetica, sans-serif"
      font-size="18" font-weight="600" fill="#665f59" letter-spacing="2">
  ORADISCUSS.COM
</text>
`;

function wrap(frame) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
${DEFS}
${BACKGROUND}
${frame}
${OD_MARK}
${WATERMARK}
</svg>`;
}

// ---------- Character / element helpers ----------

// A cartoon "server rack" character. Optional facial expression.
function serverRack({ x, y, w = 220, h = 340, tilt = 0, expression = 'neutral', tint = '#2b2623', glowColor = null, leds = 'normal' }) {
  // LED colors
  const ledOn = '#e86454';
  const ledDim = '#5a4e47';
  const slits = [];
  for (let i = 0; i < 6; i++) {
    const yy = 50 + i * 38;
    slits.push(`<rect x="20" y="${yy}" width="${w - 40}" height="6" rx="2" fill="#1a1614"/>`);
    // LEDs
    slits.push(`<circle cx="${w - 38}" cy="${yy + 3}" r="5" fill="${leds === 'error' && i % 2 === 0 ? ledOn : ledDim}"/>`);
    slits.push(`<circle cx="${w - 22}" cy="${yy + 3}" r="5" fill="${leds === 'error' ? ledOn : (i === 0 || i === 3 ? ledOn : ledDim)}"/>`);
  }
  // Face (eyes + mouth) on the top panel
  const eyeY = 22;
  let face = '';
  if (expression === 'stressed') {
    face = `
      <circle cx="${w/2 - 40}" cy="${eyeY}" r="7" fill="#faf7f2"/>
      <circle cx="${w/2 - 40}" cy="${eyeY - 1}" r="3" fill="#0d0c0a"/>
      <circle cx="${w/2 + 40}" cy="${eyeY}" r="7" fill="#faf7f2"/>
      <circle cx="${w/2 + 40}" cy="${eyeY - 1}" r="3" fill="#0d0c0a"/>
      <path d="M ${w/2 - 22} 40 Q ${w/2} 28 ${w/2 + 22} 40" stroke="#faf7f2" stroke-width="3" fill="none" stroke-linecap="round"/>
      <!-- sweat drop -->
      <path d="M ${w - 18} 10 q -6 10 0 18 q 6 -8 0 -18 z" fill="#6ac3ff" opacity="0.9"/>
    `;
  } else if (expression === 'smug') {
    face = `
      <path d="M ${w/2 - 50} ${eyeY - 2} l 18 0" stroke="#faf7f2" stroke-width="4" stroke-linecap="round"/>
      <path d="M ${w/2 + 32} ${eyeY - 2} l 18 0" stroke="#faf7f2" stroke-width="4" stroke-linecap="round"/>
      <path d="M ${w/2 - 22} 38 Q ${w/2} 48 ${w/2 + 22} 38" stroke="#faf7f2" stroke-width="3" fill="none" stroke-linecap="round"/>
    `;
  } else if (expression === 'worried') {
    face = `
      <circle cx="${w/2 - 40}" cy="${eyeY}" r="6" fill="#faf7f2"/>
      <circle cx="${w/2 + 40}" cy="${eyeY}" r="6" fill="#faf7f2"/>
      <path d="M ${w/2 - 18} 44 Q ${w/2} 38 ${w/2 + 18} 44" stroke="#faf7f2" stroke-width="3" fill="none" stroke-linecap="round"/>
    `;
  }
  const glow = glowColor ? `<rect x="-20" y="-20" width="${w + 40}" height="${h + 40}" rx="30" fill="${glowColor}" opacity="0.18" filter="url(#glow)"/>` : '';
  return `
    <g transform="translate(${x},${y}) rotate(${tilt} ${w/2} ${h/2})" filter="url(#softshadow)">
      ${glow}
      <rect width="${w}" height="${h}" rx="14" fill="${tint}" stroke="#3a3532" stroke-width="2"/>
      <rect x="0" y="0" width="${w}" height="${h}" rx="14" fill="url(#creamgrad)" opacity="0.04"/>
      <!-- top display panel -->
      <rect x="8" y="8" width="${w - 16}" height="36" rx="6" fill="#0d0c0a" stroke="#c74634" stroke-opacity="0.4"/>
      ${face}
      ${slits.join('\n      ')}
      <!-- base -->
      <rect x="-6" y="${h - 10}" width="${w + 12}" height="10" rx="4" fill="#1a1614"/>
    </g>
  `;
}

// A glowing red "data block" (the contested packet in gc-buffer-busy scene).
function redCube({ x, y, size = 120, extraGlow = true }) {
  const glow = extraGlow ? `<rect x="${x - size*0.4}" y="${y - size*0.4}" width="${size * 1.8}" height="${size * 1.8}" rx="${size}" fill="#c74634" opacity="0.35" filter="url(#glow)"/>` : '';
  return `
    ${glow}
    <g transform="translate(${x},${y})">
      <rect width="${size}" height="${size}" rx="14" fill="url(#redcard)" stroke="#faf7f2" stroke-opacity="0.35" stroke-width="2"/>
      <rect x="12" y="12" width="${size - 24}" height="${size - 24}" rx="8" fill="none" stroke="#faf7f2" stroke-opacity="0.5" stroke-width="1.5"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="10" fill="#faf7f2" opacity="0.95"/>
    </g>
  `;
}

function categoryTag(label, x = 88, y = 120) {
  const w = Math.max(200, label.length * 14 + 56);
  return `
    <g transform="translate(${x},${y})">
      <rect width="${w}" height="48" rx="8" fill="#c74634" fill-opacity="0.16" stroke="#c74634" stroke-opacity="0.5" stroke-width="1.5"/>
      <text x="${w/2}" y="32" text-anchor="middle" font-family="Inter, Helvetica, sans-serif"
            font-size="15" font-weight="800" fill="#e86454" letter-spacing="2.4">${label}</text>
    </g>
  `;
}

function title(lines, x = 88, y = 220, size = 66) {
  const tspans = lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : size * 1.18}">${escapeXml(l)}</tspan>`).join('');
  return `
    <text y="${y}" font-family="Inter, Helvetica, sans-serif" font-size="${size}" font-weight="700"
          fill="#ffffff" letter-spacing="-2">${tspans}</text>
  `;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// Dotted / dashed red connection line with optional "tug" bow
function redCable({ x1, y1, x2, y2, curve = 0.15, dashed = false, thick = 6 }) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - (Math.abs(x2 - x1) * curve);
  const dash = dashed ? ' stroke-dasharray="14,10"' : '';
  return `<path d="M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}" stroke="#c74634" stroke-width="${thick}" fill="none" stroke-linecap="round"${dash} filter="url(#glow)"/>
          <path d="M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}" stroke="#e86454" stroke-width="${thick / 2}" fill="none" stroke-linecap="round"${dash}/>`;
}

function particles(count = 30, area = [400, 200, 1100, 800]) {
  const [minX, minY, maxX, maxY] = area;
  const out = [];
  for (let i = 0; i < count; i++) {
    const px = minX + Math.random() * (maxX - minX);
    const py = minY + Math.random() * (maxY - minY);
    const r = 1 + Math.random() * 3;
    const op = 0.2 + Math.random() * 0.6;
    const c = Math.random() > 0.5 ? '#e86454' : '#faf7f2';
    out.push(`<circle cx="${px.toFixed(0)}" cy="${py.toFixed(0)}" r="${r.toFixed(1)}" fill="${c}" opacity="${op.toFixed(2)}"/>`);
  }
  return out.join('');
}

// Pre-seed Math.random for deterministic particles per scene
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// ---------- Individual scenes ----------

function sceneGcBufferBusy() {
  const r1 = serverRack({ x: 250, y: 370, expression: 'stressed', tint: '#2b2623', leds: 'error', glowColor: '#c74634' });
  const r2 = serverRack({ x: 1450, y: 370, expression: 'smug', tint: '#1f1a17' });
  // Contested red cube in the middle, slightly tilted
  const cube = redCube({ x: 900, y: 500, size: 140 });
  // Tug-of-war cables
  const cable1 = redCable({ x1: 470, y1: 540, x2: 900, y2: 570, curve: 0.1, thick: 8 });
  const cable2 = redCable({ x1: 1040, y1: 570, x2: 1450, y2: 540, curve: 0.1, thick: 8 });
  return wrap(`
    ${categoryTag('ADVANCED DBA')}
    ${title(['Two racks.', 'One block.', 'Weekend ruined.'], 88, 250, 88)}
    <!-- scene on lower half -->
    ${r1}
    ${r2}
    ${cable1}
    ${cable2}
    ${cube}
  `);
}

function sceneRedef() {
  // Massive obsidian cube being sliced by laser sheets
  // Cube tower
  const tower = `
    <g transform="translate(780,360)" filter="url(#softshadow)">
      <rect width="380" height="560" rx="12" fill="#1a1614" stroke="#3a3532" stroke-width="2"/>
      <rect x="0" y="0" width="380" height="560" rx="12" fill="url(#creamgrad)" opacity="0.04"/>
      <!-- slice gaps -->
      <rect x="0" y="120" width="380" height="10" fill="#0d0c0a"/>
      <rect x="0" y="260" width="380" height="10" fill="#0d0c0a"/>
      <rect x="0" y="400" width="380" height="10" fill="#0d0c0a"/>
      <!-- data flow dots -->
      <circle cx="60" cy="60" r="3" fill="#e86454"/>
      <circle cx="120" cy="180" r="3" fill="#e86454"/>
      <circle cx="300" cy="220" r="3" fill="#e86454"/>
      <circle cx="80" cy="320" r="3" fill="#e86454"/>
      <circle cx="260" cy="460" r="3" fill="#e86454"/>
      <!-- windows -->
      <rect x="30" y="30" width="80" height="30" rx="4" fill="#0d0c0a" stroke="#c74634" stroke-opacity="0.4"/>
      <rect x="30" y="170" width="80" height="30" rx="4" fill="#0d0c0a" stroke="#c74634" stroke-opacity="0.4"/>
      <rect x="30" y="310" width="80" height="30" rx="4" fill="#0d0c0a" stroke="#c74634" stroke-opacity="0.4"/>
      <rect x="30" y="450" width="80" height="30" rx="4" fill="#0d0c0a" stroke="#c74634" stroke-opacity="0.4"/>
    </g>
  `;
  // Laser sheets cutting horizontally
  const lasers = `
    <g opacity="0.9" filter="url(#glow)">
      <rect x="740" y="478" width="460" height="4" fill="#e86454"/>
      <rect x="740" y="618" width="460" height="4" fill="#e86454"/>
      <rect x="740" y="758" width="460" height="4" fill="#e86454"/>
    </g>
  `;
  // Worker-bots at the base
  const bot = (x) => `
    <g transform="translate(${x}, 870)">
      <rect x="-22" y="-30" width="44" height="46" rx="8" fill="#3a3532" stroke="#c74634" stroke-opacity="0.5"/>
      <rect x="-15" y="-22" width="30" height="10" rx="2" fill="#e86454"/>
      <circle cx="-8" cy="-6" r="3" fill="#faf7f2"/>
      <circle cx="8" cy="-6" r="3" fill="#faf7f2"/>
      <rect x="-24" y="16" width="48" height="8" rx="3" fill="#1a1614"/>
      <!-- antenna -->
      <line x1="0" y1="-30" x2="0" y2="-42" stroke="#c74634" stroke-width="2"/>
      <circle cx="0" cy="-44" r="3" fill="#e86454"/>
      <!-- package -->
      <rect x="-14" y="-48" width="28" height="16" rx="2" fill="url(#redcard)" stroke="#faf7f2" stroke-opacity="0.3"/>
    </g>
  `;
  return wrap(`
    ${categoryTag('ADVANCED DBA')}
    ${title(['Slicing a 20TB table.', 'Online. Mid-traffic.'], 88, 250, 74)}
    ${tower}
    ${lasers}
    ${bot(620)}
    ${bot(710)}
    ${bot(1220)}
    ${bot(1310)}
  `);
}

function sceneAwr() {
  // Detective silhouette + magnifying glass
  const detective = `
    <g transform="translate(380,520)">
      <!-- fedora -->
      <ellipse cx="120" cy="-10" rx="110" ry="18" fill="#1a1614"/>
      <rect x="60" y="-60" width="120" height="54" rx="20" fill="#1a1614"/>
      <rect x="60" y="-50" width="120" height="12" fill="#c74634"/>
      <!-- head silhouette -->
      <ellipse cx="120" cy="40" rx="70" ry="56" fill="#0d0c0a"/>
      <!-- trenchcoat body -->
      <path d="M 30 110 Q 120 80 210 110 L 240 360 L 0 360 Z" fill="#1a1614" stroke="#3a3532" stroke-width="2"/>
      <!-- coat lapel -->
      <path d="M 120 105 L 90 200 L 120 230 L 150 200 Z" fill="#0d0c0a"/>
      <!-- arm extending right holding magnifying glass -->
      <path d="M 200 180 Q 340 170 500 210" stroke="#1a1614" stroke-width="56" stroke-linecap="round" fill="none"/>
    </g>
  `;
  // Magnifying glass
  const glass = `
    <g transform="translate(1100,650)" filter="url(#softshadow)">
      <circle r="160" fill="#1a1614" stroke="#c74634" stroke-width="10"/>
      <circle r="146" fill="#0d0c0a" stroke="#3a3532" stroke-width="2"/>
      <!-- handle -->
      <rect x="100" y="100" width="200" height="34" rx="12" transform="rotate(30 100 100)" fill="#c74634" stroke="#faf7f2" stroke-opacity="0.25"/>
      <!-- waveform inside the lens -->
      <g clip-path="circle(146px at 0 0)">
        <path d="M -140 40 L -110 40 L -95 -20 L -80 60 L -65 -40 L -50 80 L -30 -30 L -10 50 L 10 -50 L 30 40 L 50 -20 L 70 60 L 90 -40 L 110 40 L 140 40"
              stroke="#e86454" stroke-width="4" fill="none" stroke-linecap="round" filter="url(#glow)"/>
        <path d="M -140 90 L 140 90" stroke="#3a3532" stroke-width="1" stroke-dasharray="4,4"/>
        <path d="M -140 -10 L 140 -10" stroke="#3a3532" stroke-width="1" stroke-dasharray="4,4"/>
      </g>
    </g>
  `;
  return wrap(`
    ${categoryTag('ADVANCED DBA')}
    ${title(['AWR is talking.', 'Are you listening?'], 88, 250, 80)}
    ${detective}
    ${glass}
    ${particles(24, [900, 400, 1400, 900])}
  `);
}

function sceneDbcsExacs() {
  // Two cloud platforms with a bridge between
  const oldCloud = `
    <g transform="translate(130, 560)" filter="url(#softshadow)">
      <!-- cloud base -->
      <ellipse cx="180" cy="240" rx="200" ry="30" fill="#1a1614"/>
      <!-- building blocks -->
      <rect x="40" y="80" width="60" height="160" rx="6" fill="#2b2623" stroke="#3a3532"/>
      <rect x="110" y="40" width="80" height="200" rx="6" fill="#1f1a17" stroke="#3a3532"/>
      <rect x="200" y="100" width="60" height="140" rx="6" fill="#2b2623" stroke="#3a3532"/>
      <rect x="270" y="140" width="60" height="100" rx="6" fill="#1f1a17" stroke="#3a3532"/>
      <!-- windows -->
      <g fill="#c74634" opacity="0.65">
        <rect x="50" y="100" width="12" height="8"/><rect x="70" y="100" width="12" height="8"/>
        <rect x="50" y="130" width="12" height="8"/><rect x="70" y="160" width="12" height="8"/>
        <rect x="120" y="60" width="14" height="10"/><rect x="142" y="60" width="14" height="10"/>
        <rect x="120" y="90" width="14" height="10"/><rect x="142" y="120" width="14" height="10"/>
        <rect x="120" y="150" width="14" height="10"/><rect x="120" y="180" width="14" height="10"/>
        <rect x="212" y="120" width="12" height="8"/><rect x="232" y="150" width="12" height="8"/>
        <rect x="280" y="160" width="12" height="8"/><rect x="300" y="190" width="12" height="8"/>
      </g>
      <!-- label block -->
      <rect x="130" y="0" width="100" height="28" rx="6" fill="#c74634"/>
      <text x="180" y="19" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" font-weight="800" fill="#faf7f2" letter-spacing="1">DBCS</text>
    </g>
  `;
  const newCloud = `
    <g transform="translate(1380, 520)" filter="url(#softshadow)">
      <ellipse cx="200" cy="280" rx="240" ry="32" fill="#1a1614"/>
      <!-- futuristic tall towers -->
      <rect x="40" y="80" width="60" height="200" rx="6" fill="#2b2623" stroke="#c74634" stroke-opacity="0.4"/>
      <rect x="120" y="20" width="90" height="260" rx="8" fill="#1f1a17" stroke="#c74634" stroke-opacity="0.7"/>
      <rect x="230" y="60" width="70" height="220" rx="6" fill="#2b2623" stroke="#c74634" stroke-opacity="0.4"/>
      <rect x="320" y="100" width="60" height="180" rx="6" fill="#1f1a17" stroke="#c74634" stroke-opacity="0.3"/>
      <!-- sleek light strips -->
      <g fill="#e86454">
        <rect x="50" y="100" width="40" height="4"/>
        <rect x="50" y="140" width="40" height="4"/>
        <rect x="50" y="180" width="40" height="4"/>
        <rect x="50" y="220" width="40" height="4"/>
        <rect x="130" y="40" width="70" height="4"/>
        <rect x="130" y="80" width="70" height="4"/>
        <rect x="130" y="120" width="70" height="4"/>
        <rect x="130" y="160" width="70" height="4"/>
        <rect x="130" y="200" width="70" height="4"/>
        <rect x="130" y="240" width="70" height="4"/>
        <rect x="240" y="80" width="50" height="4"/>
        <rect x="240" y="120" width="50" height="4"/>
        <rect x="240" y="160" width="50" height="4"/>
        <rect x="240" y="200" width="50" height="4"/>
        <rect x="240" y="240" width="50" height="4"/>
        <rect x="330" y="120" width="40" height="4"/>
        <rect x="330" y="160" width="40" height="4"/>
        <rect x="330" y="200" width="40" height="4"/>
        <rect x="330" y="240" width="40" height="4"/>
      </g>
      <!-- label block -->
      <rect x="140" y="-10" width="120" height="32" rx="8" fill="#c74634"/>
      <text x="200" y="11" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" font-weight="800" fill="#faf7f2" letter-spacing="1">EXACS</text>
    </g>
  `;
  // Suspension bridge
  const bridge = `
    <g>
      <path d="M 480 690 Q 960 540 1440 690" stroke="#c74634" stroke-width="12" fill="none" stroke-linecap="round" filter="url(#glow)"/>
      <path d="M 480 690 Q 960 540 1440 690" stroke="#e86454" stroke-width="4" fill="none" stroke-linecap="round"/>
      <!-- cables -->
      <path d="M 480 690 Q 960 540 1440 690" stroke="#c74634" stroke-width="1" fill="none" stroke-dasharray="2,20" opacity="0.8"/>
      <!-- tower pillars -->
      <rect x="478" y="580" width="10" height="130" fill="#3a3532"/>
      <rect x="1432" y="580" width="10" height="130" fill="#3a3532"/>
      <!-- data packets mid-bridge -->
      <rect x="800" y="598" width="30" height="20" rx="3" fill="url(#redcard)"/>
      <rect x="900" y="588" width="30" height="20" rx="3" fill="url(#redcard)"/>
      <rect x="1000" y="588" width="30" height="20" rx="3" fill="url(#redcard)"/>
      <rect x="1100" y="598" width="30" height="20" rx="3" fill="url(#redcard)"/>
    </g>
  `;
  return wrap(`
    ${categoryTag('OCI / CLOUD')}
    ${title(['DBCS to ExaCS.', 'The things nobody', 'writes down.'], 88, 250, 70)}
    ${oldCloud}
    ${newCloud}
    ${bridge}
  `);
}

function sceneReplication() {
  // Two mirrored cube database twins with figure-8 energy loop
  const leftDb = `
    <g transform="translate(540,540)" filter="url(#softshadow)">
      <ellipse cx="140" cy="260" rx="140" ry="14" fill="#1a1614"/>
      <ellipse cx="140" cy="20" rx="140" ry="26" fill="#2b2623" stroke="#3a3532"/>
      <rect x="0" y="20" width="280" height="220" fill="#2b2623" stroke="#3a3532"/>
      <ellipse cx="140" cy="80" rx="140" ry="26" fill="none" stroke="#3a3532"/>
      <ellipse cx="140" cy="140" rx="140" ry="26" fill="none" stroke="#3a3532"/>
      <ellipse cx="140" cy="200" rx="140" ry="26" fill="none" stroke="#3a3532"/>
      <ellipse cx="140" cy="240" rx="140" ry="26" fill="#1a1614"/>
      <!-- face -->
      <circle cx="100" cy="100" r="8" fill="#e86454"/>
      <circle cx="180" cy="100" r="8" fill="#e86454"/>
      <path d="M 100 150 Q 140 170 180 150" stroke="#e86454" stroke-width="4" fill="none" stroke-linecap="round"/>
      <!-- hand/port -->
      <rect x="270" y="110" width="48" height="30" rx="8" fill="#c74634"/>
      <circle cx="322" cy="125" r="14" fill="#e86454" filter="url(#glow)"/>
    </g>
  `;
  const rightDb = `
    <g transform="translate(1100,540)" filter="url(#softshadow)">
      <ellipse cx="140" cy="260" rx="140" ry="14" fill="#1a1614"/>
      <ellipse cx="140" cy="20" rx="140" ry="26" fill="#2b2623" stroke="#3a3532"/>
      <rect x="0" y="20" width="280" height="220" fill="#2b2623" stroke="#3a3532"/>
      <ellipse cx="140" cy="80" rx="140" ry="26" fill="none" stroke="#3a3532"/>
      <ellipse cx="140" cy="140" rx="140" ry="26" fill="none" stroke="#3a3532"/>
      <ellipse cx="140" cy="200" rx="140" ry="26" fill="none" stroke="#3a3532"/>
      <ellipse cx="140" cy="240" rx="140" ry="26" fill="#1a1614"/>
      <!-- face -->
      <circle cx="100" cy="100" r="8" fill="#e86454"/>
      <circle cx="180" cy="100" r="8" fill="#e86454"/>
      <path d="M 100 150 Q 140 170 180 150" stroke="#e86454" stroke-width="4" fill="none" stroke-linecap="round"/>
      <!-- hand/port to left -->
      <rect x="-38" y="110" width="48" height="30" rx="8" fill="#c74634"/>
      <circle cx="-14" cy="125" r="14" fill="#e86454" filter="url(#glow)"/>
    </g>
  `;
  // Figure-8 energy loop between them
  const loop = `
    <g filter="url(#glow)">
      <path d="M 862 665 C 910 620 950 620 980 665 C 1010 710 1050 710 1098 665" stroke="#c74634" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M 1098 665 C 1050 620 1010 620 980 665 C 950 710 910 710 862 665" stroke="#e86454" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.6"/>
    </g>
    <g>
      <circle cx="910" cy="640" r="5" fill="#faf7f2"/>
      <circle cx="1050" cy="690" r="5" fill="#faf7f2"/>
      <circle cx="980" cy="665" r="4" fill="#e86454"/>
    </g>
  `;
  return wrap(`
    ${categoryTag('GOLDENGATE')}
    ${title(['Bidirectional.', 'Both directions.', 'All the time.'], 88, 250, 74)}
    ${leftDb}
    ${rightDb}
    ${loop}
  `);
}

function sceneOra01017() {
  // Massive vault door with red light leaking + alarm beams
  const door = `
    <g transform="translate(1080,360)" filter="url(#softshadow)">
      <!-- Door frame -->
      <rect x="-20" y="-20" width="540" height="660" rx="24" fill="#1a1614" stroke="#3a3532" stroke-width="3"/>
      <!-- Door body -->
      <rect x="0" y="0" width="500" height="620" rx="16" fill="url(#redcard)"/>
      <rect x="10" y="10" width="480" height="600" rx="12" fill="none" stroke="#faf7f2" stroke-opacity="0.25" stroke-width="2"/>
      <!-- rivets -->
      ${Array.from({length: 8}, (_, i) => `<circle cx="40" cy="${60 + i * 70}" r="7" fill="#faf7f2" opacity="0.4"/>`).join('')}
      ${Array.from({length: 8}, (_, i) => `<circle cx="460" cy="${60 + i * 70}" r="7" fill="#faf7f2" opacity="0.4"/>`).join('')}
      <!-- central dial -->
      <circle cx="250" cy="310" r="110" fill="#1a1614" stroke="#faf7f2" stroke-opacity="0.4" stroke-width="4"/>
      <circle cx="250" cy="310" r="80" fill="#0d0c0a"/>
      <g stroke="#faf7f2" stroke-width="3">
        <line x1="250" y1="250" x2="250" y2="240"/>
        <line x1="250" y1="380" x2="250" y2="370"/>
        <line x1="190" y1="310" x2="200" y2="310"/>
        <line x1="310" y1="310" x2="300" y2="310"/>
      </g>
      <!-- dial handle -->
      <rect x="238" y="240" width="24" height="140" rx="12" fill="#faf7f2" opacity="0.9"/>
      <circle cx="250" cy="310" r="14" fill="#c74634"/>
      <!-- warning glyph at top -->
      <g transform="translate(200, 70)">
        <path d="M 50 0 L 100 80 L 0 80 Z" fill="#faf7f2" stroke="#0d0c0a" stroke-width="4"/>
        <text x="50" y="64" text-anchor="middle" font-family="Inter, sans-serif" font-size="50" font-weight="900" fill="#0d0c0a">!</text>
      </g>
    </g>
    <!-- Red light leaking from door edges -->
    <rect x="1060" y="340" width="580" height="700" rx="28" fill="#c74634" opacity="0.25" filter="url(#glow)"/>
  `;
  // Alarm beams (cones from keyhole)
  const beams = `
    <g opacity="0.35">
      <path d="M 1330 670 L 450 420 L 1330 700 Z" fill="#e86454"/>
      <path d="M 1330 670 L 520 900 L 1330 700 Z" fill="#e86454"/>
    </g>
  `;
  // Little DBA-bot standing to the left with oversized key
  const bot = `
    <g transform="translate(540, 720)" filter="url(#softshadow)">
      <!-- body -->
      <rect x="-50" y="0" width="100" height="140" rx="14" fill="#2b2623" stroke="#3a3532" stroke-width="2"/>
      <!-- head -->
      <rect x="-40" y="-70" width="80" height="70" rx="14" fill="#2b2623" stroke="#3a3532" stroke-width="2"/>
      <circle cx="-16" cy="-42" r="6" fill="#faf7f2"/>
      <circle cx="16" cy="-42" r="6" fill="#faf7f2"/>
      <path d="M -14 -18 Q 0 -10 14 -18" stroke="#faf7f2" stroke-width="3" fill="none" stroke-linecap="round"/>
      <!-- antenna -->
      <line x1="0" y1="-70" x2="0" y2="-92" stroke="#c74634" stroke-width="3"/>
      <circle cx="0" cy="-95" r="5" fill="#e86454" filter="url(#glow)"/>
      <!-- arm reaching right with oversized key -->
      <rect x="40" y="40" width="160" height="24" rx="10" fill="#3a3532"/>
      <!-- key -->
      <g transform="translate(200, 52)" fill="#c74634">
        <circle r="22"/>
        <rect x="20" y="-6" width="60" height="12" rx="2"/>
        <rect x="60" y="-12" width="8" height="14"/>
        <rect x="72" y="-14" width="8" height="18"/>
      </g>
      <!-- base -->
      <rect x="-54" y="134" width="108" height="14" rx="4" fill="#1a1614"/>
    </g>
  `;
  return wrap(`
    ${categoryTag('ADVANCED DBA')}
    ${title(['ORA-01017 at 2am.', 'The door won\'t', 'open.'], 88, 250, 70)}
    ${beams}
    ${door}
    ${bot}
  `);
}

function sceneChopt() {
  // Low-angle control panel with glowing toggle switches + bot on ladder
  const panel = `
    <g transform="translate(300,600) skewY(-4)" filter="url(#softshadow)">
      <!-- panel surface -->
      <rect x="0" y="0" width="1320" height="280" rx="20" fill="#2b2623" stroke="#3a3532" stroke-width="2"/>
      <rect x="0" y="0" width="1320" height="280" rx="20" fill="url(#creamgrad)" opacity="0.03"/>
      <!-- recessed area -->
      <rect x="30" y="30" width="1260" height="220" rx="14" fill="#1a1614" stroke="#3a3532"/>
      <!-- toggle switches row -->
    </g>
  `;
  // Six big toggle switches in two states
  const switches = [0, 1, 2, 3, 4, 5].map(i => {
    const on = [true, false, true, true, false, true][i];
    const x = 420 + i * 170;
    const y = 650;
    return `
      <g transform="translate(${x},${y})" filter="url(#softshadow)">
        <!-- base plate -->
        <rect x="-60" y="-20" width="120" height="200" rx="16" fill="#3a3532" stroke="#1a1614" stroke-width="2"/>
        <!-- track -->
        <rect x="-30" y="10" width="60" height="150" rx="30" fill="#0d0c0a" stroke="#1a1614"/>
        <!-- knob -->
        <circle cx="0" cy="${on ? 40 : 130}" r="34" fill="${on ? 'url(#redcard)' : '#3a3532'}" stroke="${on ? '#faf7f2' : '#5a4e47'}" stroke-opacity="0.4" stroke-width="2"/>
        ${on ? `<circle cx="0" cy="40" r="8" fill="#faf7f2" opacity="0.9"/>` : ''}
        ${on ? `<circle cx="0" cy="40" r="60" fill="#c74634" opacity="0.25" filter="url(#glow)"/>` : ''}
        <!-- LED -->
        <circle cx="0" cy="180" r="5" fill="${on ? '#e86454' : '#4a4138'}"/>
      </g>
    `;
  }).join('\n');
  // Small bot on a ladder
  const bot = `
    <g transform="translate(120, 720)" filter="url(#softshadow)">
      <!-- ladder -->
      <rect x="40" y="0" width="6" height="240" fill="#3a3532"/>
      <rect x="130" y="0" width="6" height="240" fill="#3a3532"/>
      <rect x="40" y="40" width="96" height="5" fill="#3a3532"/>
      <rect x="40" y="100" width="96" height="5" fill="#3a3532"/>
      <rect x="40" y="160" width="96" height="5" fill="#3a3532"/>
      <!-- bot -->
      <g transform="translate(60, -70)">
        <rect x="0" y="0" width="80" height="110" rx="12" fill="#2b2623" stroke="#3a3532" stroke-width="2"/>
        <rect x="8" y="-50" width="64" height="56" rx="12" fill="#2b2623" stroke="#3a3532" stroke-width="2"/>
        <circle cx="26" cy="-22" r="6" fill="#faf7f2"/>
        <circle cx="54" cy="-22" r="6" fill="#faf7f2"/>
        <path d="M 26 -2 Q 40 6 54 -2" stroke="#faf7f2" stroke-width="3" fill="none" stroke-linecap="round"/>
        <line x1="40" y1="-50" x2="40" y2="-70" stroke="#c74634" stroke-width="3"/>
        <circle cx="40" cy="-72" r="4" fill="#e86454"/>
      </g>
    </g>
  `;
  return wrap(`
    ${categoryTag('ADVANCED DBA')}
    ${title(['Which option do', 'you actually', 'have licensed?'], 88, 250, 70)}
    ${panel}
    ${switches}
    ${bot}
  `);
}

function sceneRman() {
  // Huge progress gauge + a watching DBA-bot in a cockpit
  const gauge = `
    <g transform="translate(760, 440)" filter="url(#softshadow)">
      <rect x="-20" y="-20" width="700" height="260" rx="28" fill="#1a1614" stroke="#3a3532" stroke-width="3"/>
      <rect x="0" y="0" width="660" height="220" rx="16" fill="#0d0c0a" stroke="#3a3532" stroke-width="2"/>
      <!-- status LED -->
      <circle cx="24" cy="-44" r="6" fill="#e86454"/>
      <rect x="40" y="-52" width="84" height="16" rx="4" fill="#2b2623"/>
      <rect x="140" y="-52" width="60" height="16" rx="4" fill="#2b2623"/>
      <!-- main progress track -->
      <rect x="40" y="80" width="580" height="60" rx="30" fill="#1a1614" stroke="#3a3532"/>
      <rect x="40" y="80" width="440" height="60" rx="30" fill="url(#redcard)"/>
      <rect x="40" y="80" width="440" height="60" rx="30" fill="#c74634" opacity="0.4" filter="url(#glow)"/>
      <rect x="474" y="72" width="12" height="76" rx="4" fill="#faf7f2" opacity="0.9"/>
      <text x="520" y="128" font-family="Inter, sans-serif" font-size="44" font-weight="800" fill="#faf7f2" letter-spacing="-1">76%</text>
      <!-- tick marks -->
      <g stroke="#3a3532" stroke-width="2">
        <line x1="40" y1="160" x2="40" y2="175"/>
        <line x1="185" y1="160" x2="185" y2="175"/>
        <line x1="330" y1="160" x2="330" y2="175"/>
        <line x1="475" y1="160" x2="475" y2="175"/>
        <line x1="620" y1="160" x2="620" y2="175"/>
      </g>
      <!-- rows-processed sub-meter above main bar -->
      <rect x="40" y="20" width="580" height="40" rx="8" fill="#1a1614" stroke="#3a3532"/>
      <rect x="40" y="20" width="380" height="40" rx="8" fill="#c74634" opacity="0.25"/>
      ${Array.from({ length: 11 }, (_, i) => {
        const op = i < 8 ? 1 : (0.3 + (10 - i) * 0.12);
        return `<rect x="${60 + i * 22}" y="32" width="10" height="16" fill="#e86454" opacity="${op.toFixed(2)}"/>`;
      }).join('')}
    </g>
  `;
  const bot = `
    <g transform="translate(260, 580)" filter="url(#softshadow)">
      <rect x="-55" y="0" width="110" height="150" rx="14" fill="#2b2623" stroke="#3a3532" stroke-width="2"/>
      <rect x="-45" y="-85" width="90" height="80" rx="16" fill="#2b2623" stroke="#3a3532" stroke-width="2"/>
      <rect x="-36" y="-70" width="72" height="50" rx="6" fill="#0d0c0a" stroke="#c74634" stroke-opacity="0.6"/>
      <circle cx="-16" cy="-48" r="8" fill="#e86454"/>
      <circle cx="-16" cy="-48" r="3" fill="#faf7f2"/>
      <circle cx="16" cy="-48" r="8" fill="#e86454"/>
      <circle cx="16" cy="-48" r="3" fill="#faf7f2"/>
      <line x1="0" y1="-85" x2="0" y2="-110" stroke="#c74634" stroke-width="3"/>
      <circle cx="0" cy="-114" r="5" fill="#e86454" filter="url(#glow)"/>
      <rect x="-30" y="20" width="60" height="28" rx="4" fill="#0d0c0a" stroke="#c74634" stroke-opacity="0.5"/>
      <circle cx="-18" cy="34" r="4" fill="#e86454"/>
      <circle cx="-2" cy="34" r="4" fill="#c5720a"/>
      <circle cx="14" cy="34" r="4" fill="#2f7e4b"/>
      <rect x="-60" y="144" width="120" height="14" rx="4" fill="#1a1614"/>
    </g>
  `;
  const tapes = `
    <g opacity="0.6">
      <g transform="translate(1580, 640)">
        <rect x="0" y="0" width="140" height="80" rx="8" fill="#2b2623" stroke="#3a3532"/>
        <circle cx="40" cy="40" r="20" fill="#1a1614" stroke="#3a3532"/>
        <circle cx="100" cy="40" r="20" fill="#1a1614" stroke="#3a3532"/>
        <circle cx="40" cy="40" r="8" fill="#c74634"/>
        <circle cx="100" cy="40" r="8" fill="#c74634"/>
      </g>
      <g transform="translate(1600, 730)">
        <rect x="0" y="0" width="140" height="80" rx="8" fill="#2b2623" stroke="#3a3532"/>
        <circle cx="40" cy="40" r="20" fill="#1a1614" stroke="#3a3532"/>
        <circle cx="100" cy="40" r="20" fill="#1a1614" stroke="#3a3532"/>
        <circle cx="40" cy="40" r="8" fill="#c74634"/>
        <circle cx="100" cy="40" r="8" fill="#c74634"/>
      </g>
    </g>
  `;
  return wrap(`
    ${categoryTag('SCRIPTS')}
    ${title(['RMAN backup.', 'Watch it finish', 'in real time.'], 88, 250, 70)}
    ${tapes}
    ${gauge}
    ${bot}
  `);
}

// ---------- Render all ----------

const SCENES = [
  { slug: 'gc-buffer-busy-acquired-rac', svg: sceneGcBufferBusy },
  { slug: 'online-partition-dbms-redefinition', svg: sceneRedef },
  { slug: 'awr-is-talking-are-you-listening', svg: sceneAwr },
  { slug: 'dbcs-to-exacs-migration-untold-story', svg: sceneDbcsExacs },
  { slug: 'bidirectional-replication-12c', svg: sceneReplication },
  { slug: 'fix-ora-01017-asmsnmp-missing', svg: sceneOra01017 },
  { slug: 'enable-disable-options-with-chopt', svg: sceneChopt },
  { slug: 'rman-backup-progress-monitoring', svg: sceneRman },
];

// Reseed RNG deterministically so runs are reproducible
Math.random = seeded(42);

for (const { slug, svg } of SCENES) {
  const svgStr = svg();
  const svgPath = path.join(OUT, `${slug}.svg`);
  const pngPath = path.join(OUT, `${slug}.png`);
  await writeFile(svgPath, svgStr);
  await sharp(Buffer.from(svgStr))
    .resize(W, H, { fit: 'contain', background: { r: 13, g: 12, b: 10, alpha: 1 } })
    .png({ compressionLevel: 9, quality: 95 })
    .toFile(pngPath);
  console.log(`  ✓ ${slug}  (${W}x${H})  →  ${pngPath}`);
}

console.log(`\nAll ${SCENES.length} covers rendered to ${OUT}`);
