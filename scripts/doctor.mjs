#!/usr/bin/env node
// doctor.mjs — checks everything the skill needs and prints the exact fix for this OS.
//
//   node scripts/doctor.mjs

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_ROOT, run, hf } from './lib/common.mjs';

const OS = process.platform; // win32 | darwin | linux
const results = [];
const add = (name, ok, detail, fix) => results.push({ name, ok, detail, fix });

const FIX = {
  node: {
    win32: 'winget install OpenJS.NodeJS.LTS   (then open a new terminal)',
    darwin: 'brew install node@22   (or the LTS installer from nodejs.org)',
    linux: 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs   (Debian/Ubuntu)',
  },
  ffmpeg: {
    win32: 'winget install --id Gyan.FFmpeg -e   (then open a new terminal so PATH updates)',
    darwin: 'brew install ffmpeg',
    linux: 'sudo apt install -y ffmpeg   (Debian/Ubuntu)  or  sudo dnf install -y ffmpeg   (Fedora, RPM Fusion)',
  },
};
const fixFor = k => FIX[k][OS] || FIX[k].linux;

const major = Number(process.versions.node.split('.')[0]);
add('Node.js 22+', major >= 22, `v${process.versions.node}`, fixFor('node'));

const pkgs = ['hyperframes', 'gsap', '@fontsource/inter-tight', '@fontsource/jetbrains-mono'];
const missing = pkgs.filter(p => !existsSync(join(SKILL_ROOT, 'node_modules', ...p.split('/'), 'package.json')));
add('npm packages', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'installed',
  `cd "${SKILL_ROOT}" && npm install`);

for (const bin of ['ffmpeg', 'ffprobe']) {
  let ok = false, detail = 'not found in PATH';
  try { const r = run(bin, ['-version']); ok = r.status === 0; if (ok) detail = r.stdout.split('\n')[0].slice(0, 70); } catch { /* not found */ }
  add(bin, ok, detail, fixFor('ffmpeg'));
}
try {
  const enc = run('ffmpeg', ['-hide_banner', '-encoders']).stdout || '';
  const need = ['libx264', 'aac'].filter(e => !new RegExp(`\\s${e}\\s`).test(enc));
  add('ffmpeg encoders (libx264, aac)', need.length === 0, need.length ? `missing: ${need.join(', ')}` : 'ok',
    `install a full ffmpeg build: ${fixFor('ffmpeg')}`);
} catch { /* reported above */ }

if (!missing.includes('hyperframes')) {
  const r = hf(['browser', 'path']);
  const p = (r.stdout || '').trim().split('\n').pop();
  const ok = r.status === 0 && p && existsSync(p);
  add('Chrome for rendering', ok, ok ? p : 'no browser found',
    `cd "${SKILL_ROOT}" && node node_modules/hyperframes/bin/hyperframes.mjs browser ensure   (downloads the pinned Chrome once)`);
}

console.log('\nkinetic-hook doctor\n');
let fail = 0;
for (const r of results) {
  console.log(`[${r.ok ? ' OK ' : 'FAIL'}] ${r.name} — ${r.detail}`);
  if (!r.ok) { console.log(`       fix: ${r.fix}`); fail++; }
}
console.log(fail ? `\n${fail} check(s) failed.` : '\nAll checks passed.');
process.exit(fail ? 1 : 0);
