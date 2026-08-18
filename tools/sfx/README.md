# Sound effects

Renders the booth's sound effects from ElevenLabs **once**, at build time.

The kiosk never calls this API. It is unattended, nothing in it is allowed to block
on the network, and the key must reach neither the browser nor a serverless
function. Sounds are generated here, auditioned, and committed as static assets.

## Files

| File | Role |
|---|---|
| `effects.json` | The catalog — one entry per sound, each with several takes. A take is a prompt plus a `prompt_influence`. |
| `generate.mjs` | Calls the API and writes every take to `tmp/sfx/` (gitignored). |

## The key

Lives in `.env.sfx` at the repo root, gitignored, and deliberately **not** `.env`:
`vercel dev` loads `.env` into the functions' environment, and this key has no
business there. `generate.mjs` reads `.env.sfx` directly.

The key is scoped — it can synthesise (`sound-generation`, `text-to-speech`) but
cannot read the account or list voices, so voice IDs have to be written down
rather than discovered.

## Usage

```sh
node tools/sfx/generate.mjs list                   # catalog and takes
node tools/sfx/generate.mjs gen shutter            # every take of one effect
node tools/sfx/generate.mjs gen shutter:b eject    # one take, plus all of another
```

## Raw output is not shippable

Every generated take needs a trim-and-level pass before it goes anywhere near
`public/assets/sfx/`. The API pads its output: one shutter take arrived with
**340 ms of silence in front of the click**, which would have landed the sound a
third of a second behind the flash and read as a broken booth. Levels vary by
20 dB between takes of the same sound.

```sh
# transient (shutter, ticks): trim both ends, normalise, short fade out
ffmpeg -i tmp/sfx/shutter-a.mp3 -af "silenceremove=start_periods=1:start_threshold=-50dB,\
areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,\
loudnorm=I=-16:TP=-1.5,afade=t=out:st=0.3:d=0.05" public/assets/sfx/shutter.mp3

# sustained (eject motor): trim the head only, quieter target so it sits under the room
ffmpeg -i tmp/sfx/eject-b.mp3 -af "silenceremove=start_periods=1:start_threshold=-50dB,\
loudnorm=I=-18:TP=-1.5" public/assets/sfx/eject.mp3
```

Judge a take on its waveform, not just its description — lead silence is latency,
and a "single click" that rings for 600 ms will stack tails across a four-shot
session.
