# obsidian-web — Cloudflare deployment (mobile runtime, browser file system / OPFS)

**Client-only, mobile runtime.** Serves `src/client-mobile/` + `vendor/obsidian-mobile/`
(not the desktop client/renderer). Vaults live entirely in the browser via **OPFS**
(Origin Private File System). There is **no server-side vault storage** — the
previous Durable Object (`VaultDO`, server-backed vault) has been **removed**.

## What the Worker does now
- Serves the **static app bundle** (`env.ASSETS`) for everything except
  `/api/proxy-request`. See `index.js`.
- `/` renders **Obsidian's native mobile onboarding screen** ("Create a vault" /
  "Use my existing vault") — no demo vault is injected, the vault chooser starts
  empty. Vault creation/writes/reads happen **entirely client-side** (OpfsStore
  engine); 0 dependency on `/api/*` for vault storage.
- `vendor/obsidian-mobile/` is self-contained (own `app.js`/`worker.js`/`i18n`/
  `lib`) — `build-assets.sh` copies it (and mirrors its resource dirs at the
  bundle root) without touching `vendor/obsidian` (desktop).
- **`POST /api/proxy-request`** — edge Worker proxy for outbound requests
  Obsidian makes that need CORS the origin doesn't send (GitHub/obsidian.md —
  community-plugin browse/install, releases, templater's unsplash endpoint).
  Handled entirely at the edge (`proxy-worker.js`) — **no origin server**, no
  Durable Object, no Node process. Same allow-list + SSRF-safe manual-redirect
  handling as the Node reference (`src/server/api/proxy.js`), ported to the
  Worker `fetch`/`Request`/`Response` runtime (no `Buffer`, chunked
  base64 — see `proxy-worker.js` header comment).
  - **Cache**: immutable downloads (`raw.githubusercontent.com`,
    `releases.obsidian.md`, `*.githubusercontent.com` — covers the release
    CDN) are cached via `caches.default`, `Cache-Control: public,
    max-age=86400`. `api.github.com` (community-plugin/theme **lists**) is
    deliberately **excluded** — those responses change over time; caching them
    would serve a stale plugin list.
  - **`caches.default` is a no-op on `*.workers.dev`** — documented Cloudflare
    limitation. The proxy is fully functional there (every request just
    always misses cache and goes to origin); to get actual cache hits in
    production, deploy behind a **custom domain/route**: uncomment `routes` in
    `wrangler.toml`.

## Example / demo vault content — **KEEP** (`template.js`)
`template.js` holds the **demo vault** — 11 example files (`Welcome.md`,
`How It Works.md`, `Features/*.md`, `.obsidian/*` config). It is **intentionally
kept**, unused by this slice — role: seeded into OPFS on first visit so a fresh
visitor lands in a populated vault instead of the empty native chooser. **Not
wired yet** — follow-up, see below. Do **not** delete `template.js`.

## What's included (finished)
- OPFS vault engine on the mobile runtime (create local vault, notes, nested
  folders, reload-persistence — all client-side, verified static/no-server).
- Native mobile onboarding/vault-chooser screen renders fully at `/`.
- Example vault + system-plugins seed to OPFS on first visit (`cf-mobile-seed`).
- **`POST /api/proxy-request`** — edge Worker proxy (`cf-worker-proxy`, this
  slice) with allow-list, SSRF-safe redirects, and Cache API for immutable
  downloads. See "What the Worker does now" above.

## Known gaps (follow-ups)
1. **Per-IP rate-limiting** on `/api/proxy-request` — not implemented yet.
   Requires a KV namespace binding + Cloudflare account config (out of scope
   for a code-only slice). Cache already cuts most of the repeat-download
   load; rate-limiting is a defense-in-depth follow-up against abuse of the
   proxy as an open relay, not a functional blocker.
2. Native "**Create a vault**" button (mobile onboarding UI) calls
   `Filesystem.mkdir()` before `window.__owVaultType` is updated from the
   boot-time default (`'server'`) — the call is routed to `/api/fs/mkdir`,
   which doesn't exist here, so it always fails with "mkdir failed: ...". This
   is a `src/client-mobile/**` bug, out of scope for this deployment-only
   slice (verified: same failure on the local dev server, not CF-specific).
   Local (OPFS) vaults can still be created via `window.__owLocalVaults.create()`
   + navigating to `/?vault=<id>` (what `new-local.html` does — its own
   hardcoded `/mobile?vault=` link doesn't resolve on this static deployment
   though, since there is no `/mobile` route here — only `/`).
3. Two font files referenced by `obsidian-mobile/app.css` ("Inter",
   `public/fonts/*.woff2`) 404 — `vendor/obsidian-mobile` never included a
   `public/` dir. Cosmetic only (`font-display: swap` → system font fallback);
   does not block rendering. Not a `vendor/obsidian` dependency (path is under
   `/obsidian-mobile/` already) — just an incomplete upstream extraction.
4. `/api/proxy-request` is verified via a **Bun integration test** against the
   real network (manifest fetch, release-asset redirect, SSRF, cache) — not
   `wrangler dev`, which doesn't produce results in the current dev sandbox
   (workerd hangs). The one thing that test *can't* cover is an actual
   community-plugin **install through a running Worker** (browser → `wrangler
   dev`/deployed Worker → GitHub) — deferred to a real `wrangler deploy` or a
   CF environment where `workerd` runs.

## Deploy
```
npm run build          # scripts/build-assets.sh → .tmp/deployments/cloudflare/public
wrangler deploy        # from src/deployments/cloudflare/
```
