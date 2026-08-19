# SE/O UL Photo Booth

A kiosk photo booth for Cafe on Seoul. Guests shoot four frames, pick one, apply
a filter and stickers, and walk away with a polaroid — plus a QR code that gives
them the digital file for 24 hours.

## Layout

```
public/index.html      the kiosk itself — fixed 1280x800 stage, vanilla JS
public/p.html          guest download page, served at /p/:id
public/assets/         brand mark (alpha mask + square favicon)
api/_db.ts             shared Supabase client, TTL and id format
api/upload.ts          POST a composited JPEG, returns { id, shareUrl, qr }
api/photo.ts           GET ?id= — resolves a short code to a blob URL
api/cron/purge.ts      deletes expired blobs, keeps the rows
supabase/migrations/   schema, applied with `supabase db push`
```

The kiosk is deliberately dependency-free and unbundled. It is a fixed-size
stage scaled with a CSS transform, so the whole layout is tuned once for 1280x800
and every element sits at a known pixel position.

## Storage split

Bytes go to **Vercel Blob**; the record goes to **Supabase Postgres**. A photo
lives at `photos/<CODE>.jpg` and has a matching row in `public.photos` keyed by
the same code. Codes are 8 characters from a Crockford-style alphabet (no
I/L/O/U) — ~1.1 x 10^12 combinations, enough that guessing a stranger's photo
inside its 24-hour life isn't practical.

The row is the source of truth: `/api/photo` does an indexed primary-key lookup,
and the row records which frame, filter and sticker count the guest chose, so
you can see which looks actually get used. Rows outlive the images — the purge
job stamps `purged_at` instead of deleting, keeping the stats.

RLS is **on with no policies**, so the anon key cannot read the table at all.
Every access goes through the serverless functions using `SUPABASE_SECRET_KEY`,
which bypasses RLS. That key must never reach the kiosk.

The Blob store itself is **public**: anyone holding the URL can fetch the image,
which is inherent to "scan this QR to download." Photos are not private data
beyond the unguessable code plus the TTL.

## The brand mark

`assets/logo-mask.png` is an alpha mask, not a picture — white letterforms on
transparency, derived from the source artwork. It is applied with CSS
`mask` plus `background-color: currentColor`, so the wordmark takes the colour of
whatever it sits on: cream on the green chrome, green on cream. Using the source
JPEG directly would paste its own `#084325` background over the kiosk's
`#123B26` and show a visible square.

## The 24-hour promise

Two separate mechanisms, because Vercel Blob has no native TTL:

1. `/api/photo` returns **410 Gone** once `uploadedAt + 24h` has passed. This is
   what actually enforces the expiry the kiosk prints on screen.
2. The daily cron deletes the bytes. Hobby plans cap crons at once per day, so
   files can linger a few hours after their link has already gone dead.

## Compositing

Everything the guest sees on the polaroid is DOM and CSS, so it can't be saved
as-is. `composite()` redraws it on a canvas at 3x: frame colour, the chosen shot
with the CSS filter re-applied via `ctx.filter`, every sticker, and the caption.

This is why each sticker style in `SETS` carries **two** representations — `css`
for the live overlay and `draw` for the canvas. **They must be kept in sync.**
Adding a sticker style without a `draw` spec means it silently vanishes from the
printed photo.

## Failure behaviour

The booth is unattended, so nothing blocks on the network. `startPrint()` runs
the eject animation and the upload concurrently; if the upload fails the polaroid
still prints on schedule and the QR card says the digital copy is unavailable
rather than showing a dead code.

If the camera is unavailable the kiosk falls back to generated placeholder frames
and offers a retry button, so a permissions prompt doesn't strand the session.

## Local development

```bash
npm install
npx vercel link                    # once
npx vercel env pull .env.local     # non-sensitive vars only
npx vercel dev --listen 3999
```

Two things that will waste your afternoon otherwise:

- **Sensitive variables cannot be pulled.** `SUPABASE_SECRET_KEY` and
  `CRON_SECRET` are marked sensitive, so `env pull` returns them empty. Put them
  in `.env` by hand. `vercel dev` reads `.env` *and* `.env.local`, `.env` wins,
  and it rewrites `.env.local` on startup — so `.env` is the file that survives.
  It must therefore also carry `BLOB_READ_WRITE_TOKEN`, or the blob calls lose
  their credentials to the shadowing.
- **There is intentionally no `dev` npm script.** `vercel dev` runs the project's
  `dev` script, so defining one as `vercel dev` makes the CLI recurse and refuse
  to start.

Required variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`.

### Database changes

```bash
supabase link --project-ref <ref>
supabase db push
```

Note that the project's new-style `sb_secret_…` API keys are not active; the
functions authenticate with the legacy `service_role` JWT.

`getUserMedia` needs a secure context. `localhost` counts; opening `index.html`
over `file://` does not, and the kiosk will fall back to simulated shots.

Typecheck the functions with `npm run build` (`tsc --noEmit`).

## Deploy

```bash
npm run deploy
```

Live at **https://cafe-on-seoul.vercel.app**. The QR encodes whatever host served
the request, so the booth follows its domain with no code change.

Renaming the Vercel project does *not* move the hostname on its own — the new
`<name>.vercel.app` has to be claimed as a project domain, and the old one stays
attached until removed:

```bash
npx vercel project rename <old> <new>
npx vercel domains add <new>.vercel.app <new>
npx vercel deploy --prod
npx vercel alias rm <old>.vercel.app --yes
```

Use `domains add`, not `alias set`: a bare deployment alias is not treated as a
production domain and stays behind Deployment Protection, which would send every
guest scanning a QR to a Vercel login.

Requires a Blob store linked to the project (`npx vercel blob create-store
cafe-on-seoul --access public`). Deployment Protection covers deployment-specific
URLs but not the production alias, so guests scanning a QR from production are
fine — a QR generated from a *preview* deployment will demand a Vercel login.

## Sound

Every sound is a static asset under `public/assets/sfx/`, generated once by
`tools/sfx` and committed. The kiosk never calls a speech or audio API at
runtime — see `tools/sfx/README.md` for how the assets are made and why the raw
output of a generator is never shippable.

Effects are decoded into `AudioBuffer`s at startup and played through a Web Audio
graph rather than `<audio>` elements, because the shutter has to land on the same
frame as the flash and an element drifts by tens of milliseconds on first play. A
missing file is never fatal: `play()` no-ops on a buffer that failed to load.

The soft bed runs under **every screen except the shoot**, which belongs to the
camera — the countdown beeps and the shutter need clear air, and the shoot has its
own 16-second bed. It is one continuous loop, not a track restarted per screen:
`playMusic()` no-ops when the requested bed is already playing, so the same source
node plays from the moment a guest starts through to the reset back to attract.

Three things are easy to get wrong here:

- **Nothing plays before a gesture.** The autoplay policy is why the picker is the
  start control. The context is still built at load, suspended, so decoding
  finishes long before anyone taps and `audioUnlock()` only has to resume it.
- **A bed can be asked for before it has decoded.** A guest who taps the instant
  the page paints would otherwise get silence for the whole session, because
  `playMusic()` ran once, found no buffer and gave up. The request is remembered
  in `audio.wantMusic` and started from the decode callback instead.
- **The countdown beep is gated on the countdown, not on the digit.** During the
  700 ms gap between shots the display already shows the next `3`, so beeping
  whenever the number changes puts a pip barely 100 ms behind the shutter, which
  sounds like a stutter. `countBeep()` only fires inside the real countdown
  window and is latched off at each capture.

`CONFIG` carries `sound`, `volume`, `music`, `musicVolume` and `chatter`, so staff
can kill the audio, just the music, or just the talking without touching the assets.

## Voice

The attendant speaks seven times a session, in the guest's chosen language. Each
line is announced by `show()` 280 ms after its screen turns over, so the voice never
talks across the transition it belongs to.

Voice is serialised through **one slot**, because the booth generates overlaps
naturally and two lines at once is unintelligible. Which way an overlap resolves is
the caller's choice: an unqueued line replaces whatever is speaking, since it
belongs to the screen the guest is on now; a queued line waits. Only `qr` queues —
it follows `done`, which carries the only real instruction in the booth and is not
allowed to be cut off.

- **The shoot is voiceless.** Between-shot encouragement was built and then cut: a
  line in every gap turns the shoot into a running commentary, and the beeps
  already carry the only thing a guest needs to hear there.
- **Announce timers outlive their screen.** A guest tapping through faster than
  280 ms would be announced two screens behind themselves, so the timer re-checks
  `state.screen` before it speaks.
- **`chatter: false` keeps the bookends.** The welcome and the print line ignore it.
  A booth that never says how to hold a developing polaroid is worse than a quiet
  one.

## Kiosk operation

- `CONFIG` at the top of the script controls shots per session, countdown length,
  whether the QR shows, and the idle-reset timeout (default 120s).
- The session auto-resets after idle, but never mid-shoot or mid-print.
- A screen wake lock is requested on load and re-acquired when the tab becomes
  visible again.
- Run the browser fullscreen at 1280x800 or wider; the stage scales to fit.
