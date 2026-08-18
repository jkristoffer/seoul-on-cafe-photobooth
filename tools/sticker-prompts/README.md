# Sticker prompt engine

Composes image-generation prompts for the photobooth sticker sets.

The problem this solves: image generators are bad at making 20 images that look like
one set. The fix is to never write prompts by hand. `style.json` holds the style
contract, `subjects.json` holds only subject noun phrases, and the engine welds them
together so every prompt in a set is identical except for the subject.

## Files

| File | Role |
|---|---|
| `style.json` | The style lock — line weight, palette, framing, negatives, output spec. Shared verbatim by every prompt. |
| `subjects.json` | The catalog. Each item contributes **only** what the thing is, never how it looks. |
| `engine.mjs` | Composes prompts, emits manifests and kiosk-ready sticker stubs. |

## Usage

```sh
node tools/sticker-prompts/engine.mjs list                        # catalog
node tools/sticker-prompts/engine.mjs prompt dog-coffee --source=codex
node tools/sticker-prompts/engine.mjs batch --set=mascot --source=claude
node tools/sticker-prompts/engine.mjs manifest > tools/sticker-prompts/manifest.json
node tools/sticker-prompts/engine.mjs stub --set=menu             # paste into SETS in public/index.html
```

### Generating a set

```sh
node tools/sticker-prompts/engine.mjs export --source=codex > PROMPTS-codex.md
```

`--mode=session` (the default) emits one style preamble to send first, then a short
follow-up per sticker. Chat image generators hold a style far better across a
conversation than across repeated self-contained prompts, and drift between
separately prompted images is the main way a set stops looking like a set. Use
`--mode=standalone` for an API loop, where there is no conversation to carry style.

Save each result under the filename printed above its prompt, map it in
`tools/stickers/ingest.map.json`, and run `tools/stickers/ingest.mjs`.

`--source` picks the adapter: `claude`, `codex`, or `raw` (bare prompt, for an image
UI or an API call). Adapters change only the framing around the prompt — the body is
byte-identical across sources, so art from two different generators still matches.

## Fingerprints

`manifest` stamps each sticker with a hash of the exact words sent. Edit `style.json`
and every fingerprint changes, which is how you tell that art already on disk was made
against an older style and needs regenerating. Bump `style.version` when you do that.

## Adding a sticker

Add an entry to the right set in `subjects.json`. Keep `subject` to the object itself —
if you find yourself writing "flat" or "green" or "centered", that belongs in
`style.json` instead, and putting it in a subject is what makes a set drift.

## Conventions

- Generated art lands in `public/assets/stickers/<set>-<id>.png`.
- 1024x1024 PNG with alpha. If a generator can't emit alpha, the prompt asks for a
  `#FF00FF` field to key out.
