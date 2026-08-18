# Sound

Renders the booth's sound effects, voice lines and music from ElevenLabs **once**,
at build time.

The kiosk never calls this API. It is unattended, nothing in it is allowed to block
on the network, and the key must reach neither the browser nor a serverless
function. Everything is generated here, auditioned, trimmed, and committed as a
static asset under `public/assets/sfx/`.

## Files

| File | Role |
|---|---|
| `effects.json` / `generate.mjs` | Sound effects. One entry per sound, several takes each; a take is a prompt plus a `prompt_influence`. |
| `lines.json` / `voice.mjs` | The attendant's script and character, in Korean and Bahasa Malaysia. |
| `music.json` / `music.mjs` | Music beds. |
| `trim.mjs` | Turns a raw take into a shippable asset. Nothing ships without going through it. |

Everything writes to `tmp/sfx/` (gitignored). Winners are promoted by hand.

## The key

Lives in `.env.sfx` at the repo root, gitignored, and deliberately **not** `.env`:
`vercel dev` loads `.env` into the functions' environment, and this key has no
business there.

The key is scoped — it can synthesise (`sound-generation`, `text-to-speech`,
`music`) but cannot read the account or list voices. Voice IDs therefore have to
be written down in `lines.json` rather than discovered.

## Usage

```sh
node tools/sfx/generate.mjs list
node tools/sfx/generate.mjs gen shutter            # every take of one effect
node tools/sfx/generate.mjs gen shutter:b eject    # one take, plus all of another

node tools/sfx/voice.mjs list                      # the script, with glosses
node tools/sfx/voice.mjs audition ko:countdown     # one line, every candidate voice
node tools/sfx/voice.mjs gen ko:done ms:done

node tools/sfx/music.mjs gen attract
```

## Raw output is never shippable

Generated audio is padded and its level is arbitrary. Takes of the same sound
arrived **20 dB apart**, and one shutter came back with **340 ms of silence in
front of the click** — which would have landed the sound a third of a second
behind the flash and read as a broken booth rather than a late sound. One take
rendered at −41 dBFS, i.e. nothing at all.

```sh
node tools/sfx/trim.mjs tmp/sfx/shutter-a.mp3 public/assets/sfx/shutter.mp3 --lufs=-16 --fade
```

`trim.mjs` measures the bounds per file with `silencedetect` and applies them with
an explicit `atrim`. It does **not** use ffmpeg's `silenceremove`, which cannot do
this job: the default RMS detection eats the decay of a short transient (a 240 ms
stamp came out at 80 ms), and `detection=peak` leaves the tail on anything whose
noise floor sits above the threshold. Every generated file has a different floor,
so the threshold has to be measured rather than assumed.

Judge a take on its waveform, not its description. Lead silence is latency, and a
"single click" that rings for 600 ms will stack tails across a four-shot session.

## Levels

Targets differ by role, because these do not all compete with the room equally:

| Asset | LUFS | Why |
|---|---|---|
| `shutter` | −16 | Has to cut through a cafe. |
| `place`, `confirm`, `back` | −17 | Present but not startling. |
| `tap` | −18 | Fires 40× a session. |
| `eject` | −18 | Sustained, sits under the moment. |
| attract music | −30 | If it is audible over the cafe playlist it is too loud. |

## Voice

Korean and Malay are **separate performances by separate voices**. A single voice
carrying both will be accented in at least one of them, and the accented one is
the language whose speakers notice. All candidates are English-native voices
speaking through a multilingual model, so both carry some accent — the choice is
which one is acceptable where. Current picks: Jessica for Korean, Lily for Malay.

`lines.json` holds the character description, the register rules, and every line
with an English gloss. Read the rules before adding a line — the constraint that
matters most is that a line must survive its 200th play in a small room.

## Music

Generated, but hold it. The booth stands inside a cafe that already plays music,
and a continuous loop puts two playlists in one room, out of key and out of tempo
with each other. The booth is the newcomer and the louder one at close range, so
the booth is what sounds wrong. The defensible uses are bounded: a heavily ducked
attract loop, and a 16-second bed across the shoot sequence. Decide it in the
actual room with the actual playlist running.
