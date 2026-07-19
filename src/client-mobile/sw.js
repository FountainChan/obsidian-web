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

// ── /_owres/ vault-resource serving — spike findings (§0.1, executor, before
// implementation) — docs/plans/sw-vault-resources.md §3. The `/_owres/`
// fetch handler itself lands in the next commit; recorded here first per the
// brief's own commit split (Commit 1 = spikes, manual+probe).
//
// Empirical setup: playwright (bunx playwright, local chromium — no gui-host
// available in this environment) headless against the real local dev server
// (`bun index.js`), opening the actual mobile runtime at `/vault/<demoId>`
// (a real local/OPFS vault, not a mock) and driving it through
// `page.evaluate` + `fetch()` from the page context — i.e. exercising the
// real SW, real fetch-event dispatch, real OPFS, not a synthetic harness.
// Script: /tmp/sw-vault-spike/spike-owres.mjs (not committed — scratch, per
// project convention, see e.g. /tmp/spike-observer*.js in the folder-refresh
// walkthrough entry).
//
// Spike #1 — SW reads OPFS in its fetch handler? YES, confirmed. Inside a
// live `fetch` event handler, `self.navigator.storage.getDirectory()` →
// `getDirectoryHandle('vaults')` → `getDirectoryHandle(vaultId)` → walk →
// `getFileHandle().getFile()` all resolved correctly and returned a real
// `File` whose bytes matched what was written from the page — no permission
// prompt, no separate grant needed (OPFS has no FS-Access-style permission
// gate at all). This validates the entire premise of the unified design.
//
// Spike #2 — SW reads a folder-vault's handle from IndexedDB (incl.
// permission)? PARTIAL / not fully testable here: mechanically, a
// `FileSystemDirectoryHandle` retrieved from `folder-handle-store`'s
// IndexedDB *can* be walked (`getDirectoryHandle`/`getFileHandle`) from
// inside a SW — but this environment has no way to automate the real
// `showDirectoryPicker()` native dialog (headless, no gui-host — a directory
// picker isn't a `<input type=file>` chooser playwright can drive), so a
// true real-folder end-to-end run wasn't possible here. The platform
// constraint that decides this regardless of that gap: `queryPermission`/
// `requestPermission` on a `FileSystemHandle` require a user-activated
// Window context (spec) — a Service Worker has neither a Window nor
// activation, so it cannot itself (re-)request the grant even if OPFS-style
// direct access worked mechanically. → folder vaults use the RPC fallback
// (§3ד, next-next commit): the SW asks the already-open page, which already
// holds the permission-granted handle (`window.__owFolderRoot`, granted via
// a real user gesture in `boot.js`'s `showGrantScreen`).
//
// Spike #3 — img + PDF + video/audio all load uniformly through `/_owres/`?
// YES for the transport mechanism: the probe wrote a PNG, a PDF (magic
// bytes `%PDF-1.4`), and a synthetic 2000-byte "mp4" into the same OPFS
// vault and fetched all three through the (prototyped) `/_owres/<id>/<id>/
// ...` URL — all three came back 200 with the correct `Content-Type` by
// extension, and a `Range: bytes=0-99`/`bytes=1000-` request against the
// "mp4" came back 206 with a correct `Content-Range`/`Content-Length` (and
// the clamped-end behavior for an out-of-range `end`). One mechanism, same
// code path, for every binary type — confirms the design's core premise.
// (Real PDF.js rendering / video playback in the DOM is left to the
// end-of-slice calev-heavy E2E pass — this probe validated the serving
// layer the DOM consumers sit on top of.)

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
  if (url.pathname === '/sw.js') return;                  // ה-SW עצמו — לעולם לא מ-cache (שהדפדפן יזהה גרסה חדשה)

  // navigation → network-first, fallback ל-'/' (ה-entry המבוסט; CF+מקומי מגישים מובייל ב-/)
  if (req.mode === 'navigate') {
    // network-first, אבל **שומר את ה-shell ל-cache** על הצלחה online — אחרת
    // offline נופל (calev NO-GO: '/' לא נכנס ל-cache, ה-fallback היה dead code).
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));   // canonical shell under '/'
          }
          return res;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match('/')))   // offline → ה-shell השמור
    );
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
