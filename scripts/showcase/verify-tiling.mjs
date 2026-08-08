// ===========================================================================
// PROOF THAT THE TILING PATH IS A PATH.
//
// The tall page branch of capture.mjs only runs when a page exceeds the tile
// limit, which today no showcase asset does. A branch nobody has watched run
// is a branch that will be broken on the day it is first needed, and by then
// it will look like a Chrome bug rather than like our bug.
//
// So this captures the SAME page twice: once in one shot, and once with the
// tile limit dropped low enough to force many tiles and a stitch. The two
// results must be the same pixels. They are NOT the same bytes, and cannot be:
// one PNG is encoded by Chrome and the other by PIL.
//
//   node scripts/showcase/verify-tiling.mjs [page.html]
//
// Exits 0 when the two agree, 1 when they do not.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureBatch } from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const page = process.argv[2] || join(REPO, 'Showcase', 'samples', 'healthcheck', 'report.html');

if (!existsSync(page)) {
  process.stderr.write(`verify-tiling: no page at ${page}. Run npm run build:showcase first.\n`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'odc-tiling-'));
const single = join(work, 'single.png');
const tiled = join(work, 'tiled.png');
const WIDTH = 1152;

try {
  await captureBatch({ dsf: 2, tileMaxCss: 100000, jobs: [{ file: page, out: single, width: WIDTH, height: 'full' }] });
  await captureBatch({ dsf: 2, tileMaxCss: 400, jobs: [{ file: page, out: tiled, width: WIDTH, height: 'full' }] });
  execFileSync('python3', [join(HERE, 'stitch.py'), 'diff', single, tiled], { stdio: 'inherit' });
  process.stdout.write('verify-tiling: the tiled capture is pixel identical to the single shot capture\n');
} finally {
  rmSync(work, { recursive: true, force: true });
}
