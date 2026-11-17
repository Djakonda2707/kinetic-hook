// Shared helpers for the kinetic-hook scripts.
// Every external command is spawned with an argument array (no shell strings),
// so paths with spaces or non-ASCII characters are safe on every OS.

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE_DIR = join(SKILL_ROOT, 'template');
const require = createRequire(join(SKILL_ROOT, 'package.json'));

// parseArgs(['a', '--emphasis', 'x,y', '--sfx']) -> { _: ['a'], emphasis: 'x,y', sfx: true }
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export function die(msg, code = 1) {
  console.error(`\n[kinetic-hook] ${msg}\n`);
  process.exit(code);
}

export function log(msg) { console.log(`[kinetic-hook] ${msg}`); }

export function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { die(`Cannot read JSON ${p}: ${e.message}`); }
}
export function writeJson(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}
export function resolvePkgFile(spec) {
  try { return require.resolve(spec); }
  catch { die(`Missing package file ${spec}. Run "npm install" in ${SKILL_ROOT}`); }
}

// Output root: ./out in the folder you run the scripts from.
export function outRoot() { return resolve(process.cwd(), 'out'); }

// Work folder = out/<slug>/ that holds hook.json. Accepts hook.json, its folder, or a slug.
export function resolveWork(arg) {
  if (!arg) die('Pass the path to hook.json (or its folder), as printed by build.mjs.');
  let p = resolve(process.cwd(), arg);
  if (existsSync(p) && !p.toLowerCase().endsWith('.json')) p = join(p, 'hook.json');
  if (!existsSync(p)) {
    const bySlug = join(outRoot(), String(arg), 'hook.json');
    if (existsSync(bySlug)) p = bySlug;
    else die(`Not found: ${p}`);
  }
  const hook = readJson(p);
  return { hookPath: p, work: dirname(p), hook, slug: slugify(hook.slug || hook.text) };
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48).replace(/-$/, '') || 'hook';
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.error) throw r.error;
  return r;
}

export function runOk(cmd, args, opts = {}) {
  const r = run(cmd, args, opts);
  if (r.status !== 0) {
    const err = (r.stderr || '').toString().split('\n').slice(-25).join('\n');
    die(`${cmd} failed (exit ${r.status}).\n${err}`);
  }
  return r;
}

export function runLive(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', rej);
    p.on('close', code => res(code));
  });
}

export function hyperframesBin() {
  const pkgPath = resolvePkgFile('hyperframes/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.hyperframes;
  return join(dirname(pkgPath), bin);
}

// Run the pinned HyperFrames CLI with the current Node binary (no npx, no shell).
export function hf(args, opts = {}) { return run(process.execPath, [hyperframesBin(), ...args], opts); }
export function hfLive(args, opts = {}) { return runLive(process.execPath, [hyperframesBin(), ...args], opts); }

// Escape hatch for renders that hang: private HyperFrames cache inside the skill folder + the installed Chrome.
export function isolatedEnv() {
  const env = { ...process.env };
  const pathRun = hf(['browser', 'path']);
  const chrome = (pathRun.stdout || '').trim().split('\n').pop();
  if (pathRun.status === 0 && chrome && existsSync(chrome)) env.HYPERFRAMES_BROWSER_PATH = chrome;
  env.HYPERFRAMES_CACHE_DIR = join(SKILL_ROOT, '.cache', 'hyperframes');
  mkdirSync(env.HYPERFRAMES_CACHE_DIR, { recursive: true });
  log(`isolated HyperFrames cache: ${env.HYPERFRAMES_CACHE_DIR}${env.HYPERFRAMES_BROWSER_PATH ? ` · Chrome: ${env.HYPERFRAMES_BROWSER_PATH}` : ''}`);
  return env;
}

export function ffprobeJson(file) {
  const r = runOk('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return JSON.parse(r.stdout);
}

// One token per written word: display text, trailing punctuation, comparison key.
export function tokenize(text) {
  return String(text)
    .replace(/[—–]/g, ' ')
    .split(/\s+/)
    .map(raw => {
      const bare = raw.replace(/^["'“‘(\[]+/, '').replace(/["'”’)\]]+$/, '');
      const punct = (bare.match(/[.,;:!?]+$/) || [''])[0];
      const display = bare.slice(0, bare.length - punct.length).replace(/["'”’)\]]+$/, '');
      return { display, punct, key: normKey(display) };
    })
    .filter(t => t.key.length > 0);
}

export function normKey(s) {
  return String(s).toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function round3(x) { return Math.round(x * 1000) / 1000; }
