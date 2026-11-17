#!/usr/bin/env node
// render.mjs — final clip: HyperFrames render + audio track + H.264 encode + ffprobe checks.
//
//   node scripts/render.mjs out/<slug>/hook.json                  # -> out/<slug>.mp4 + out/<slug>.jpg
//   node scripts/render.mjs out/<slug>/hook.json --out clip.mp4   # custom path
//   node scripts/render.mjs out/<slug>/hook.json --gif            # also out/<slug>.gif (palette, 15 fps, 540 px)
//   node scripts/render.mjs out/<slug>/hook.json --draft          # fast low-quality pass
//   node scripts/render.mjs out/<slug>/hook.json --isolated-cache # if a render hangs (see README)
//
// Audio: a silent stereo AAC track by default (so the clip joins cleanly with other clips);
// with "sfx": true in hook.json (or build --sfx) a tick per word and a low hit on key words, made in code.

import { existsSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, die, log, readJson, resolveWork, hfLive, runOk, ffprobeJson, outRoot, isolatedEnv, TEMPLATE_DIR } from './lib/common.mjs';

const args = parseArgs();
const { work, slug } = resolveWork(args._[0]);
const proj = join(work, 'project');
if (!existsSync(join(proj, 'index.html'))) die(`No project yet. Run: node scripts/build.mjs "${join(work, 'hook.json')}"`);
const plan = readJson(join(proj, 'plan.json'));
const tokens = readJson(join(TEMPLATE_DIR, 'tokens.json'));
const FPS = tokens.frame.fps, W = tokens.frame.width, H = tokens.frame.height;
const duration = plan.duration;

const outPath = args.out ? resolve(process.cwd(), String(args.out)) : join(outRoot(), `${slug}.mp4`);
mkdirSync(dirname(outPath), { recursive: true });
const tmp = join(work, '.render');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const t0 = Date.now();

// 1) frames -> raw video
const raw = join(tmp, 'raw.mp4');
log(`rendering ${duration.toFixed(2)} s at ${FPS} fps …`);
const hfArgs = ['render', proj, '--output', raw, '--fps', String(FPS), '--quality', args.draft ? 'draft' : 'high'];
if (args.workers) hfArgs.push('--workers', String(args.workers));
const env = args['isolated-cache'] ? isolatedEnv() : process.env;
const code = await hfLive(hfArgs, { cwd: proj, env });
if (code !== 0 || !existsSync(raw)) die(`hyperframes render failed (exit ${code}). Run: node scripts/doctor.mjs`);
const tFrames = (Date.now() - t0) / 1000;

// 2) audio
const audio = join(tmp, 'audio.wav');
if (plan.sfx) {
  const S = tokens.sfx;
  const tick = join(tmp, 'tick.wav'), thump = join(tmp, 'thump.wav');
  runOk('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i',
    `aevalsrc='${S.tick.volume}*sin(2*PI*${S.tick.freq}*t)*exp(-t*${S.tick.decay})':d=${S.tick.length}:s=48000`, '-ac', '2', tick]);
  runOk('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i',
    `aevalsrc='${S.thump.volume}*sin(2*PI*${S.thump.freq}*t*(1+2*exp(-t*30)))*exp(-t*${S.thump.decay})':d=${S.thump.length}:s=48000`, '-ac', '2', thump]);
  const ticks = plan.words.filter(w => !w.emph), hits = plan.words.filter(w => w.emph);
  const inputs = ['-f', 'lavfi', '-t', duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo', '-i', tick, '-i', thump];
  const chains = [], mix = ['[0:a]'];
  if (ticks.length) chains.push(`[1:a]asplit=${ticks.length}${ticks.map((_, k) => `[t${k}]`).join('')}`);
  if (hits.length) chains.push(`[2:a]asplit=${hits.length}${hits.map((_, k) => `[h${k}]`).join('')}`);
  ticks.forEach((w, k) => { const ms = Math.round(w.s * 1000); chains.push(`[t${k}]adelay=${ms}|${ms}[td${k}]`); mix.push(`[td${k}]`); });
  hits.forEach((w, k) => { const ms = Math.round(w.s * 1000); chains.push(`[h${k}]adelay=${ms}|${ms}[hd${k}]`); mix.push(`[hd${k}]`); });
  chains.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first,loudnorm=I=${S.loudness}:TP=-1.5:LRA=11,aresample=48000,atrim=0:${duration.toFixed(3)}[out]`);
  runOk('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-ac', '2', '-ar', '48000', audio]);
} else {
  runOk('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-t', duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo', audio]);
}

// 3) delivery encode (H.264 + AAC, faststart)
runOk('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-i', audio,
  '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf || 18), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
  '-t', duration.toFixed(3), '-movflags', '+faststart', outPath]);

// 4) checks
const pr = ffprobeJson(outPath);
const v = pr.streams.find(s => s.codec_type === 'video');
const a = pr.streams.find(s => s.codec_type === 'audio');
const dur = Number(pr.format.duration);
const [fn, fd] = String(v?.r_frame_rate || '0/1').split('/').map(Number);
const problems = [];
if (!v || v.codec_name !== 'h264') problems.push(`video codec ${v?.codec_name} (want h264)`);
if (v && (v.width !== W || v.height !== H)) problems.push(`size ${v.width}x${v.height} (want ${W}x${H})`);
if (Math.abs(fn / fd - FPS) > 0.01) problems.push(`fps ${fn}/${fd} (want ${FPS})`);
if (!a || a.codec_name !== 'aac') problems.push('no AAC audio stream');
if (Math.abs(dur - duration) > 0.15) problems.push(`duration ${dur.toFixed(2)} s (want ${duration.toFixed(2)} s)`);
if (dur < tokens.timing.minDuration - 0.1 || dur > tokens.timing.maxDuration + 0.1) problems.push(`duration ${dur.toFixed(2)} s is outside ${tokens.timing.minDuration}–${tokens.timing.maxDuration} s`);

// 5) poster: the full line, just before the exit
const posterPath = outPath.replace(/\.mp4$/i, '') + '.jpg';
runOk('ffmpeg', ['-y', '-v', 'error', '-ss', Math.max(0, plan.exitAt - 0.1).toFixed(3), '-i', outPath, '-frames:v', '1', '-q:v', '2', posterPath]);

// 6) optional GIF for READMEs and chats
let gifPath = null;
if (args.gif) {
  gifPath = typeof args.gif === 'string' ? resolve(process.cwd(), args.gif) : outPath.replace(/\.mp4$/i, '') + '.gif';
  const maxMb = Number(args['gif-max-mb'] || 4);
  for (const [fps, width] of [[15, 540], [12, 480], [10, 400], [10, 320]]) {
    runOk('ffmpeg', ['-y', '-v', 'error', '-i', outPath, '-filter_complex',
      `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0', gifPath]);
    const mb = statSync(gifPath).size / 1024 / 1024;
    if (mb <= maxMb) { log(`gif:      ${gifPath} (${fps} fps, ${width} px, ${mb.toFixed(2)} MB)`); break; }
    log(`gif at ${fps} fps / ${width} px is ${mb.toFixed(2)} MB (> ${maxMb} MB), trying smaller …`);
  }
}

const sizeMb = statSync(outPath).size / 1024 / 1024;
console.log('');
log(`video:    ${outPath}`);
log(`poster:   ${posterPath}`);
log(`checks:   ${v?.width}x${v?.height} ${v?.codec_name} ${(fn / fd).toFixed(2)} fps · ${a?.codec_name || 'no audio'} · ${dur.toFixed(2)} s · ${sizeMb.toFixed(2)} MB`);
log(`time:     frames ${tFrames.toFixed(0)} s · total ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (problems.length) die(`output check failed:\n  - ${problems.join('\n  - ')}`, 3);
log('output check passed');
if (!args['keep-temp']) rmSync(tmp, { recursive: true, force: true });
