#!/usr/bin/env node
// build.mjs — one sentence in, a HyperFrames project for a 4–6 s vertical hook clip out.
//
//   node scripts/build.mjs "Your sentence here." [--emphasis "word,word"] [--lines "Line one|line two"]
//                          [--label "small top label"] [--sfx] [--slug name] [--no-check]
//   node scripts/build.mjs out/<slug>/hook.json      # rebuild after editing hook.json
//
// Writes out/<slug>/hook.json, out/<slug>/project/ and runs `hyperframes check` on the project.
// out/ is created in the folder you run the command from.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  parseArgs, die, log, readJson, writeJson, resolvePkgFile, tokenize, normKey, hf, round3, slugify, outRoot,
  TEMPLATE_DIR,
} from './lib/common.mjs';

const MAX_WORDS = 12;
const MAX_EMPH = 2;
const FUNCTION_WORDS = /^(a|an|the|to|of|in|on|at|by|for|and|or|but|is|are|was|be|it|its|you|your|we|our|my|i|me|with|from|as|so|that|this|can|will|do|does|not|no|just|how|why|what)$/i;

const args = parseArgs();
const first = args._.join(' ').trim();
if (!first) die('Usage: node scripts/build.mjs "Your sentence here." [--emphasis "word,word"]');

// ---------- input ----------
let hook;
const asFile = resolve(process.cwd(), first);
if (/\.json$/i.test(first) && existsSync(asFile)) hook = readJson(asFile);
else hook = { text: first };
if (args.emphasis !== undefined) hook.emphasis = String(args.emphasis).split(',').map(s => s.trim()).filter(Boolean);
if (args.lines !== undefined) hook.lines = String(args.lines).split('|').map(s => s.trim()).filter(Boolean);
if (args.label !== undefined) hook.label = args.label === true ? '' : String(args.label);
if (args.sfx) hook.sfx = true;
if (args['no-sfx']) hook.sfx = false;
if (args.slug) hook.slug = String(args.slug);
hook.text = String(hook.text || '').replace(/\s+/g, ' ').trim();
if (!hook.text) die('hook.json has no "text".');
hook.slug = slugify(hook.slug || hook.text);

const tokens = readJson(join(TEMPLATE_DIR, 'tokens.json'));
const toks = tokenize(hook.text);
if (toks.length === 0) die('The sentence has no words.');
if (toks.length > MAX_WORDS) die(`The sentence has ${toks.length} words; the limit is ${MAX_WORDS}. Shorten it — a hook reads in one breath.`);

// ---------- emphasis ----------
let emph = new Set();
for (const ph of hook.emphasis || []) {
  const keys = tokenize(ph).map(t => t.key);
  const missing = keys.filter(k => !toks.some(t => t.key === k));
  if (missing.length) die(`Emphasis "${ph}" is not in the sentence. Use words exactly as written.`);
  keys.forEach(k => emph.add(k));
}
if (emph.size > MAX_EMPH) die(`Emphasis covers ${emph.size} words; use 1–${MAX_EMPH}. One strong word beats three loud ones.`);
if (emph.size === 0) {
  const pick = [...toks].reverse().find(t => !FUNCTION_WORDS.test(t.key)) || toks[toks.length - 1];
  emph.add(pick.key);
  hook.emphasis = [pick.display];
  log(`no --emphasis given: using "${pick.display}" (the last content word). Pass --emphasis to choose.`);
}
// emphasise only the first occurrence of each key
const seen = new Set();
const words = toks.map(t => {
  const e = emph.has(t.key) && !seen.has(t.key);
  if (e) seen.add(t.key);
  return { t: t.display, p: t.punct, emph: e };
});

// ---------- lines ----------
let lines;
if (Array.isArray(hook.lines) && hook.lines.length) {
  lines = [];
  let p = 0;
  for (const ln of hook.lines) {
    const ks = tokenize(ln).map(t => t.key);
    if (!ks.length) continue;
    const ok = ks.every((k, q) => toks[p + q] && toks[p + q].key === k);
    if (!ok) die(`--lines "${hook.lines.join('|')}" does not match the sentence word for word. Split the sentence itself with "|".`);
    lines.push(ks.map((_, q) => p + q));
    p += ks.length;
  }
  if (p !== toks.length) die('--lines leaves out words at the end of the sentence.');
} else {
  lines = groupLines(words, tokens.type.lineChars);
}

// Key words of 4+ letters get a line of their own (so they are the biggest); the rest is packed
// into lines of about `lineChars` characters, balanced.
function groupLines(ws, target) {
  const idx = ws.map((_, i) => i);
  if (ws.length <= 3) return idx.map(i => [i]);
  const segs = [];
  let cur = [];
  for (const i of idx) {
    if (ws[i].emph && ws[i].t.length >= 4) { if (cur.length) segs.push(cur); segs.push([i]); cur = []; }
    else cur.push(i);
  }
  if (cur.length) segs.push(cur);
  const out = [];
  for (const seg of segs) {
    const chars = seg.reduce((a, i) => a + ws[i].t.length + 1, -1);
    const k = Math.max(1, Math.round(chars / target));
    const goal = chars / k;
    let line = [], len = -1;
    for (const i of seg) {
      const add = ws[i].t.length + 1;
      if (line.length && len + add > goal + 3) { out.push(line); line = []; len = -1; }
      line.push(i); len += add;
    }
    if (line.length) out.push(line);
  }
  return out;
}

// ---------- timing ----------
const T = tokens.timing, MO = tokens.motion;
const fps = tokens.frame.fps;
function place(scale) {
  let t = T.start;
  return words.map((w, i) => {
    if (i > 0 && w.emph) t += T.emphPause * scale;
    const s = t;
    const step = Math.max(T.minStep, (T.perWord + T.perChar * w.t.length) * scale);
    t = s + step + (/[,;:.!?]/.test(w.p) && i < words.length - 1 ? T.punctPause * scale : 0);
    return s;
  });
}
const exitSpan = (words.length - 1) * MO.exit.stagger + MO.exit.duration;
let scale = 1, starts = place(1);
const landOf = st => st[st.length - 1] + MO.wordIn.duration;
let hold = T.hold;
// Too long: tighten the word cadence first, then the hold.
for (let guard = 0; guard < 40 && landOf(starts) + hold + exitSpan + T.tail > T.maxDuration; guard++) {
  if (scale > 0.6) { scale -= 0.05; starts = place(scale); }
  else if (hold > T.minHold) hold = Math.max(T.minHold, hold - 0.1);
  else break;
}
// Too short: hold the finished line longer.
const land = landOf(starts);
if (land + hold + exitSpan + T.tail < T.minDuration) hold = T.minDuration - land - exitSpan - T.tail;
const duration = Math.ceil((land + hold + exitSpan + T.tail) * fps) / fps;
const exitAt = round3(land + hold);
words.forEach((w, i) => { w.s = round3(starts[i]); });

// ---------- write project ----------
const work = join(outRoot(), hook.slug);
const proj = join(work, 'project');
mkdirSync(work, { recursive: true });
writeJson(join(work, 'hook.json'), {
  text: hook.text, emphasis: hook.emphasis, ...(hook.lines && { lines: hook.lines }),
  ...(hook.label && { label: hook.label }), sfx: Boolean(hook.sfx), slug: hook.slug,
});
// clear the project's contents, not the folder itself (Windows refuses to delete a folder another process sits in)
mkdirSync(proj, { recursive: true });
for (const f of readdirSync(proj)) rmSync(join(proj, f), { recursive: true, force: true });
mkdirSync(join(proj, 'assets', 'fonts'), { recursive: true });
copyFileSync(resolvePkgFile('@fontsource/inter-tight/files/inter-tight-latin-800-normal.woff2'), join(proj, 'assets', 'fonts', 'inter-tight-800.woff2'));
copyFileSync(resolvePkgFile('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2'), join(proj, 'assets', 'fonts', 'jetbrains-mono-500.woff2'));
copyFileSync(resolvePkgFile('gsap/dist/gsap.min.js'), join(proj, 'assets', 'gsap.min.js'));
copyFileSync(join(TEMPLATE_DIR, 'engine.js'), join(proj, 'engine.js'));

const data = { duration, exitAt, label: hook.label || '', lines, words: words.map(w => ({ t: w.t, ...(w.p && { p: w.p }), s: w.s, ...(w.emph && { emph: true }) })) };
const html = readFileSync(join(TEMPLATE_DIR, 'index.html'), 'utf8')
  .replaceAll('{{TITLE}}', escapeHtml(hook.text))
  .replaceAll('{{BG}}', tokens.color.bg)
  .replaceAll('{{DURATION}}', duration.toFixed(3))
  .replace('{{HOOK}}', JSON.stringify({ tokens, data }).replace(/</g, '\\u003c'));
writeFileSync(join(proj, 'index.html'), html);

// pointer for make.mjs (one-shot build + render)
writeFileSync(join(outRoot(), '.last-hook'), join(work, 'hook.json'));

// plan for frames.mjs and render.mjs
writeJson(join(proj, 'plan.json'), {
  slug: hook.slug, text: hook.text, duration, exitAt, fps, sfx: Boolean(hook.sfx),
  words: words.map(w => ({ t: w.t, s: w.s, emph: w.emph })),
});

console.log('');
log(`project:  ${proj}`);
log(`duration: ${duration.toFixed(2)} s · ${words.length} words · hold ${hold.toFixed(2)} s · exit at ${exitAt.toFixed(2)} s`);
log(`lines:    ${lines.map(l => l.map(i => (words[i].emph ? `[${words[i].t}]` : words[i].t)).join(' ')).join(' | ')}`);
log(`edit:     ${join(work, 'hook.json')}  (then run build.mjs on it again)`);

if (!args['no-check']) {
  log('running hyperframes check …');
  const r = hf(['check', proj, '--json'], { cwd: proj });
  let j = null;
  try { j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { /* fall through */ }
  if (!j) die(`hyperframes check gave no report (exit ${r.status}).\n${(r.stderr || '').split('\n').slice(-15).join('\n')}`, 2);
  let errors = 0;
  for (const sec of ['lint', 'runtime', 'layout', 'motion', 'contrast', 'craft', 'audio']) {
    const x = j[sec];
    if (!x || !x.findings) continue;
    errors += x.errorCount || 0;
    const shown = x.findings.filter(f => f.severity === 'error' || f.severity === 'warning');
    log(`  ${sec.padEnd(8)} ${x.errorCount || 0} errors, ${x.warningCount || 0} warnings${x.infoCount ? `, ${x.infoCount} notes` : ''}`);
    for (const f of shown.slice(0, 8)) log(`    ${f.severity}: ${f.code}${f.time !== undefined ? ` @${f.time}s` : ''} — ${String(f.message).slice(0, 220)}`);
  }
  if (errors || j.ok === false) die('hyperframes check reported errors (see above). Fix them before rendering.', 2);
  log('check passed (notes about word masks overflowing are expected: each word slides in through its own mask)');
}
log(`next:     node scripts/frames.mjs "${join(work, 'hook.json')}"`);

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
