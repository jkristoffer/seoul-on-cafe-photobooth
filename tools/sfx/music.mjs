#!/usr/bin/env node
/**
 * Music bed generator. Build-time only, same contract as its siblings.
 *
 *   node tools/sfx/music.mjs list
 *   node tools/sfx/music.mjs gen attract shoot
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'tmp', 'sfx', 'music');
const spec = JSON.parse(readFileSync(join(HERE, 'music.json'), 'utf8'));

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const f = join(ROOT, '.env.sfx');
  if (!existsSync(f)) throw new Error('no ELEVENLABS_API_KEY and no .env.sfx');
  const m = readFileSync(f, 'utf8').match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error('.env.sfx has no ELEVENLABS_API_KEY');
  return m[1].trim();
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'list' || !cmd) {
  console.log(spec.note + '\n');
  for (const [id, t] of Object.entries(spec.tracks)) {
    console.log(`${id.padEnd(11)} ${(t.lengthMs / 1000).toFixed(0)}s  ${t.label}`);
    console.log(`${''.padEnd(11)} ${t.hook}`);
  }
} else if (cmd === 'gen') {
  const key = apiKey();
  mkdirSync(OUT, { recursive: true });
  for (const id of args.length ? args : Object.keys(spec.tracks)) {
    const t = spec.tracks[id];
    if (!t) throw new Error(`unknown track: ${id}`);
    process.stdout.write(`${id} … `);
    const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: t.prompt, music_length_ms: t.lengthMs }),
    });
    if (!res.ok) throw new Error(`${id} — HTTP ${res.status} ${await res.text()}`);
    const file = join(OUT, `${id}.mp3`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(file);
  }
} else {
  console.error('usage: music.mjs list | gen [track …]');
  process.exit(1);
}
