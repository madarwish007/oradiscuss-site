// ===========================================================================
// THE SHOWCASE CAPTURE RIG.
//
// One headless Chrome, driven over CDP, capturing a batch of local HTML files
// to PNG at an exact size. Everything here that looks over-careful is a
// platform bug that has already cost this project an hour:
//
//  1. Chrome 150 removed old headless, so the `--screenshot` command line flag
//     captures the VIEWPORT ONLY. Full page therefore means: measure
//     scrollHeight, resize the viewport to it, and capture. There is no flag
//     that does this.
//  2. `Page.captureScreenshot` with captureBeyondViewport HANGS above roughly
//     6000 device pixels. It is never used here. Anything taller than
//     tileMaxCss is captured as tiles and stitched by stitch.py.
//  3. `Emulation.setDeviceMetricsOverride` REJECTS fractional heights, and
//     scrollHeight can be fractional, so every derived dimension is
//     Math.ceil'd before it is sent.
//  4. Chrome 151 headless WRITES the `--screenshot` file and then LINGERS
//     instead of exiting, which deadlocks subprocess.run past any timeout.
//     This rig never uses `--screenshot`: it holds the browser open on purpose
//     and kills it itself, so the linger has nothing to hang on.
//  5. Exact sizes come from deviceScaleFactor 2 with an integer CSS width and
//     height, giving exactly 2W x 2H device pixels. Any resize after that goes
//     through stitch.py, which uses LANCZOS.
//
// The Chrome binary is SEARCHED FOR, never assumed. Set CHROME_PATH to
// override.
//
// Usage: node scripts/showcase/capture.mjs <jobs.json>
//
//   { "dsf": 2, "tileMaxCss": 2400,
//     "jobs": [ { "file": "...", "out": "...", "width": 1152,
//                 "height": "full" | 900 } ] }
// ===========================================================================

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL, fileURLToPath } from 'node:url';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

export function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (c && existsSync(c)) return c;
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const p = execFileSync('command', ['-v', name], { shell: '/bin/bash', encoding: 'utf8' }).trim();
      if (p && existsSync(p)) return p;
    } catch { /* not on PATH, try the next one */ }
  }
  throw new Error(
    'no Chrome binary found. Set CHROME_PATH to the executable, for example\n' +
    '  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------
// A minimal CDP client over the native WebSocket that node 22 ships. A
// dependency would have been the obvious move and the wrong one: this rig has
// to keep working for a seat that clones the repo in a year and runs it once.
// ---------------------------------------------------------------------------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? null)})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const key = `${msg.sessionId ?? ''}:${msg.method}`;
        const list = this.handlers.get(key);
        if (list) for (const fn of list.splice(0)) fn(msg.params);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot open CDP socket ${url}`)), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.next++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method, sessionId) {
    const key = `${sessionId ?? ''}:${method}`;
    return new Promise((resolve) => {
      if (!this.handlers.has(key)) this.handlers.set(key, []);
      this.handlers.get(key).push(resolve);
    });
  }
}

export async function launchChrome({ width = 1200, height = 900, dsf = 2 } = {}) {
  const bin = findChrome();
  const port = await freePort();
  // A FRESH profile per run, always. A reused headless profile re-measures a
  // cached page and the fix looks unapplied, which has burned this project on
  // preview captures before.
  const profile = mkdtempSync(join(tmpdir(), 'odc-showcase-chrome-'));
  const child = spawn(bin, [
    '--headless',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dsf}`,
    '--hide-scrollbars',
    '--disable-gpu',
    '--font-render-hinting=none',
    '--disable-lcd-text',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-sync',
    '--mute-audio',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    await sleep(100);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) version = await res.json();
    } catch { /* not listening yet */ }
  }
  if (!version) {
    child.kill('SIGKILL');
    throw new Error(`Chrome did not open a debugging port within 10s (${bin})`);
  }

  const cdp = await CDP.connect(version.webSocketDebuggerUrl);
  return {
    bin,
    version: version.Browser,
    cdp,
    async close() {
      try { await cdp.send('Browser.close'); } catch { /* it may already be gone */ }
      await sleep(150);
      // Chrome 151 lingers. Do not wait politely for it.
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

async function captureOne(cdp, job, { dsf, tileMaxCss }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  try {
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: job.width, height: 900, deviceScaleFactor: dsf, mobile: false,
    }, sessionId);

    const loaded = cdp.once('Page.loadEventFired', sessionId);
    await cdp.send('Page.navigate', { url: pathToFileURL(job.file).href }, sessionId);
    await loaded;

    // Fonts settle before anything is measured. A measurement taken while a
    // fallback face is still swapping gives a height that is wrong by a row.
    await cdp.send('Runtime.evaluate', {
      expression: 'document.fonts.ready.then(() => true)',
      awaitPromise: true,
    }, sessionId);
    await sleep(120);

    const measure = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      })`,
      returnByValue: true,
    }, sessionId);
    const measured = JSON.parse(measure.result.value);

    // setDeviceMetricsOverride rejects fractional heights, and scrollHeight is
    // fractional whenever a line box is.
    const fullHeight = Math.ceil(measured.h);
    let targetHeight;
    if (job.height === 'full') {
      targetHeight = fullHeight;
    } else if (typeof job.height === 'object' && job.height.selector) {
      // A crop that ends at a boundary IN THE PAGE rather than at a magic
      // pixel row. A fixed number goes stale the first time a section is added
      // and the crop then slices a table in half, which reads as a rendering
      // fault rather than as a crop.
      const { selector, index = 0, offset = 0 } = job.height;
      const probe = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
          if (!el) return -1;
          return el.getBoundingClientRect().top + window.scrollY + ${offset};
        })()`,
        returnByValue: true,
      }, sessionId);
      if (probe.result.value < 0) {
        throw new Error(`${job.out}: no element matched ${selector}[${index}] to crop at`);
      }
      targetHeight = Math.min(fullHeight, Math.ceil(probe.result.value));
    } else {
      targetHeight = Math.ceil(job.height);
    }

    if (measured.w > job.width + 1) {
      throw new Error(
        `${job.out}: page is ${Math.ceil(measured.w)} CSS px wide inside a ${job.width} px viewport. ` +
        'A showcase asset never pans horizontally. Fix the template, do not widen the capture.',
      );
    }

    mkdirSync(dirname(job.out), { recursive: true });

    if (targetHeight <= tileMaxCss) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: job.width, height: targetHeight, deviceScaleFactor: dsf, mobile: false,
      }, sessionId);
      await sleep(120);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
      writeFileSync(job.out, Buffer.from(shot.data, 'base64'));
      return { tiles: 1, cssWidth: job.width, cssHeight: targetHeight };
    }

    // Tiled. The viewport is held at tileMaxCss and the page is scrolled, so
    // no single capture ever approaches the captureBeyondViewport hazard.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: job.width, height: tileMaxCss, deviceScaleFactor: dsf, mobile: false,
    }, sessionId);
    const tileDir = mkdtempSync(join(tmpdir(), 'odc-showcase-tiles-'));
    const tiles = [];
    let y = 0;
    while (y < targetHeight) {
      const take = Math.min(tileMaxCss, targetHeight - y);
      await cdp.send('Runtime.evaluate', { expression: `window.scrollTo(0, ${y}); true`, returnByValue: true }, sessionId);
      await sleep(90);
      // FRACTIONAL, deliberately. The final tile is clamped by the end of the
      // document and that clamp routinely lands on a half CSS pixel: rounding
      // it here pasted the whole last band one device pixel out of place, a
      // shift invisible to the eye and obvious to a pixel diff.
      const scrolled = await cdp.send('Runtime.evaluate', {
        expression: 'window.scrollY', returnByValue: true,
      }, sessionId);
      const actualY = scrolled.result.value;
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
      const tilePath = join(tileDir, `tile-${tiles.length}.png`);
      writeFileSync(tilePath, Buffer.from(shot.data, 'base64'));
      // Where the page REALLY landed, never where we asked it to go. The last
      // tile is always clamped by the end of the document, and a stitcher that
      // trusts the requested offset pastes the wrong rows at the bottom of the
      // page. That bug shipped in the first version of stitch.py and was found
      // by scripts/showcase/verify-tiling.mjs, not by looking at the code.
      tiles.push({ path: tilePath, y: actualY });
      y += take;
    }

    const plan = join(tileDir, 'plan.json');
    writeFileSync(plan, JSON.stringify({
      out: job.out, dsf, cssWidth: job.width, cssHeight: targetHeight, tiles,
    }, null, 2));
    execFileSync('python3', [join(dirname(fileURLToPath(import.meta.url)), 'stitch.py'), 'stitch', plan], { stdio: 'inherit' });
    rmSync(tileDir, { recursive: true, force: true });
    return { tiles: tiles.length, cssWidth: job.width, cssHeight: targetHeight };
  } finally {
    try { await cdp.send('Target.closeTarget', { targetId }); } catch { /* fine */ }
  }
}

export async function captureBatch(spec) {
  const dsf = spec.dsf ?? 2;
  const tileMaxCss = spec.tileMaxCss ?? 2400;
  const browser = await launchChrome({ dsf, width: spec.jobs[0]?.width ?? 1200 });
  const results = [];
  try {
    for (const job of spec.jobs) {
      const r = await captureOne(browser.cdp, job, { dsf, tileMaxCss });
      results.push({ out: job.out, ...r, dsf });
      process.stderr.write(`capture: ${job.out} ${r.cssWidth}x${r.cssHeight} css, ${r.tiles} tile(s)\n`);
    }
  } finally {
    await browser.close();
  }
  return { chrome: browser.version, results };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const specPath = process.argv[2];
  if (!specPath) {
    process.stderr.write('usage: node scripts/showcase/capture.mjs <jobs.json>\n');
    process.exit(2);
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const out = await captureBatch(spec);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
