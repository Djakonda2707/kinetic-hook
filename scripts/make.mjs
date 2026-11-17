#!/usr/bin/env node
// make.mjs — one command: build + render. Same arguments as build.mjs, plus render options.
//
//   node scripts/make.mjs "Your sentence here." --emphasis "word,word" [--sfx] [--gif]
//
// For careful work (and always when an AI agent runs this skill) use the three steps instead:
// build.mjs -> frames.mjs (look at the contact sheet) -> render.mjs. See SKILL.md.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { die, log, hf, hfLive, runLive, outRoot, SKILL_ROOT } from './lib/common.mjs';

const argv = process.argv.slice(2);
const RENDER_FLAGS = new Set(['--gif', '--draft', '--isolated-cache', '--out', '--crf', '--workers', '--gif-max-mb', '--keep-temp']);
const RENDER_VALUE = new Set(['--out', '--crf', '--workers', '--gif-max-mb']);
const buildArgs = [], renderArgs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], key = a.split('=')[0];
  if (RENDER_FLAGS.has(key)) {
    renderArgs.push(a);
    if (RENDER_VALUE.has(a) || (a === '--gif' && argv[i + 1] && !argv[i + 1].startsWith('--') && /\.gif$/i.test(argv[i + 1]))) renderArgs.push(argv[++i]);
  } else buildArgs.push(a);
}

// first run: make sure HyperFrames has a Chrome to render with
const bp = hf(['browser', 'path']);
const chrome = (bp.stdout || '').trim().split('\n').pop();
if (bp.status !== 0 || !chrome || !existsSync(chrome)) {
  log('no Chrome for rendering yet — downloading the pinned one (once) …');
  if (await hfLive(['browser', 'ensure']) !== 0) die('Chrome download failed. Run: node scripts/doctor.mjs');
}

const node = process.execPath;
if (await runLive(node, [join(SKILL_ROOT, 'scripts', 'build.mjs'), ...buildArgs]) !== 0) process.exit(1);
const hookPath = readFileSync(join(outRoot(), '.last-hook'), 'utf8').trim();
if (await runLive(node, [join(SKILL_ROOT, 'scripts', 'render.mjs'), hookPath, ...renderArgs]) !== 0) process.exit(1);
