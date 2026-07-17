/**
 * Service Worker — offline support + asset caching for faster reloads.
 *
 * Strategy (see docs/plans/service-worker-offline.md §3א):
 *   - Cache is keyed by BUILD_ID: a new deploy = a new cache = every asset
 *     (busted or not) is fetched fresh once, then served from cache. This
 *     avoids the two findings from the brief:
 *       finding 1: only /client-mobile/* URLs carry a ?v=<bust> query string;
 *         /obsidian-mobile/*, /worker.js, /sim.js, /i18n/*, /lib/* do not,
 *         so a plain SWR strategy would pin them forever after first cache.
 *       finding 2: an old worker.js served against a fresh app.js hangs the
 *         metadata indexer forever — so worker.js/sim.js get network-first
 *         instead of cache-first (fresh online, cache offline).
 *   - /api/* is dynamic (fs/proxy) → network-only, never cached.
 *   - cross-origin requests (CouchDB, GitHub) → pass-through, SW untouched.
 *   - navigation → network-first, falling back to the cached '/' shell when
 *     offline so the app still boots without a network connection.
 */
const BUILD_ID = '__OW_BUILD__';       // מוזרק: CF=build-assets sed; מקומי=server מזריק clientCacheBust
const CACHE = 'ow-sw-' + BUILD_ID;

self.addEventListener('install', (e) => { self.skipWaiting(); });   // ללא precache — cache-first ממלא לפי צריכה
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))   // מוחק caches מ-builds ישנים
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;        // cross-origin (CouchDB/GitHub) → pass-through
  if (url.pathname.startsWith('/api/')) return;           // dynamic → network-only

  // navigation → network-first, fallback ל-'/' (ה-entry המבוסט; CF+מקומי מגישים מובייל ב-/)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.open(CACHE).then(c => c.match('/').then(r => r || fetch(req)))));
    return;
  }
  // worker.js/sim.js → network-first (finding 2: indexer רגיש; online=טרי, offline=cache)
  if (url.pathname === '/worker.js' || url.pathname === '/sim.js') {
    e.respondWith(caches.open(CACHE).then(c =>
      fetch(req).then(res => { if (res && res.status === 200) c.put(req, res.clone()); return res; })
                .catch(() => c.match(req))));
    return;
  }
  // שאר static → cache-first (מהיר; בתוך build-version הכל immutable — finding 1 מטופל ע"י CACHE ממוספר)
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.status === 200) c.put(req, res.clone());
    return res;
  }));
});
