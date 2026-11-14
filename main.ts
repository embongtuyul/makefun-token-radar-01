// Token Radar: a program/v1 entry for make.fun's token-radar-01.
//
// Reads the sealed DefiLlama snapshot, scores every pre-token protocol with
// the model in lib/radar.ts, and writes the ranked board, the dashboard's
// data, the dashboard itself, its screenshots, and the dossier the judge
// reads — all into /output (or MAKEFUN_OUTPUT_DIR when set, for local runs).
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The run is deterministic: the same snapshot bytes always produce the same
// output bytes, so the grader's two runs agree.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Read a --name <value> argument, or fall back. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile} (pass --input <snapshot.json|directory>)\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const board = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: refusing to write a board the gate would refuse: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board.rows })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(board));

/** Copy a repository directory's regular files into `to`, skipping dot-names. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (dashFiles.length < 3) {
  process.stderr.write(`token radar: dashboard/ holds ${dashFiles.length} files: hand in index.html, a stylesheet and a script\n`);
  process.exit(1);
}
if (shotFiles.length < 3 || shotFiles.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shotFiles.length} images: hand in 3 or 4\n`);
  process.exit(1);
}
for (const name of shotFiles) {
  const size = statSync(join(here, 'screenshots', name)).size;
  if (size < 300_000 || size > 350_000) {
    process.stderr.write(`token radar: screenshots/${name} is ${size} bytes: keep each shot at 300 to 350 KB\n`);
    process.exit(1);
  }
}

// The dossier is written last: the gate compares it byte for byte with what
// buildDossier writes from this /output, given only the text cap.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${board.meta.pre_token_total} pre-token, ` +
    `${board.meta.live_set_aside} live set aside, ${board.rows.length} rows ranked\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
    `${join(outDir, 'dashboard')} (${dashFiles.length} files), ` +
    `${join(outDir, 'screenshots')} (${shotFiles.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
