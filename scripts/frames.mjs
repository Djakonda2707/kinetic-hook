#!/usr/bin/env node
// frames.mjs — contact sheet of the built project at key moments (no full render needed).
//
//   node scripts/frames.mjs out/<slug>/hook.json              # word landings, key words, hold, exit
//   node scripts/frames.mjs out/<slug>/hook.json --at 1.2,3.4 # exact times (seconds)
//
// Writes out/<slug>/frames/*.png and out/<slug>/contact.jpg. Look at contact.jpg before rendering.

import { copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, die, log, readJson, resolveWork, hf, isolatedEnv } from './lib/common.mjs';

const args = parseArgs();
const { work } = resolveWork(args._[0]);
const proj = join(work, 'project');
if (!existsSync(join(proj, 'index.html'))) die(`No project yet. Run: node scripts/build.mjs "${join(work, 'hook.json')}"`);
const plan = readJson(join(proj, 'plan.json'));

let times;
if (args.at) {
  times = String(args.at).split(',').map(Number).filter(Number.isFinite);
} else {
  const w = plan.words;
  const landed = i => w[i].s + 0.5;
  times = [w[0].s + 0.12];                              // first word mid-flight
  if (w.length > 2) times.push(landed(Math.floor(w.length / 2) - 1));
  w.forEach((x, i) => { if (x.emph) times.push(landed(i)); });
  times.push(plan.exitAt - 0.05);                       // the full line, held
  times.push(plan.exitAt + 0.2);                        // exit in progress
}
times = [...new Set(times.map(t => Math.max(0, Math.min(plan.duration - 0.04, t))).map(t => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
if (!times.length) die('No times to capture.');

const outDir = join(work, 'frames');
rmSync(outDir, { recursive: true, force: true });
log(`capturing ${times.length} frames: ${times.join(', ')}`);
const env = args['isolated-cache'] ? isolatedEnv() : process.env;
const r = hf(['snapshot', proj, '--at', times.join(','), '--no-end', '--output', outDir], { cwd: proj, env });
if (r.status !== 0) die(`snapshot failed:\n${(r.stderr || r.stdout || '').split('\n').slice(-20).join('\n')}`);
const sheets = readdirSync(outDir).filter(f => /^contact-sheet(-\d+)?\.jpg$/.test(f)).sort();
if (!sheets.length) die('snapshot ran but wrote no contact sheet.');
for (const f of readdirSync(work)) if (/^contact(-\d+)?\.jpg$/.test(f)) rmSync(join(work, f));
sheets.forEach((f, k) => {
  const dst = join(work, sheets.length === 1 ? 'contact.jpg' : `contact-${k + 1}.jpg`);
  copyFileSync(join(outDir, f), dst);
  log(`contact sheet: ${dst}`);
});
log(`full-size frames: ${outDir}`);
log(`next: look at the sheet, then node scripts/render.mjs "${join(work, 'hook.json')}"`);
