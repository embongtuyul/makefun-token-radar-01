// Render the dashboard's three screenshots with headless Chromium.
//
// Serves the output directory main.ts wrote on 127.0.0.1, opens the page
// three ways — the board, one protocol's detail view, a filtered view —
// captures each at 1440x900, and converts the captures to JPEGs in the
// 300-350 KB band the dossier wants.
//
// Usage: node tools/shoot.mjs <output-dir> <shots-dir>
//   output-dir: the directory main.ts wrote (board.json lives at its root)
//   shots-dir:  where 1-board.jpg, 2-detail.jpg and 3-filtered.jpg go

import { get } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = process.argv[2];
const shotsDir = process.argv[3];
if (!outDir || !shotsDir) {
  process.stderr.write('usage: node tools/shoot.mjs <output-dir> <shots-dir>\n');
  process.exit(2);
}

const board = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
const topSlug = board.rows[0].slug;
const topCategory = board.rows[0].category;

// Serve the output directory with Python's static server: it binds every
// interface and headless Chromium reaches it reliably, where an in-process
// Node server left Chromium hanging without ever requesting the page.
const PORT = 8891;
const py = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', outDir], {
  stdio: 'ignore',
});

function waitForServer(tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = get(`http://127.0.0.1:${PORT}/dashboard/index.html`, (res) => {
        res.resume();
        res.on('end', () => (res.statusCode === 200 ? resolve() : retry()));
      });
      req.on('error', retry);
      function retry() {
        if (tries-- > 0) setTimeout(tick, 200);
        else reject(new Error('static server did not come up'));
      }
    };
    tick();
  });
}

const chrome =
  process.env.CHROME_BIN ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;

function shot(url, png) {
  const r = spawnSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1440,1050',
      '--virtual-time-budget=6000',
      `--screenshot=${png}`,
      url,
    ],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (r.status !== 0) {
    process.stderr.write(`chromium failed for ${url}:\n${r.stderr}\n`);
    process.exit(1);
  }
  if (!existsSync(png)) {
    process.stderr.write(`chromium wrote no screenshot for ${url}\n`);
    process.exit(1);
  }
}

function toJpeg(png, jpg) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const r = spawnSync('python3', [join(here, 'tojpeg.py'), png, jpg], { encoding: 'utf8', timeout: 120000 });
  process.stdout.write(r.stdout);
  if (r.status !== 0) {
    process.stderr.write(r.stderr);
    process.exit(1);
  }
}

waitForServer()
  .then(() => {
    const base = `http://127.0.0.1:${PORT}/dashboard/index.html`;
    const tmp = join(shotsDir, '.tmp-png');
    mkdirSync(tmp, { recursive: true });
    mkdirSync(shotsDir, { recursive: true });
    try {
      const views = [
        ['1-board', `${base}`],
        ['2-detail', `${base}#slug=${encodeURIComponent(topSlug)}`],
        ['3-filtered', `${base}#cat=${encodeURIComponent(topCategory)}`],
      ];
      for (const [name, url] of views) {
        const png = join(tmp, `${name}.png`);
        const jpg = join(shotsDir, `${name}.jpg`);
        shot(url, png);
        toJpeg(png, jpg);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      py.kill();
    }
    process.stdout.write(`shots: board (top ${topSlug}), detail (${topSlug}), filtered (${topCategory})\n`);
  })
  .catch((err) => {
    py.kill();
    process.stderr.write(`shoot: ${err.message}\n`);
    process.exit(1);
  });
