#!/usr/bin/env node
/**
 * Sticker asset ingest.
 *
 * Raw generator output is far too heavy to ship to a kiosk — 1254px PNGs at ~1.8MB
 * each would be 11MB for six stickers, over a connection that has to stay responsive
 * between guests. This trims the transparent margin (generators rarely fill the
 * frame), fits the art to the size the polaroid bake actually samples, and strips
 * metadata.
 *
 * Target size is derived from the kiosk: OUT.scale(3) x PHOTO(332px) = 996 device px
 * for the photo window, so a badge covering ~55% of it needs ~550px. 512 is the
 * nearest sane power of two and leaves the bake nothing to upscale.
 *
 *   node tools/stickers/ingest.mjs --map=tools/stickers/ingest.map.json
 *   node tools/stickers/ingest.mjs --map=... --size=384 --dry
 *
 * Requires ImageMagick (`magick`).
 */

import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const SIZE = Number(args.size || 512);
const OUT_DIR = args.out || 'public/assets/stickers';
const DRY = !!args.dry;

if (!args.map) {
  console.error('usage: ingest.mjs --map=<file.json> [--size=512] [--out=dir] [--dry]');
  process.exit(1);
}

function have(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}
if (!have('magick')) {
  console.error('error: ImageMagick not found. `brew install imagemagick`');
  process.exit(1);
}

const map = JSON.parse(readFileSync(args.map, 'utf8'));
if (!DRY) mkdirSync(OUT_DIR, { recursive: true });

const kb = n => (n / 1024).toFixed(0) + 'KB';
let totalIn = 0, totalOut = 0;

for (const entry of map.assets) {
  const { src, set, id } = entry;
  if (!existsSync(src)) {
    console.error(`  MISSING  ${src}`);
    process.exitCode = 1;
    continue;
  }
  const dest = join(OUT_DIR, `${set}-${id}.png`);
  const inSize = statSync(src).size;
  totalIn += inSize;

  if (DRY) {
    console.log(`  would write  ${dest}  (from ${basename(src)}, ${kb(inSize)})`);
    continue;
  }

  execFileSync('magick', [
    src,
    '-background', 'none',
    // Generators leave uneven transparent margins; trimming first means every
    // sticker's art fills its box consistently, so placement is predictable.
    '-trim', '+repage',
    '-resize', `${SIZE}x${SIZE}>`,
    '-strip',
    // 256-color palette is plenty for flat sticker art and roughly halves the file.
    '-colors', '256',
    '-define', 'png:compression-level=9',
    dest,
  ]);

  const outSize = statSync(dest).size;
  totalOut += outSize;
  const dims = execFileSync('magick', ['identify', '-format', '%wx%h', dest]).toString();
  console.log(`  ${dest.padEnd(46)} ${dims.padEnd(10)} ${kb(inSize)} -> ${kb(outSize)}`);
}

if (!DRY && totalOut) {
  console.log(`\ntotal: ${kb(totalIn)} -> ${kb(totalOut)}  (${(100 - totalOut / totalIn * 100).toFixed(0)}% smaller)`);
}
