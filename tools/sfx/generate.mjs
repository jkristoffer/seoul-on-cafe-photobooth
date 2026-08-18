#!/usr/bin/env node
/**
 * Sound effect generator.
 *
 * Renders the booth's sound effects from ElevenLabs ONCE, at build time, into
 * tmp/sfx/ for audition. The winning take is promoted by hand into
 * public/assets/sfx/ and committed. The kiosk itself never talks to this API:
 * it is unattended, must not block on the network, and the key must never
 * reach the browser or a serverless function.
 *
 * The key lives in .env.sfx (gitignored, and deliberately NOT .env — `vercel dev`
 * loads .env into the functions' environment and this key has no business there).
 *
 *   node tools/sfx/generate.mjs list
 *   node tools/sfx/generate.mjs gen shutter          # every take
 *   node tools/sfx/generate.mjs gen shutter:b eject  # one take, plus all of another
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'tmp', 'sfx');
const API = 'https://api.elevenlabs.io/v1/sound-generation';

const spec = JSON.parse(readFileSync(join(HERE, 'effects.json'), 'utf8'));

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const envFile = join(ROOT, '.env.sfx');
  if (!existsSync(envFile)) throw new Error('no ELEVENLABS_API_KEY and no .env.sfx');
  const m = readFileSync(envFile, 'utf8').match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error('.env.sfx has no ELEVENLABS_API_KEY');
  return m[1].trim();
}

/** "shutter:b" -> just take b; "shutter" -> every take. */
function resolve(args) {
  const ids = args.length ? args : Object.keys(spec.effects);
  const jobs = [];
  for (const arg of ids) {
    const [id, takeId] = arg.split(':');
    const fx = spec.effects[id];
    if (!fx) throw new Error(`unknown effect: ${id}`);
    const takes = takeId ? fx.takes.filter(t => t.id === takeId) : fx.takes;
    if (!takes.length) throw new Error(`unknown take: ${arg}`);
    for (const take of takes) jobs.push({ id, fx, take });
  }
  return jobs;
}

async function render({ id, fx, take }, key) {
  const body = {
    text: `${take.text}. ${spec.defaults.negative}`,
    duration_seconds: fx.durationSeconds,
    prompt_influence: take.promptInfluence,
  };
  const res = await fetch(`${API}?output_format=${spec.defaults.outputFormat}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${id}:${take.id} — HTTP ${res.status} ${await res.text()}`);
  const file = join(OUT, `${id}-${take.id}.mp3`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'list' || !cmd) {
  for (const [id, fx] of Object.entries(spec.effects)) {
    console.log(`${id.padEnd(10)} ${fx.durationSeconds}s  ${fx.label}`);
    console.log(`${''.padEnd(10)} ${fx.hook}`);
    for (const t of fx.takes) console.log(`  :${t.id}  influence ${t.promptInfluence}  ${t.text.slice(0, 72)}…`);
  }
} else if (cmd === 'gen') {
  const key = apiKey();
  mkdirSync(OUT, { recursive: true });
  // Serial on purpose: a handful of calls, and a 429 mid-batch is more annoying
  // than the wait.
  for (const job of resolve(args)) {
    process.stdout.write(`${job.id}:${job.take.id} … `);
    console.log(await render(job, key));
  }
} else {
  console.error(`usage: generate.mjs list | gen [effect[:take] …]`);
  process.exit(1);
}
