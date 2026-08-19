/* SE/O UL photo booth — offline shell.

   Two caches, deliberately separate:

   SHELL is the markup and art, and turns over on every deploy.
   HEAVY is the vendored MediaPipe wasm and face model — ~15MB that changes
   only when the vendored version does. Keeping them apart means a routine
   deploy re-downloads about two megabytes — mostly the attract loop — rather
   than fifteen.

   Bump HEAVY_CACHE only when the files under /vendor or /models change.
*/

const SHELL_CACHE = 'seoul-shell-v3';
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

const HEAVY = [
  '/vendor/mediapipe/vision_bundle.mjs',
  '/vendor/mediapipe/wasm/vision_wasm_internal.js',
  '/vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  '/models/face_landmarker.task',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Heavy assets first: without them the booth still runs but loses the face
    // filters, so they are the part most worth having before we go offline.
    const heavy = await caches.open(HEAVY_CACHE);
    await Promise.all(HEAVY.map(async url => {
      if (await heavy.match(url)) return;          // survives a shell-only deploy
      await heavy.add(url);
    }));
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, HEAVY_CACHE];
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

  const heavy = HEAVY.includes(url.pathname);

  event.respondWith((async () => {
    const cache = await caches.open(heavy ? HEAVY_CACHE : SHELL_CACHE);

    // Immutable binaries: cache wins, and the network is never consulted.
    if (heavy) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }

    // Everything else: network wins so deploys land, cache covers being offline.
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req) || await cache.match('/index.html');
      if (hit) return hit;
      throw err;
    }
  })());
});
