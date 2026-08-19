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

## The countdown beeps are synthesised, not generated

`count.mp3` and `count_go.mp3` come from ffmpeg's sine generator, not from the API.
Asked for a 100 ms pip, the model returned sustained tones of 460–800 ms — four to
five times too long, and near 0 dBFS. A countdown pip has exactly two requirements,
an exact length and an exact pitch, and both are things a synth gives you for free
and a generative model will not give you reliably at any prompt.

```sh
ffmpeg -f lavfi -i "sine=frequency=880:duration=0.10:sample_rate=44100" \
  -af "afade=t=in:st=0:d=0.004,afade=t=out:st=0.035:d=0.065,volume=0.7" count-synth.mp3
```

880 Hz (A5) for the pip on 3 and 2, 1318.5 Hz (E6) for the final — a fifth up, the
same interval `confirm.mp3` rises by, so the booth's pitched sounds belong to one
family.

## Levels

Targets differ by role, because these do not all compete with the room equally:

| Asset | Target | Why |
|---|---|---|
| `shutter` | −16 LUFS | Has to cut through a cafe. |
| `place`, `confirm`, `back` | −17 LUFS | Present but not startling. |
| `tap` | −18 LUFS | Fires 40× a session. |
| `eject` | −18 LUFS | Sustained, sits under the moment. |
| `voice/*` | −16 LUFS | Speech has to stay intelligible over the room. |
| `music/shoot` | −20 LUFS | Under the beeps and the shutter, never over them. |
| `music/attract` | −30 LUFS | If it is audible over the cafe playlist it is too loud. |

**LUFS is meaningless under about 400 ms** — `ebur128` returns its −70 gate floor
for a 100 ms pip, and `loudnorm` cannot target what it cannot measure. The two
beeps are peak-normalised instead, to −9 and −7 dBFS. They are pure tones, which
read louder than broadband material at equal peak, so they sit lower than the
numbers suggest.

## Voice

Korean and Malay are **separate performances by separate voices**. A single voice
carrying both will be accented in at least one of them, and the accented one is
the language whose speakers notice. All candidates are English-native voices
speaking through a multilingual model, so both carry some accent — the choice is
which one is acceptable where. Current picks: Jessica for Korean, Lily for Malay.

`lines.json` holds the character description, the register rules, and every line
with an English gloss. Read the rules before adding a line — the constraint that
matters most is that a line must survive its 200th play in a small room.

**Seven lines ship in each language**, as `voice/<lang>-<id>.mp3`: `welcome`,
`ready`, `select`, `filter`, `decorate`, `done`, `qr`. Six more are written and
deliberately **not** recorded — each carries a `role` of `retired` in `lines.json`
with the reason attached. Read them before adding a line; they are the ways a line
fails here:

- `countdown` — the count is beeps. A voice counting to three four times a session
  is the fastest way to make a booth tiresome. It stays in the file because three
  counted numbers expose a voice's rhythm and accent faster than any other phrase,
  which makes it the right thing to audition a replacement voice with.
- `frame` — the welcome already lands on that screen. Two lines back to back on one
  screen is over-talking.
- `printing` — it would sit on top of the 3.16 s eject motor, and the motor says
  "printing" better than words do.
- `between`, `between_alt`, `last` — **the shoot is voiceless.** These three were
  written, recorded, shipped, and then cut after listening: a line in every gap
  turns the shoot into a running commentary, and the beeps already carry the only
  thing a guest needs to hear there.

The between-shot lines are the cautionary tale of this directory. They were also
the hardest to fit — the first drafts ("그거예요!", "Ha, macam tu!") measured 1.4 s
against a 700 ms gap, so they were cut to single words and `CONFIG.shotGapMs` was
widened to 1200 ms to give even those margin. All of that work was correct and none
of it was the right question, which was whether the gap wanted a voice at all. The
gap is back to 700 ms.

**Measure every take.** A phrase is not as long as it looks on the page: `ms-qr`
came back at 3.4 s and `ko-done` at 3.0 s against a stated 2.5 s ceiling, and an
audio tag changes duration on its own — adding `[warmly]` to `ms-decorate` took it
from 1.61 s to 2.05 s.

**Tags are how tone gets fixed.** `eleven_v3` reads bracketed tags as direction and
does not speak them, and they can change mid-line: `wake` in Malay is
`[cheerful] Selamat datang! [warmly] Rasanya cantik ni.` — bright on the greeting,
soft on the compliment. A flat read is a missing tag, not a bad voice.

## Music

Two beds ship, both scoped to bounded moments — never a loop running under the
whole session, because the booth stands inside a cafe that already plays music and
would be the one sounding wrong.

- `music/attract.mp3` — the idle screen only, at −30 LUFS.
- `music/shoot.mp3` — `startShoot()` to the fourth shutter, 16 s, at −20 LUFS.

The attract bed is a **seamless loop**, which the generator does not produce on its
own: a 30 s track was folded into 28 s by crossfading its last two seconds over its
first two, so the wrap is inaudible.

```sh
ffmpeg -i attract-raw.mp3 -filter_complex \
  "[0:a]atrim=0:2,asetpts=PTS-STARTPTS[head];[0:a]atrim=2,asetpts=PTS-STARTPTS[body];\
   [body][head]acrossfade=d=2:c1=tri:c2=tri,loudnorm=I=-30:TP=-3[out]" -map "[out]" attract.mp3
```

Both levels still want confirming in the actual room with the actual cafe playlist
running. −30 LUFS is a considered guess, not a measurement.

