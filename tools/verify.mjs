// Verifies the seven competition gates against one /output directory.
// Usage: node tools/verify.mjs <output-dir> <snapshot.json>
// Exit 0 only when every gate passes.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const [outDir, snapPath] = process.argv.slice(2);
if (!outDir || !snapPath) {
  process.stderr.write('usage: node tools/verify.mjs <output-dir> <snapshot.json>\n');
  process.exit(2);
}

const fails = [];
function gate(name, ok, detail) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}\n`);
  if (!ok) fails.push(name);
}

const board = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));

// 1. board_file — 100+ rows.
gate('board_file', board.rows.length >= 100, `${board.rows.length} rows`);

// 2. sorted_by_value — rank 1..N, implied value never rises with rank.
let sorted = true;
for (let i = 0; i < board.rows.length; i++) {
  const r = board.rows[i];
  if (r.rank !== i + 1) { sorted = false; break; }
  if (i > 0 && r.implied_value_usd > board.rows[i - 1].implied_value_usd) { sorted = false; break; }
}
gate('sorted_by_value', sorted, `rank 1..${board.rows.length}, implied value non-increasing`);

// 3. coverage — every one of the 40 watchlist slugs is ranked.
//    The snapshot's watchlist is a plain list of slug strings.
const watch = snap.watchlist;
const ranked = new Set(board.rows.map((r) => r.slug));
const missing = watch.filter((s) => !ranked.has(s));
gate('coverage', missing.length === 0, `${watch.length - missing.length}/${watch.length} watchlist slugs ranked${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);

// 4. farm_steps — 3-12 steps per row, each 20-600 characters.
let stepsOk = true;
let badStep = '';
for (const r of board.rows) {
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
    stepsOk = false; badStep = `${r.slug}: ${r.farm_steps?.length ?? 0} steps`; break;
  }
  for (const s of r.farm_steps) {
    if (typeof s !== 'string' || s.length < 20 || s.length > 600) {
      stepsOk = false; badStep = `${r.slug}: step ${s.length} chars`; break;
    }
  }
  if (!stepsOk) break;
}
gate('farm_steps', stepsOk, badStep || `all ${board.rows.length} rows carry 3-12 steps of 20-600 chars`);

// 5. dashboard_files — index.html + css + js present, hand-written source
//    under 64KB (data.js is generated board data, not source, so it is
//    checked for links but not counted toward the cap), and no http/https
//    anywhere in an attribute, the CSS, or the JS.
const dash = ['dashboard/index.html', 'dashboard/radar.css', 'dashboard/radar.js'];
const dashExtra = ['data.js'];
let dashOk = true;
let dashDetail = '';
let dashBytes = 0;
for (const f of [...dash, ...dashExtra]) {
  const p = join(outDir, f);
  if (!existsSync(p)) { dashOk = false; dashDetail = `missing ${f}`; break; }
  const buf = readFileSync(p);
  if (dash.includes(f)) dashBytes += buf.length;
  const text = buf.toString('utf8');
  if (text.includes('http://') || text.includes('https://')) {
    dashOk = false; dashDetail = `${f} contains an http/https string`; break;
  }
}
if (dashOk && dashBytes >= 64 * 1024) { dashOk = false; dashDetail = `dashboard source ${dashBytes} bytes >= 64KB`; }
if (dashOk) dashDetail = `${dash.length} source files, ${dashBytes} bytes total, no http/https`;
gate('dashboard_files', dashOk, dashDetail);

// 6. screenshots — 3-4 images, each at most 512 KiB, whole PNG/JPEG,
//    long side at most 1440, short side at least 800.
function pngSize(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
function jpgSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + len;
  }
  return null;
}
const shots = readdirSync(join(outDir, 'screenshots')).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
let shotsOk = shots.length >= 3 && shots.length <= 4;
let shotsDetail = '';
for (const f of shots) {
  const p = join(outDir, 'screenshots', f);
  const buf = readFileSync(p);
  const size = pngSize(buf) ?? jpgSize(buf);
  if (!size) { shotsOk = false; shotsDetail = `${f}: not a whole PNG/JPEG`; break; }
  const [w, h] = size;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (buf.length > 512 * 1024 || long > 1440 || short < 800) {
    shotsOk = false; shotsDetail = `${f}: ${buf.length} bytes, ${w}x${h}`; break;
  }
  shotsDetail += `${f} ${buf.length}B ${w}x${h}; `;
}
if (shotsOk) shotsDetail = `${shots.length} shots, ${shotsDetail.trim()}`;
gate('screenshots', shotsOk, shotsDetail);

// 7. dossier_matches — the stored dossier is byte-identical to a fresh
//    buildDossier run over this same /output (raw bytes, not string length).
const stored = readFileSync(join(outDir, 'dossier.json'));
const fresh = buildDossier(outDir, { text_max_bytes: 65536 });
const freshBuf = Buffer.from(fresh, 'utf8');
const dossierOk = stored.equals(freshBuf) && stored.length <= 1.5 * 1024 * 1024;
gate(
  'dossier_matches',
  dossierOk,
  stored.equals(freshBuf)
    ? `byte-identical, ${stored.length} bytes (<= 1.5 MiB)`
    : `MISMATCH: stored ${stored.length} bytes vs fresh ${freshBuf.length} bytes`,
);

process.stdout.write(fails.length === 0 ? 'ALL 7 GATES PASS\n' : `${fails.length} GATE(S) FAILED: ${fails.join(', ')}\n`);
process.exit(fails.length === 0 ? 0 : 1);
