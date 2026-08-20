/* SE/O UL photo booth — offline shell.

   Three caches, deliberately separate, split by how often the contents change:

   SHELL is the markup and art, and turns over on every deploy.
   SOUND is the generated audio — ~1.1MB that changes only when tools/sfx is
   re-run, which is rarely and never as part of a code change.
   HEAVY is the vendored MediaPipe wasm and face model — ~15MB that changes
   only when the vendored version does.

   Keeping them apart means a routine deploy re-downloads about two megabytes —
   mostly the attract loop — rather than eighteen.

   Bump HEAVY_CACHE only when the files under /vendor or /models change, and
   SOUND_CACHE only when the committed assets under /assets/sfx do. Both are
   served cache-first, so a regenerated sound does not reach the booth until its
   cache name moves.
*/

const SHELL_CACHE = 'seoul-shell-v3';
const SOUND_CACHE = 'seoul-sound-v1';
const HEAVY_CACHE = 'seoul-heavy-mediapipe-1.0.1';

const SHELL = [
  '/index.html',
  '/p.html',
  '/manifest.json',
  '/assets/logo-mark.png',
  '/assets/logo-mask.png',
  '/assets/attract-polaroid.jpg',
  '/assets/video/attract-curtain.mp4',
  '/assets/video/attract-curtain.jpg',
];

/* Every sound the kiosk can play, in both languages.

   audioInit() fetches these at page load, so the fetch handler below would cache
   them eventually anyway. Precaching them here is for the one case it does not
   cover: a deploy that bumps SHELL_CACHE evicts everything in it, and a booth
   whose wifi is down at that moment would come back silent for the rest of the
   day. They live in their own cache so that eviction cannot reach them.

   Keep in step with SFX and VOICE_LINES in index.html. A sound missing from this
   list is not fatal — it simply falls through to the network like anything else. */
const SOUND = [
  '/assets/sfx/tap.mp3',
  '/assets/sfx/place.mp3',
  '/assets/sfx/confirm.mp3',
  '/assets/sfx/back.mp3',
  '/assets/sfx/count.mp3',
  '/assets/sfx/count_go.mp3',
  '/assets/sfx/shutter.mp3',
  '/assets/sfx/eject.mp3',
  '/assets/sfx/music/attract.mp3',
  '/assets/sfx/music/shoot.mp3',
  '/assets/sfx/voice/ko-welcome.mp3',
  '/assets/sfx/voice/ko-ready.mp3',
  '/assets/sfx/voice/ko-select.mp3',
  '/assets/sfx/voice/ko-filter.mp3',
  '/assets/sfx/voice/ko-decorate.mp3',
  '/assets/sfx/voice/ko-done.mp3',
  '/assets/sfx/voice/ko-qr.mp3',
  '/assets/sfx/voice/ms-welcome.mp3',
  '/assets/sfx/voice/ms-ready.mp3',
  '/assets/sfx/voice/ms-select.mp3',
  '/assets/sfx/voice/ms-filter.mp3',
  '/assets/sfx/voice/ms-decorate.mp3',
  '/assets/sfx/voice/ms-done.mp3',
  '/assets/sfx/voice/ms-qr.mp3',
];

const HEAVY = [
  '/vendor/mediapipe/vision_bundle.mjs',
  '/vendor/mediapipe/wasm/vision_wasm_internal.js',
  '/vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  '/models/face_landmarker.task',
];

/* Store a response, working around a Cache API failure on large bodies.

   cache.put() rejects with a bare "Cache.put() encountered a network error" on
   /vendor/mediapipe/wasm/vision_wasm_internal.wasm — 11.7MB, served compressed
   and therefore with no Content-Length. The fetch itself is fine and returns all
   11,756,954 bytes; it is storing the stream that fails, and it fails the same
   way on cache.add(), with `reload`, and with `no-store`. Buffering the body into
   a fresh Response and storing that works, and reads back byte-identical.

   So: try the cheap path, fall back to buffering. Only clones are ever consumed
   here, so the caller's response stays intact to return to the page. */
async function put(cache, request, response) {
  try {
    await cache.put(request, response.clone());
  } catch (err) {
    const body = await response.clone().arrayBuffer();
    await cache.put(request, new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }));
  }
}

/* Fill a cache, tolerating individual failures.

   Nothing here uses cache.addAll(), which is atomic: one asset that will not
   store rejects the whole batch, the install fails, and — because a failed
   install leaves no registration behind — the booth ends up with no service
   worker at all and no sign that anything went wrong. That is exactly what the
   wasm above was doing. A missing asset should cost that asset and nothing else.

   `skipExisting` is for the caches that are versioned by name: their contents
   cannot have changed if the name has not, so a routine deploy should not
   re-download eighteen megabytes to arrive back where it started. */
async function precache(cacheName, urls, skipExisting) {
  const cache = await caches.open(cacheName);
  await Promise.all(urls.map(async url => {
    if (skipExisting && await cache.match(url)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await put(cache, url, res);
    } catch (err) {
      console.warn('sw: precache failed', url, err);
    }
  }));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Heavy first: without it the booth still runs but loses the face filters,
    // so it is the part most worth having before we go offline. Then sound, then
    // the shell — which alone is re-fetched every install, because it is the one
    // that actually changes when you deploy.
    await precache(HEAVY_CACHE, HEAVY, true);
    await precache(SOUND_CACHE, SOUND, true);
    await precache(SHELL_CACHE, SHELL, false);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, SOUND_CACHE, HEAVY_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter(n => !keep.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never touch the API. A cached /api/upload or /api/photo would hand a guest
  // somebody else's photo code — the one genuinely dangerous mistake here.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Cross-origin (webfonts) goes straight to the network; see NOTE in README.
  if (url.origin !== self.location.origin) return;

  // The vendored binaries and the generated audio are both versioned by cache
  // name rather than by URL, which is what makes them immutable to a running
  // booth: nothing at these paths ever changes without its cache name moving.
  const cacheName =
    HEAVY.includes(url.pathname) ? HEAVY_CACHE :
    url.pathname.startsWith('/assets/sfx/') ? SOUND_CACHE :
    SHELL_CACHE;
  const immutable = cacheName !== SHELL_CACHE;

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);

    // Immutable assets: cache wins, and the network is never consulted.
    if (immutable) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await put(cache, req, res).catch(() => {});
      return res;
    }

    // Everything else: network wins so deploys land, cache covers being offline.
    try {
      const res = await fetch(req);
      if (res.ok) await put(cache, req, res).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(req) || await cache.match('/index.html');
      if (hit) return hit;
      throw err;
    }
  })());
});
