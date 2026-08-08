// ===========================================================================
// THE SHOWCASE BUILD. One command, no manual steps.
//
//   npm run build:showcase        (or: node scripts/showcase/build.mjs)
//
// It runs the REAL pack, captures the REAL outputs, frames them to the
// standard in Showcase/STANDARDS.md, cuts the terminal-to-report video, and
// writes Showcase/MANIFEST.json.
//
// THE HONESTY RULE THIS FILE ENFORCES.
// The Health Check pack has never been run against a real Oracle database.
// Every asset it produces is rendered from a synthetic lab collection, and the
// sentence saying so is a constant here, burned into every framed image, and
// repeated on every manifest entry. It is a constant precisely so that nobody
// can soften it in one place and leave the others agreeing.
//
// THE MANIFEST IS GENERATED, NEVER HAND KEPT. The build declares what it
// produced, then walks Showcase/samples/ and REFUSES to write a manifest that
// disagrees with the directory. test/showcase.test.js then checks the same
// thing again independently, because this repo has twice shipped a fan-out
// step that named its inputs and silently dropped the one added afterwards.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync,
} from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureBatch } from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SHOWCASE = join(REPO, 'Showcase');
const SAMPLES = join(SHOWCASE, 'samples', 'healthcheck');
const TEMPLATES = join(HERE, 'templates');
const WORK = join(REPO, '.showcase-work');

// ---------------------------------------------------------------------------
// THE STANDARD, in numbers. Every one of these is stated in
// Showcase/STANDARDS.md and asserted by test/showcase.test.js. Change them in
// all three or the build fails, which is the intended amount of friction.
// ---------------------------------------------------------------------------
const STD = {
  dsf: 2,
  canvasCssWidth: 1280,
  framePadCss: 64,
  shotCssWidth: 1152,
  tileMaxCss: 2400,
  // The hero crop ends at the top of the third section heading in the report,
  // measured in the page, so a new section can never slice a table in half.
  summaryCrop: { selector: 'h2', index: 2, offset: -20 },
  videoCssWidth: 1280,
  videoCssHeight: 720,
  terminalCssHeight: 340,
  videoWidth: 1280,
  videoHeight: 720,
  gifWidth: 800,
  gifHeight: 450,
};

// THE PROVENANCE SENTENCE. Do not soften it. It is asserted verbatim in
// Showcase/STANDARDS.md, in every manifest entry, and in the frame template
// output that gets burned into the pixels.
const PROVENANCE =
  'Sample rendered from a synthetic lab collection. Not output from a real Oracle database.';

const FIELD_TEST_STATUS =
  'The OraDiscuss Health Check pack has not been run against a real Oracle database. ' +
  "The founder's field test is the designed gate for that. Until it is passed, every asset here " +
  'is rendered from scripts/showcase/lab/healthcheck/collection.txt.';

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function template(name, vars) {
  let out = readFileSync(join(TEMPLATES, name), 'utf8');
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(String(v));
  const left = out.match(/\{\{[A-Z_]+\}\}/);
  if (left) throw new Error(`${name}: placeholder ${left[0]} was never filled`);
  return out;
}

function pngSize(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

// ---------------------------------------------------------------------------
// A very small JSON highlighter, with a round trip assertion. Cosmetic markup
// that silently ate a character would put a wrong number on a sales asset, so
// the tags are stripped again and the result compared to the input.
// ---------------------------------------------------------------------------
function highlightJson(src) {
  const escaped = esc(src);
  const marked = escaped
    .replace(/"([^"\n]*)"(\s*):/g, '<span class="k">"$1"</span>$2:')
    .replace(/:(\s*)"([^"\n]*)"/g, ':$1<span class="s">"$2"</span>')
    .replace(/:(\s*)(-?\d+(?:\.\d+)?|true|false|null)/g, ':$1<span class="n">$2</span>');
  const roundTrip = marked.replace(/<\/?span[^>]*>/g, '');
  if (roundTrip !== escaped) throw new Error('the JSON highlighter altered the text it was given');
  return marked;
}

// ===========================================================================
// STEP 1: the real pack run.
// ===========================================================================
function renderSample() {
  rmSync(SAMPLES, { recursive: true, force: true });
  mkdirSync(join(SAMPLES, 'images'), { recursive: true });
  mkdirSync(join(SAMPLES, 'video'), { recursive: true });
  const out = sh('bash', ['scripts/showcase/render-sample.sh', relative(REPO, SAMPLES)]);
  process.stdout.write(out);
  const collection = process.env.ODC_SHOWCASE_COLLECTION
    || 'scripts/showcase/lab/healthcheck/collection.txt';
  return {
    report: join(SAMPLES, 'report.html'),
    briefing: join(SAMPLES, 'briefing.json'),
    runLog: readFileSync(join(SAMPLES, 'run.log'), 'utf8').trimEnd().split('\n'),
    command: readFileSync(join(SAMPLES, 'command.txt'), 'utf8').trimEnd(),
    exitCode: Number(readFileSync(join(SAMPLES, 'exit-code.txt'), 'utf8').trim()),
    collection,
  };
}

// ===========================================================================
// STEP 2: the pages that get captured.
// ===========================================================================
function buildCodePage(briefingPath) {
  const raw = readFileSync(briefingPath, 'utf8');
  const pretty = JSON.stringify(JSON.parse(raw), null, 2);
  const lines = pretty.split('\n');
  const shown = lines.slice(0, 44);
  const hidden = lines.length - shown.length;
  return template('code.html', {
    TITLE: 'briefing.json',
    PANEL_W: STD.shotCssWidth,
    FONT_PX: 12,
    FILENAME: 'briefing.json',
    BYTES: `${Buffer.byteLength(raw)} bytes`,
    ROLE: 'the second output, for your AI',
    CODE: highlightJson(shown.join('\n')),
    MORE: `plus ${hidden} more lines: every check with its status, detail and metrics, `
      + 'and the prompt-ready summary block. The whole file ships beside this image.',
  });
}

function buildFramePage({ imgSrc, imgCssWidth, tag, title, detail }) {
  return template('frame.html', {
    TITLE: title,
    CANVAS_W: STD.canvasCssWidth,
    PAD: STD.framePadCss,
    IMG_W: imgCssWidth,
    IMG_SRC: imgSrc,
    TAG: tag,
    PROVENANCE,
    DETAIL: detail,
  });
}

// One terminal state per reveal step. Generating a file per state is what
// makes a still capture safe: there is no animation to race.
function terminalStates({ command, runLog }) {
  const cmdLines = command.split('\n');
  const states = [];
  const cursor = '<span class="cur"> </span>';
  const promptFor = (i) => (i === 0 ? '<span class="p">$</span> ' : '  ');

  // Typing. The command is revealed in chunks so the frame count stays sane;
  // the text is the command that actually ran, never a prettier one.
  const chunks = [];
  for (const [i, line] of cmdLines.entries()) {
    const step = Math.max(6, Math.ceil(line.length / 5));
    for (let c = step; c < line.length; c += step) chunks.push({ i, c });
    chunks.push({ i, c: line.length });
  }
  for (const { i, c } of chunks) {
    const body = cmdLines
      .slice(0, i)
      .map((l, k) => `${promptFor(k)}<span class="c">${esc(l)}</span>`)
      .concat(`${promptFor(i)}<span class="c">${esc(cmdLines[i].slice(0, c))}</span>${cursor}`)
      .join('\n');
    states.push({ body, hold: 0.09 });
  }

  const fullCmd = cmdLines.map((l, k) => `${promptFor(k)}<span class="c">${esc(l)}</span>`).join('\n');
  states.push({ body: `${fullCmd}\n${cursor}`, hold: 0.55 });

  // Output. Every line below came out of the run, unedited.
  for (let n = 0; n < runLog.length; n++) {
    const shown = runLog.slice(0, n + 1).map((l) => {
      const cls = /overall status: CRIT/.test(l) ? 'crit' : 'm';
      return `<span class="${cls}">${esc(l)}</span>`;
    }).join('\n');
    states.push({ body: `${fullCmd}\n${shown}`, hold: n === runLog.length - 1 ? 1.6 : 0.5 });
  }
  return states;
}

// ===========================================================================
// STEP 3: capture, frame, encode.
// ===========================================================================
async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const run = renderSample();
  process.stdout.write(`build: health_check.sh exited ${run.exitCode}\n`);

  // ---- pages to capture (pass one: the raw surfaces) ----
  const codePage = join(WORK, 'briefing-view.html');
  writeFileSync(codePage, buildCodePage(run.briefing));

  const termStates = terminalStates(run);
  const termPages = termStates.map((st, i) => {
    const p = join(WORK, `term-${String(i).padStart(3, '0')}.html`);
    writeFileSync(p, template('terminal.html', {
      TITLE: `terminal ${i}`,
      STAGE_W: STD.videoCssWidth,
      STAGE_H: STD.videoCssHeight,
      TERM_H: STD.terminalCssHeight,
      FONT_PX: 13,
      CAPTION: 'Health Check pack, run against a synthetic lab collection',
      PATH: '~/oradiscuss-site',
      LINES: st.body,
    }));
    return p;
  });

  const passOne = {
    dsf: STD.dsf,
    tileMaxCss: STD.tileMaxCss,
    jobs: [
      { file: run.report, out: join(WORK, 'raw-report-full.png'), width: STD.shotCssWidth, height: 'full' },
      { file: run.report, out: join(WORK, 'raw-report-summary.png'), width: STD.shotCssWidth, height: STD.summaryCrop },
      { file: codePage, out: join(WORK, 'raw-briefing.png'), width: STD.shotCssWidth, height: 'full' },
      ...termPages.map((p, i) => ({
        file: p, out: join(WORK, `term-${String(i).padStart(3, '0')}.png`),
        width: STD.videoCssWidth, height: STD.videoCssHeight,
      })),
    ],
  };
  const one = await captureBatch(passOne);

  // ---- pass two: the same rig, capturing the branded frames ----
  const framed = [
    {
      raw: 'raw-report-full.png', out: 'healthcheck-report-full@2x.png',
      tag: 'DBA Health Check pack v1.0.0 · report.html',
      title: 'OraDiscuss Health Check sample report',
      detail: 'One run of health_check.sh writes this page and a machine readable briefing from a single collection. '
        + 'The database is only read.',
      caption: 'The complete Health Check report, as one run writes it.',
    },
    {
      raw: 'raw-report-summary.png', out: 'healthcheck-report-summary@2x.png',
      tag: 'DBA Health Check pack v1.0.0 · report.html',
      title: 'OraDiscuss Health Check sample report, summary',
      detail: 'The top of the report: overall status, then every check with its own status and the number behind it.',
      caption: 'The head of the Health Check report, sized for a page hero.',
    },
    {
      raw: 'raw-briefing.png', out: 'healthcheck-briefing@2x.png',
      tag: 'DBA Health Check pack v1.0.0 · briefing.json',
      title: 'OraDiscuss Health Check sample briefing',
      detail: 'The second output of the same run, schema versioned, for the assistant you already pay for. '
        + 'It is written next to the report and transmitted nowhere.',
      caption: 'The opening of briefing.json, the machine readable half of the same run.',
    },
  ];

  const framePages = framed.map((f) => {
    const size = pngSize(join(WORK, f.raw));
    const page = join(WORK, `frame-${f.out.replace(/[^a-z0-9]+/gi, '-')}.html`);
    writeFileSync(page, buildFramePage({
      imgSrc: f.raw,
      imgCssWidth: size.width / STD.dsf,
      tag: f.tag,
      title: f.title,
      detail: f.detail,
    }));
    return { ...f, page };
  });

  const two = await captureBatch({
    dsf: STD.dsf,
    tileMaxCss: STD.tileMaxCss,
    jobs: framePages.map((f) => ({
      file: f.page, out: join(SAMPLES, 'images', f.out), width: STD.canvasCssWidth, height: 'full',
    })),
  });

  // ---- video: terminal states, then a pan down the framed report ----
  const panDir = join(WORK, 'pan');
  sh('python3', [
    join(HERE, 'stitch.py'), 'pan',
    join(SAMPLES, 'images', 'healthcheck-report-full@2x.png'),
    panDir, '64',
    String(STD.canvasCssWidth * STD.dsf), String(STD.videoCssHeight * STD.dsf),
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  const concat = [];
  termStates.forEach((st, i) => {
    concat.push(`file '${join(WORK, `term-${String(i).padStart(3, '0')}.png`)}'`, `duration ${st.hold}`);
  });
  const panFrames = readdirSync(panDir).filter((f) => f.endsWith('.png')).sort();
  panFrames.forEach((f) => {
    concat.push(`file '${join(panDir, f)}'`, 'duration 0.042');
  });
  const lastPan = join(panDir, panFrames[panFrames.length - 1]);
  concat.push(`file '${lastPan}'`, 'duration 2.0', `file '${lastPan}'`);
  const listPath = join(WORK, 'concat.txt');
  writeFileSync(listPath, `${concat.join('\n')}\n`);

  const video = { encoded: false, reason: null, mp4: null, gif: null };
  let ffmpeg = null;
  try {
    ffmpeg = execFileSync('bash', ['-lc', 'command -v ffmpeg'], { encoding: 'utf8' }).trim();
  } catch {
    ffmpeg = null;
  }

  if (!ffmpeg) {
    video.reason = 'ffmpeg is not installed on this machine, so the frames were generated and the encode was NOT run. '
      + `Re-run with ffmpeg present, or encode by hand from ${relative(REPO, listPath)}.`;
    process.stderr.write(`build: ${video.reason}\n`);
  } else {
    const mp4 = join(SAMPLES, 'video', 'healthcheck-run.mp4');
    const gif = join(SAMPLES, 'video', 'healthcheck-run.gif');
    sh(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-vf', `scale=${STD.videoWidth}:${STD.videoHeight}:flags=lanczos,format=yuv420p`,
      '-r', '30', '-c:v', 'libx264', '-profile:v', 'high', '-crf', '20',
      '-movflags', '+faststart', mp4,
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    sh(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-vf', `fps=10,scale=${STD.gifWidth}:${STD.gifHeight}:flags=lanczos,split[a][b];`
        + '[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop', '0', gif,
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    video.encoded = true;
    video.mp4 = mp4;
    video.gif = gif;
  }

  // ---- manifest ----
  const assets = [];
  const add = (path, entry) => assets.push({
    path: relative(REPO, path).split(sep).join('/'),
    bytes: statSync(path).size,
    provenance: PROVENANCE,
    ...entry,
  });

  add(run.report, {
    kind: 'html', pack: 'healthcheck',
    produced_by: 'packs/healthcheck/health_check.sh --render-only',
    caption: 'The Health Check report exactly as the pack writes it.',
  });
  add(run.briefing, {
    kind: 'json', pack: 'healthcheck',
    produced_by: 'packs/healthcheck/health_check.sh --render-only',
    caption: 'The AI briefing written by the same run, from the same collection.',
  });
  add(join(SAMPLES, 'run.log'), {
    kind: 'text', pack: 'healthcheck',
    produced_by: 'stdout and stderr of the run above',
    caption: 'The unedited console output of the run that produced the pair.',
  });
  add(join(SAMPLES, 'command.txt'), {
    kind: 'text', pack: 'healthcheck',
    produced_by: 'scripts/showcase/render-sample.sh',
    caption: 'The exact command that was run. The video shows this and nothing else.',
  });
  add(join(SAMPLES, 'exit-code.txt'), {
    kind: 'text', pack: 'healthcheck',
    produced_by: 'exit status of health_check.sh',
    caption: 'Exit 2 means at least one CRIT, which the sample collection carries on purpose.',
  });
  for (const f of framed) {
    const p = join(SAMPLES, 'images', f.out);
    const size = pngSize(p);
    add(p, {
      kind: 'image', pack: 'healthcheck',
      produced_by: 'scripts/showcase/capture.mjs then the frame template',
      width: size.width, height: size.height, dsf: STD.dsf,
      caption_burned_in: true,
      caption: f.caption,
    });
  }
  if (video.encoded) {
    add(video.mp4, {
      kind: 'video', pack: 'healthcheck',
      produced_by: 'scripts/showcase/build.mjs then ffmpeg',
      width: STD.videoWidth, height: STD.videoHeight,
      caption: 'The run, terminal to report, at the speed it happens.',
    });
    add(video.gif, {
      kind: 'video', pack: 'healthcheck',
      produced_by: 'scripts/showcase/build.mjs then ffmpeg',
      width: STD.gifWidth, height: STD.gifHeight,
      caption: 'The same sequence as a looping GIF, for surfaces that will not play video.',
    });
  }

  // THE REFUSAL. A manifest that disagrees with the directory is worse than no
  // manifest, because it is a list somebody will trust.
  const onDisk = walk(SAMPLES).sort();
  const declared = assets.map((a) => a.path.replace('Showcase/samples/healthcheck/', '')).sort();
  const missing = declared.filter((p) => !onDisk.includes(p));
  const unregistered = onDisk.filter((p) => !declared.includes(p));
  if (missing.length || unregistered.length) {
    throw new Error(
      'the build declared a set of assets that does not match Showcase/samples/healthcheck/.\n'
      + `  declared but not on disk: ${missing.join(', ') || 'none'}\n`
      + `  on disk but not declared: ${unregistered.join(', ') || 'none'}`,
    );
  }

  const manifest = {
    generated_by: 'scripts/showcase/build.mjs',
    standard: 'Showcase/STANDARDS.md',
    regenerate_with: 'npm run build:showcase',
    provenance: PROVENANCE,
    field_test_status: FIELD_TEST_STATUS,
    synthetic_inputs: [
      {
        path: run.collection,
        why: 'The collection every asset here is rendered from. Written by hand to the shape the '
          + 'pack collector emits. No database was contacted.',
      },
      {
        path: 'scripts/showcase/lab/healthcheck/config.env',
        why: 'The pack config used for the render. Invented SID, invented paths, shipped thresholds.',
      },
      {
        path: 'scripts/showcase/lab/healthcheck/bin/lsnrctl',
        why: 'A lab stub standing in for the listener utility, so the listener row reports a state '
          + 'instead of reporting that the capture machine has no Oracle install. It contacts nothing.',
      },
    ],
    capture: {
      chrome: two.chrome,
      device_scale_factor: STD.dsf,
      canvas_css_width: STD.canvasCssWidth,
      frame_padding_css: STD.framePadCss,
      shot_css_width: STD.shotCssWidth,
      tile_max_css: STD.tileMaxCss,
      summary_crop: STD.summaryCrop,
      video: { width: STD.videoWidth, height: STD.videoHeight, gif_width: STD.gifWidth, gif_height: STD.gifHeight },
      video_encoded: video.encoded,
      video_encode_note: video.reason,
    },
    assets,
  };
  writeFileSync(join(SHOWCASE, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  rmSync(WORK, { recursive: true, force: true });

  process.stdout.write('\n=== showcase build complete ===\n');
  for (const a of assets) {
    const size = a.width ? ` ${a.width}x${a.height}` : '';
    process.stdout.write(`  ${a.path}${size} (${a.bytes} bytes)\n`);
  }
  process.stdout.write(`  chrome: ${two.chrome}\n`);
  process.stdout.write(`  first capture pass: ${one.results.length} shots\n`);
  if (!video.encoded) process.stdout.write(`  VIDEO NOT ENCODED: ${video.reason}\n`);
}

await main();
