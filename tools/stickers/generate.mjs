#!/usr/bin/env node
/* Drive Codex CLI's image generation over the prompt sheet.

   Each sticker is generated in its own `codex exec` invocation, with the full
   style block prepended rather than relying on a shared session. Codex sessions
   are stateless between invocations, and re-sending the style lock every time is
   what keeps 22 separately-generated stickers looking like one set — the same
   reason the prompt engine puts the style in a locked block to begin with.

   The child's stdin MUST be closed. `codex exec` given a positional prompt still
   reads stdin so it can append it as a `<stdin>` block, so a child holding an open,
   never-written stdin pipe — which is what child_process.execFile always hands it,
   `stdio` being an option execFile ignores — blocks forever and writes nothing.
   That is why this spawns explicitly with stdin set to 'ignore'.

   Usage:
     node tools/stickers/generate.mjs [--only=name,name] [--jobs=3] [--force]
*/

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
const SHEET = 'tools/sticker-prompts/PROMPTS-codex.md';
const OUT = 'tmp/gen';

const arg = (k, d) => (process.argv.find(a => a.startsWith('--' + k + '=')) || '=' + d).split('=').slice(1).join('=');
const has = k => process.argv.includes('--' + k);

const md = readFileSync(SHEET, 'utf8');
const items = [];
const re = /^## (\d+)\.\s*(.+?)\n```\n([\s\S]*?)\n```/gm;
for (let m; (m = re.exec(md)); ) items.push({ n: +m[1], name: m[2].trim(), text: m[3] });

const preamble = items.shift();
if (preamble.n !== 0) throw new Error('expected section 0 to be the style preamble');
// Drop the conversational tail — it asks the model to wait for a subject, and
// here the subject arrives in the same message.
const style = preamble.text.replace(/\n\nReply "ready"[\s\S]*$/, '');

const only = arg('only', '').split(',').filter(Boolean);
const jobs = Math.max(1, +arg('jobs', 3));
mkdirSync(OUT, { recursive: true });

const queue = items.filter(it => {
  if (only.length && !only.some(o => it.name.includes(o))) return false;
  if (!has('force') && existsSync(`${OUT}/${it.name}`)) { console.log(`skip  ${it.name} (exists)`); return false; }
  return true;
});

function prompt(it) {
  return [
    style,
    '',
    'Subject for this image: ' + it.text.replace(/^Same style\.\s*/, '').replace(/^Subject:\s*/, ''),
    '',
    `Generate exactly one image and save it to ${OUT}/${it.name} — nothing else.`,
    'Do not write any other files. Do not modify any repository files.',
  ].join('\n');
}

const fails = [];
async function generate(it) {
  const t0 = Date.now();
  await new Promise(resolve => {
    const child = spawn('codex', ['exec', '--sandbox', 'workspace-write', '-C', process.cwd(), prompt(it)],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    const kill = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
    // Exit code is not the signal that matters here; the file on disk is.
    child.on('close', () => { clearTimeout(kill); resolve(); });
    child.on('error', () => { clearTimeout(kill); resolve(); });
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (existsSync(`${OUT}/${it.name}`)) console.log(`ok    ${it.name}  ${secs}s`);
  else { console.log(`FAIL  ${it.name}  ${secs}s`); fails.push(it.name); }
}

console.log(`generating ${queue.length} stickers, ${jobs} at a time`);
const cursor = queue[Symbol.iterator]();
await Promise.all(Array.from({ length: jobs }, async () => {
  for (const it of cursor) await generate(it);
}));

if (fails.length) {
  console.log(`\n${fails.length} failed: ${fails.join(', ')}`);
  console.log(`retry with: node tools/stickers/generate.mjs --only=${fails.join(',')}`);
  process.exit(1);
}
console.log('\nall done');
