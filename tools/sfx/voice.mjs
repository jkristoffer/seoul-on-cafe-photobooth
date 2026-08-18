#!/usr/bin/env node
/**
 * Voice line generator.
 *
 * Same contract as generate.mjs: renders ONCE at build time into tmp/sfx/voice/,
 * for audition and hand-promotion into public/assets/sfx/voice/. The kiosk does
 * not synthesise speech at runtime.
 *
 * Korean and Malay are separate performances by separate voices — a single voice
 * carrying both will be accented in at least one of them, and the accented one is
 * the language whose speakers notice.
 *
 *   node tools/sfx/voice.mjs list
 *   node tools/sfx/voice.mjs gen ko:countdown ko:done
 *   node tools/sfx/voice.mjs gen ms:wake --voice=lily
 *   node tools/sfx/voice.mjs audition ko:countdown      # every candidate voice
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'tmp', 'sfx', 'voice');
const spec = JSON.parse(readFileSync(join(HERE, 'lines.json'), 'utf8'));

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const f = join(ROOT, '.env.sfx');
  if (!existsSync(f)) throw new Error('no ELEVENLABS_API_KEY and no .env.sfx');
  const m = readFileSync(f, 'utf8').match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error('.env.sfx has no ELEVENLABS_API_KEY');
  return m[1].trim();
}

async function say(text, voiceId, key) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: spec.model,
        // Low stability keeps the delivery lively; the attendant is meant to sound
        // eager, and a flat read is worse than an uneven one on a four-second line.
        voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.4 },
      }),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

const args = process.argv.slice(2);
const cmd = args.shift();
const flagVoice = args.find(a => a.startsWith('--voice='))?.split('=')[1];
const targets = args.filter(a => !a.startsWith('--'));

function parse(t) {
  const [lang, id] = t.split(':');
  const line = spec.lines[id];
  if (!line) throw new Error(`unknown line: ${id}`);
  if (!line[lang]) throw new Error(`line ${id} has no ${lang} text`);
  return { lang, id, text: line[lang], gloss: line[`${lang}_gloss`] };
}

if (cmd === 'list' || !cmd) {
  console.log(spec.character + '\n');
  for (const [id, l] of Object.entries(spec.lines)) {
    console.log(`${id.padEnd(12)} [${l.role}] ${l.hook}`);
    console.log(`  ko  ${l.ko}\n      ${l.ko_gloss}`);
    console.log(`  ms  ${l.ms}\n      ${l.ms_gloss}`);
  }
} else if (cmd === 'gen' || cmd === 'audition') {
  const key = apiKey();
  mkdirSync(OUT, { recursive: true });
  for (const t of targets) {
    const { lang, id, text } = parse(t);
    const voices =
      cmd === 'audition'
        ? Object.entries(spec.voiceCandidates)
        : [[flagVoice || spec.voices[lang], spec.voiceCandidates[flagVoice || spec.voices[lang]]]];
    for (const [name, vid] of voices) {
      const file = join(OUT, `${lang}-${id}-${name}.mp3`);
      writeFileSync(file, await say(text, vid, key));
      console.log(`${lang}:${id} ${name.padEnd(10)} ${file}`);
    }
  }
} else {
  console.error('usage: voice.mjs list | gen <lang:line …> [--voice=name] | audition <lang:line …>');
  process.exit(1);
}
