#!/usr/bin/env node
/**
 * Sticker prompt engine.
 *
 * Composes image-generation prompts for the photobooth sticker sets. The point is
 * consistency: every prompt embeds the same locked style block from style.json, and
 * the per-sticker catalog in subjects.json contributes ONLY the subject noun phrase.
 * That separation is what keeps a 20-piece set looking like one set.
 *
 * Sources differ in how they like to be addressed, not in what they are asked for,
 * so each source is a thin adapter over one shared prompt body.
 *
 *   node tools/sticker-prompts/engine.mjs list
 *   node tools/sticker-prompts/engine.mjs prompt dog-coffee --source=codex
 *   node tools/sticker-prompts/engine.mjs batch --set=mascot --source=claude
 *   node tools/sticker-prompts/engine.mjs manifest > tools/sticker-prompts/manifest.json
 *   node tools/sticker-prompts/engine.mjs stub --set=menu
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const style = JSON.parse(readFileSync(join(HERE, 'style.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(HERE, 'subjects.json'), 'utf8'));

/* ---------- catalog ---------- */

function allItems() {
  const out = [];
  for (const [setId, set] of Object.entries(catalog.sets)) {
    for (const item of set.items) {
      out.push({ ...item, setId, setLabel: set.label, sharedSubject: set.sharedSubject });
    }
  }
  return out;
}

function findItem(id) {
  const hit = allItems().find(i => i.id === id);
  if (!hit) {
    const near = allItems().map(i => i.id).filter(x => x.startsWith(id.slice(0, 3)));
    throw new Error(`unknown sticker id "${id}"` + (near.length ? `\ndid you mean: ${near.join(', ')}` : ''));
  }
  return hit;
}

/* ---------- prompt body ---------- */

/** The subject clause is the ONLY part that varies between stickers in a set. */
function subjectClause(item) {
  return `${item.sharedSubject}, ${item.subject}`;
}

/** Shared, source-independent prompt body. Every source sends these same words. */
function body(item) {
  return [
    `Subject: ${subjectClause(item)}.`,
    `Medium: ${style.medium}.`,
    `Line: ${style.lineWeight}.`,
    `Shading: ${style.shading}.`,
    `Color: ${style.paletteRule}.`,
    `Composition: ${style.composition}.`,
    `Background: ${style.background}.`,
    `Mood: ${style.mood}.`,
    `Constraints: ${style.text}. The result ${style.readability}.`,
    `Avoid: ${style.negative.join(', ')}.`,
    `Output: ${style.output.size} ${style.output.format}. ${style.output.note}`,
  ].join('\n');
}

/**
 * Stable fingerprint of the exact words sent for this sticker. If the style block
 * is edited, every fingerprint changes — which is how you detect that art on disk
 * was generated against an older style and needs regenerating.
 */
function fingerprint(item) {
  return createHash('sha256').update(body(item)).digest('hex').slice(0, 12);
}

/* ---------- source adapters ---------- */

const SOURCES = {
  /* Conversational agent: give it the role and let it reason about the set. */
  claude: {
    label: 'Claude',
    render: (item) => [
      `Generate one sticker image for a Korean-themed cafe photobooth.`,
      ``,
      body(item),
      ``,
      `This is sticker "${item.id}" from the "${item.setId}" set. It must sit visually alongside the other stickers in that set, so hold the line weight and palette exactly as specified above.`,
    ].join('\n'),
  },

  /* Codex: terser, task-shaped framing; it responds better to an explicit deliverable. */
  codex: {
    label: 'Codex',
    render: (item) => [
      `Task: produce one PNG sticker asset.`,
      `Filename: ${item.setId}-${item.id}.png`,
      ``,
      body(item),
      ``,
      `Do not add commentary or alternatives. Emit the single image described.`,
    ].join('\n'),
  },

  /* Bare prompt, no framing — for pasting into an image UI or an API call. */
  raw: {
    label: 'Raw',
    render: (item) => body(item),
  },
};

function getSource(name) {
  const s = SOURCES[name];
  if (!s) throw new Error(`unknown source "${name}" (have: ${Object.keys(SOURCES).join(', ')})`);
  return s;
}

/* ---------- commands ---------- */

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else rest.push(a);
  }
  return { flags, rest };
}

function select(flags) {
  let items = allItems();
  if (flags.set) {
    if (!catalog.sets[flags.set]) throw new Error(`unknown set "${flags.set}" (have: ${Object.keys(catalog.sets).join(', ')})`);
    items = items.filter(i => i.setId === flags.set);
  }
  return items;
}

const commands = {
  list() {
    for (const [setId, set] of Object.entries(catalog.sets)) {
      console.log(`\n${setId}  (${set.label})  — ${set.items.length} stickers`);
      for (const item of set.items) {
        console.log(`  ${item.id.padEnd(18)} ${item.subject}`);
      }
    }
    console.log(`\ntotal: ${allItems().length} stickers across ${Object.keys(catalog.sets).length} sets`);
  },

  prompt(flags, rest) {
    const item = findItem(rest[0] || '');
    console.log(getSource(flags.source || 'raw').render(item));
  },

  batch(flags) {
    const src = getSource(flags.source || 'raw');
    const items = select(flags);
    items.forEach((item, i) => {
      console.log(`${'='.repeat(72)}`);
      console.log(`# [${i + 1}/${items.length}] ${item.setId}/${item.id}   fingerprint:${fingerprint(item)}`);
      console.log(`# source: ${src.label}   ->  ${item.setId}-${item.id}.png`);
      console.log(`${'='.repeat(72)}`);
      console.log(src.render(item));
      console.log();
    });
  },

  /* Maps each sticker id to its expected asset path and prompt fingerprint, so the
     kiosk build can tell which art is missing or stale. */
  manifest(flags) {
    const out = {
      styleVersion: style.version,
      generated: null,
      stickers: select(flags).map(item => ({
        id: item.id,
        set: item.setId,
        file: `public/assets/stickers/${item.setId}-${item.id}.png`,
        fingerprint: fingerprint(item),
      })),
    };
    console.log(JSON.stringify(out, null, 2));
  },

  /*
   * Paste-ready prompt sheet.
   *
   * --mode=session (default) emits one style preamble followed by short per-sticker
   * follow-ups. Chat image generators hold style far better across a conversation
   * than they do across repeated self-contained prompts, and drift between separately
   * prompted images is the main way a set stops looking like a set.
   *
   * --mode=standalone repeats the full style block every time, for one-shot use or
   * an API loop where there is no conversation to carry the style.
   */
  export(flags) {
    const items = select(flags);
    const mode = flags.mode || 'session';
    const src = getSource(flags.source || 'codex');

    console.log(`# Sticker prompts — ${src.label} — ${mode} mode`);
    console.log(`# style v${style.version} · ${items.length} stickers`);
    console.log(`#`);
    console.log(`# Save each result as the filename given above its prompt, into tmp/,`);
    console.log(`# then map it in tools/stickers/ingest.map.json and run the ingest script.`);
    console.log();

    if (mode === 'standalone') {
      items.forEach((item, i) => {
        console.log(`## ${i + 1}. ${item.setId}-${item.id}.png`);
        console.log('```');
        console.log(src.render(item));
        console.log('```');
        console.log();
      });
      return;
    }

    console.log(`## 0. Style preamble — send this first, once per session`);
    console.log('```');
    console.log([
      `I need a set of sticker images for a Korean-themed cafe photobooth. They must look like one set, so hold this style exactly for every image I ask for in this conversation:`,
      ``,
      `Medium: ${style.medium}.`,
      `Line: ${style.lineWeight}.`,
      `Shading: ${style.shading}.`,
      `Color: ${style.paletteRule}.`,
      `Composition: ${style.composition}.`,
      `Background: ${style.background}.`,
      `Mood: ${style.mood}.`,
      `Constraints: ${style.text}. The result ${style.readability}.`,
      `Avoid: ${style.negative.join(', ')}.`,
      `Output: ${style.output.size} ${style.output.format}. ${style.output.note}`,
      ``,
      `Reply "ready" and wait. Then I will name one subject at a time. For each, generate exactly one image in the style above and nothing else.`,
    ].join('\n'));
    console.log('```');
    console.log();

    items.forEach((item, i) => {
      console.log(`## ${i + 1}. ${item.setId}-${item.id}.png`);
      console.log('```');
      console.log(`Same style. Subject: ${subjectClause(item)}.`);
      console.log('```');
      console.log();
    });
  },

  /* Emits paste-ready sticker definitions for the SETS array in public/index.html. */
  stub(flags) {
    const items = select(flags);
    const bySet = {};
    for (const it of items) (bySet[it.setId] ||= []).push(it);
    for (const [setId, list] of Object.entries(bySet)) {
      console.log(`  { id: '${setId}', label: '${catalog.sets[setId].label}', items: [`);
      for (const it of list) {
        console.log(`    { label: '${it.id}', style: image('/assets/stickers/${setId}-${it.id}.png', 64) },`);
      }
      console.log(`  ] },`);
    }
  },
};

const { flags, rest } = parseArgs(process.argv.slice(2));
const cmd = rest.shift() || 'list';
if (!commands[cmd]) {
  console.error(`usage: engine.mjs <list|prompt|batch|export|manifest|stub> [--set=<id>] [--source=claude|codex|raw]`);
  process.exit(1);
}
try {
  commands[cmd](flags, rest);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
