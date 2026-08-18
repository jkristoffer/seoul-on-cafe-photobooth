#!/usr/bin/env node
/**
 * Trim and level a generated take into a shippable asset.
 *
 * Generated audio is padded and its level is arbitrary — takes of the same sound
 * arrived 20 dB apart, and one shutter carried 340 ms of silence in front of the
 * click, which would have landed the sound behind the flash.
 *
 * ffmpeg's own `silenceremove` is not good enough here: its default RMS detection
 * eats the decay of a short transient, and its peak detection leaves the tail on
 * anything with a noise floor above the threshold. Each generated file has a
 * different floor. So the bounds are *measured* per file with silencedetect and
 * then applied with an explicit atrim, which is deterministic and inspectable.
 *
 *   node tools/sfx/trim.mjs tmp/sfx/shutter-a.mp3 public/assets/sfx/shutter.mp3 --lufs=-16 --fade
 */

import { execFileSync } from 'node:child_process';

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: trim.mjs <in.mp3> <out.mp3> [--lufs=-16] [--fade] [--floor=-45]');
  process.exit(1);
}
const flag = (n, d) => {
  const f = flags.find(x => x.startsWith(`--${n}=`));
  return f ? Number(f.split('=')[1]) : d;
};
const lufs = flag('lufs', -16);
const floor = flag('floor', -45);
const fade = flags.includes('--fade');

function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-nostats', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function probeDuration(f) {
  return Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {
      encoding: 'utf8',
    }).trim()
  );
}

const dur = probeDuration(input);
let log = '';
try {
  ffmpeg(['-i', input, '-af', `silencedetect=n=${floor}dB:d=0.01`, '-f', 'null', '-']);
} catch (e) {
  log = e.stderr || '';
}
// silencedetect writes to stderr even on success.
if (!log) {
  try {
    log = execFileSync(
      'sh',
      ['-c', `ffmpeg -hide_banner -nostats -i "${input}" -af silencedetect=n=${floor}dB:d=0.01 -f null - 2>&1`],
      { encoding: 'utf8' }
    );
  } catch (e) {
    log = e.stdout || '';
  }
}

const starts = [...log.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map(m => Number(m[1]));
const ends = [...log.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => Number(m[1]));

// silencedetect emits a closing silence_end at EOF, so the markers only mean
// anything paired up. Sound begins where a silence touching 0 ends, and ends
// where a silence running to EOF begins.
const spans = starts.map((s, i) => ({ s, e: ends[i] ?? dur }));
const first = spans[0];
const last = spans[spans.length - 1];
const from = first && first.s <= 0.001 ? first.e : 0;
const to = last && last.e >= dur - 0.01 && last.s > from ? last.s : dur;

const pad = 0.008; // a few ms of air so the trim never clips the attack
const a = Math.max(0, from - pad);
const b = Math.min(dur, to + pad);

const chain = [`atrim=start=${a.toFixed(4)}:end=${b.toFixed(4)}`, 'asetpts=PTS-STARTPTS'];
if (fade) chain.push(`afade=t=out:st=${Math.max(0, b - a - 0.03).toFixed(4)}:d=0.03`);
chain.push(`loudnorm=I=${lufs}:TP=-1.5`);

execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', input, '-af', chain.join(','), '-ar', '44100', '-b:a', '96k', output,
]);

console.log(
  `${input} → ${output}  ${dur.toFixed(2)}s → ${probeDuration(output).toFixed(2)}s  ` +
    `(cut ${(a * 1000).toFixed(0)}ms head, ${((dur - b) * 1000).toFixed(0)}ms tail, ${lufs} LUFS)`
);
