# SE/O UL Photo Booth

A kiosk photo booth for Cafe on Seoul. Guests shoot four frames, pick one, apply
a filter and stickers, and walk away with a polaroid — plus a QR code that gives
them the digital file for 24 hours.

## Layout

```
public/index.html   the kiosk itself — fixed 1280x800 stage, vanilla JS
public/p.html       guest download page, served at /p/:id
api/upload.ts       POST a composited JPEG, returns { id, shareUrl, qr }
api/photo.ts        GET ?id= — resolves a short code to a blob URL
api/cron/purge.ts   deletes blobs past the 24h TTL
```

The kiosk is deliberately dependency-free and unbundled. It is a fixed-size
stage scaled with a CSS transform, so the whole layout is tuned once for 1280x800
and every element sits at a known pixel position.

## No database

The blob path *is* the short code: a photo lives at `photos/<CODE>.jpg`, and
`/api/photo` resolves it with a prefix `list()`. Codes are 8 characters from a
Crockford-style alphabet (no I/L/O/U), which is ~1.1 x 10^12 combinations —
enough that guessing a stranger's photo inside its 24-hour life isn't practical.

The Blob store is **public**: anyone holding the URL can fetch the image, which
is inherent to "scan this QR to download." Photos are not private data beyond
the unguessable code plus the TTL.

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
npx vercel link          # once
npx vercel env pull      # fetches BLOB_READ_WRITE_TOKEN into .env.local
npx vercel dev --listen 3999
```

Note there is intentionally **no `dev` npm script** — `vercel dev` runs the
project's `dev` script, so defining one as `vercel dev` makes it recurse.

`getUserMedia` needs a secure context. `localhost` counts; opening `index.html`
over `file://` does not, and the kiosk will fall back to simulated shots.

Typecheck the functions with `npm run build` (`tsc --noEmit`).

## Deploy

```bash
npm run deploy
```

Requires a Blob store linked to the project (`npx vercel blob create-store
photobooth --access public`) and **Deployment Protection turned off** — guests
scanning the QR are anonymous and cannot log into Vercel.

## Kiosk operation

- `CONFIG` at the top of the script controls shots per session, countdown length,
  whether the QR shows, and the idle-reset timeout (default 120s).
- The session auto-resets after idle, but never mid-shoot or mid-print.
- A screen wake lock is requested on load and re-acquired when the tab becomes
  visible again.
- Run the browser fullscreen at 1280x800 or wider; the stage scales to fit.
