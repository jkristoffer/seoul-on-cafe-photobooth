# SE/O UL Photo Booth

A kiosk photo booth for Cafe on Seoul. Guests shoot four frames, pick one, apply
a filter and stickers, and walk away with a polaroid — plus a QR code that gives
them the digital file for 24 hours.

## Layout

```
public/index.html      the kiosk itself — fixed 1280x800 stage, vanilla JS
public/p.html          guest download page, served at /p/:id
public/g.html          guest book — /guestbook (archive) and /wall (display)
public/m.html          staff moderation, served at /mod
public/assets/         brand mark (alpha mask + square favicon)
api/_db.ts             shared Supabase client, TTL and id format
api/upload.ts          POST a composited JPEG, returns { id, shareUrl, qr }
api/photo.ts           GET ?id= — resolves a short code to a blob URL
api/entry.ts           POST — the guest's consent, message and takedown
api/guestbook.ts       GET — the consented feed, newest first
api/moderate.ts        GET/POST — staff review and takedown, behind MOD_SECRET
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

## The guest book

Consented photos go on a wall in the cafe and into a browsable archive.

| Surface | What it is |
|---|---|
| `/wall` | A display screen. One row of four, replaced whole every 20s, nothing operable. Reads the feed uncached. |
| `/guestbook` | The archive. Scrolls back through time on a keyset cursor. |
| `/mod` | Staff review and takedown. Passcode, phone-shaped, English only. |

The first two are `public/g.html`; the wall is a body class, because the
difference between them is who is looking, not how the data is shaped.

**An entry is a photo row with `consented_at` set.** No second table, no join,
and withdrawal is just clearing the column. That one column drives three things
at once: the purge skips the row, `/api/photo` stops returning 410 for it, and
`/api/guestbook` starts including it.

Consent is only ever the guest's own act, from two surfaces:

- **The kiosk**, on the print screen, once the upload has a code. It rides on the
  same resolution as the QR because both need one. There is no text entry here —
  the booth asks the yes/no and points at the QR for the message.
- **The QR page**, which is the surface with a real keyboard. It is the only place
  a message is written and the only place an entry can be taken back down.

Three consequences worth knowing before changing any of this:

- **A standing entry's link does not expire.** This is not a loosened promise but
  a requirement: the link is the guest's whole credential over the entry, and a
  page that has gone 410 cannot offer them the button that takes it down. The
  24-hour countdown is hidden while the entry stands and returns the moment it
  stops — whether the guest withdrew or staff took it down. Note *standing*, not
  *consented*: see the moderation section for why the difference matters.
- **An entry is mutable.** A message can land minutes after the photo went up, so
  the wall has to handle an entry gaining a caption between polls.
- **Declining sends no request.** Private is what the row already says, and the
  booth should not need the network to keep a promise it has already kept.

`/api/guestbook` is the one endpoint in the system that enumerates photos, which
everything else is built to prevent. It is safe only because of its `where`
clause, so its column list is deliberately narrow — in particular the code never
leaves the table, because the code is what edits an entry. Reading through a
function rather than opening an RLS policy to the anon key keeps the browser side
dependency-free and makes the returned columns explicit rather than whatever a
row filter happens to leave behind.

**The guest book is never empty.** Three of the cafe's own photos from
[@cafe_on_seoul](https://www.instagram.com/cafe_on_seoul/) ship as seeded rows —
ordinary entries with `source = 'instagram'`, so they sort by their real post
dates and sink as guests arrive. No second code path and no flicker on the day
the first guest consents. Their bytes are committed assets under
`public/assets/guestbook/`, not Vercel Blob, cropped square out of the marketing
posters they were published in (the uncropped originals are kept alongside).

`source` also makes them immutable: their codes are written down in a migration,
and `/api/entry` authorises on the code alone, so without that guard anyone who
read the repo could take the cafe's photos down.

### Moderation

An entry reaches the wall in about twenty seconds with nobody having approved it.
That is on purpose — a guest who consents at the booth should see themselves
before they leave — and the price of it is that there has to be a fast way back
off. `/mod` is that way: a phone-shaped list of every consented entry, hidden
ones included, with **take down**, **put back** and **clear message**.

Everything works through **one column, `hidden_at`**. That is deliberate: the next
thing to want a photo off the wall is an automatic screen rather than a person,
and it should set this same column rather than invent a second state.

- **Access is a shared passcode**, `MOD_SECRET`, checked with a constant-time
  compare and held in `localStorage` on the device. Unset, `/api/moderate` returns
  503 and the page says so — the same fail-closed shape as the purge cron. There
  are no accounts, which does mean actions are not attributable to a person.
- **Nothing is destroyed.** Hiding leaves the row, the bytes and the guest's words
  exactly as they were, so a takedown made in a hurry is one tap from undone. The
  hidden row therefore stays *on the moderation list*, dimmed — an entry that
  vanished when it was hidden could not be put back.
- **Staff may delete words, never write them.** `clearMessage` is the only thing
  that touches the text. A moderator who could edit it could put a sentence in a
  stranger's mouth under that stranger's photo.
- **Two columns, two people, no overwriting.** `consented_at` is the guest's
  decision and `hidden_at` is the cafe's. An entry a guest withdrew stays down
  whatever staff do, and a removed entry cannot be re-consented or re-captioned
  from the phone — `/api/entry` returns 403 `removed`. Withdrawal stays open,
  because a guest can always stop consenting to something.
- **A takedown ends the hosting exemption.** This is the subtle one. Consent
  exempts a photo from the 24-hour life; if a hidden entry kept that exemption it
  would sit on a live, never-expiring link for ever — the one outcome a takedown
  exists to prevent. So the exemption tracks the entry *standing*, not the consent:
  `/api/photo`, `/api/entry` and the purge all read `consented_at && !hidden_at`,
  and a removed photo falls back to its original deadline. The guest's page says
  so plainly rather than offering buttons the server will refuse.
- **`/api/moderate` is the only place the 8-character codes leave the table**,
  which is why the passcode guards the GET and not just the POST. The code is the
  credential; the takedown has to act on it; nothing else may enumerate it.
- **How fast a takedown lands** is the wall's poll interval, about 20 seconds.
  That is the floor and there is no way under it short of pushing to the screen:
  the wall cannot act on a removal it has not asked about yet. Which is why the
  wall reads past the CDN (`?live=1` → `no-store`) rather than the feed being
  purged on takedown — a purge is possible (`Vercel-Cache-Tag` plus
  `dangerouslyDeleteByTag`, *not* `invalidateByTag`, which only marks stale and
  would serve the removed photo to the next viewer anyway) but it buys nothing
  the poll does not already cost, in exchange for a dependency. The archive still
  caches, briefly, because nobody is standing in front of it waiting.

  The price is that every poll is a real function invocation — roughly 130k a
  month per wall screen at 20 seconds. `POLL_MS` in `g.html` is that dial.

**Still to build:** automatic screening (it would set `hidden_at`, so nothing else
has to change) and a retention limit — "permanent" is currently literal.

## The 24-hour promise

Two separate mechanisms, because Vercel Blob has no native TTL:

1. `/api/photo` returns **410 Gone** once `uploadedAt + 24h` has passed. This is
   what actually enforces the expiry the kiosk prints on screen. A photo with a
   standing guest book entry is exempt — see the guest book above.
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
`BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `MOD_SECRET`. The last is the staff
passcode for `/mod`; it is sensitive, so it goes in `.env` by hand too, and
without it moderation is switched off rather than left open.

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
