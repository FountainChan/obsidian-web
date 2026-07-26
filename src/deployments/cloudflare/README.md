# obsidian-web — Cloudflare deployment (mobile runtime, browser file system / OPFS)

**Client-only, mobile runtime.** Serves `src/client-mobile/` + `vendor/obsidian-mobile/`
(not the desktop client/renderer). Vaults live entirely in the browser via **OPFS**
(Origin Private File System). There is **no server-side vault storage** — the
previous server-side in-memory vault store (internally named `VaultDO`) has been
**removed**.

## What the Worker does now
- Serves the **static app bundle** (`env.ASSETS`) for everything except
  `/api/proxy-request` and the `/starter`/`/vault/*` SPA-fallback routes. See `index.js`.
- `/` renders **Obsidian's native mobile onboarding screen** ("Create a vault" /
  "Use my existing vault") — no vault is opened automatically, the chooser starts
  empty. It also gets a **"כספת דמו" (demo vault) button** injected
  (`installDemoVaultButton` in `boot.js`) that creates/opens a fixed-id local
  (OPFS) vault and seeds it with `template.js`'s example content on first open —
  see "Example / demo vault content" below. Vault creation/writes/reads happen
  **entirely client-side** (OpfsStore engine); 0 dependency on `/api/*` for vault
  storage.
- `vendor/obsidian-mobile/` is self-contained (own `app.js`/`worker.js`/`i18n`/
  `lib`) — `build-assets.sh` copies it (and mirrors its resource dirs at the
  bundle root) without touching `vendor/obsidian-desktop` (desktop).
- **`POST /api/proxy-request`** — edge Worker proxy for outbound requests
  Obsidian makes that need CORS the origin doesn't send (GitHub/obsidian.md —
  community-plugin browse/install, releases, templater's unsplash endpoint).
  Handled entirely at the edge (`proxy-worker.js`) — **no origin server**, no
  server-side vault store, no Node process. Same allow-list + SSRF-safe manual-redirect
  handling as the Node reference (`src/runtime-server/server/api/proxy.js`), ported to the
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

## System plugins — layout-switcher + LiveSync (disabled) + Dataview (enabled)
`build-assets.sh` builds `public/system-plugins/manifest.json` from
`src/config/deploy-config.json`'s `plugins` map — one entry per plugin, no
hardcoded per-plugin shell logic (see `build-system-plugins.js`, which does
the actual work: it loops over that config, so adding a fourth plugin means
one JSON entry, not a code change). Served statically because CF static
hosting has no `/api/system-plugins` — `seed-system-plugins.js` falls back
to fetching this file when the API route 404s. Currently three entries:
- **`obsidian-web-layout`** (`enabled:true`, first-party — lives in
  `src/plugins/obsidian-web-layout/`, just copied) — the desktop/mobile
  layout switcher, active by default.
- **`obsidian-livesync`** (`enabled:false`) — [Self-hosted
  LiveSync](https://github.com/vrtmrz/obsidian-livesync), MIT-licensed.
- **`dataview`** (`enabled:true`) — [Dataview](https://github.com/blacksmithgu/obsidian-dataview),
  MIT-licensed. Backs the demo's "Dataview Queries" note — without this, the
  ` ```dataview ` blocks in that note render as plain code, not live queries.

The latter two are **downloaded from GitHub at build time** (`node
scripts/install-plugin.js --repo <owner/name> --dest <id>`, called once per
plugin by `build-system-plugins.js`) into `vendor/plugins/<id>/`, cached
under `.tmp/cache/<id>-releases/`, and copied into `public/system-plugins/`
— **including their `LICENSE` file**, both in the public build output and in
every vault they get seeded into (MIT requires the license notice to travel
with the code, not just be mentioned in a doc). `obsidian-livesync` ships
**installed but disabled** — the files land in every new vault's
`.obsidian/plugins/obsidian-livesync/` on first visit, but `enabled:false`
means `seed-system-plugins.js` does **not** add it to
`.obsidian/community-plugins.json`, so it never auto-runs; the user enables
it manually (Settings → Community plugins → toggle), then configures a
CouchDB endpoint in the LiveSync settings tab. `dataview` ships **installed
and enabled** — it *is* added to `community-plugins.json` on seed, so it
runs immediately in the demo vault. Pin a specific release with
`SEED_LIVESYNC_VERSION=<tag>` / `SEED_DATAVIEW_VERSION=<tag>` (per
`deploy-config.json`'s `versionEnv` field) before running the build; if a
download fails (offline, GitHub outage, rate limit), the build **hard-fails**
(non-zero exit) — a plugin listed with `install: true` must resolve, or the
whole build stops rather than silently shipping without it.

All of these plugins come from **Obsidian's community plugin list** —
downloaded from GitHub, the same way installing a community plugin from
inside Obsidian itself does (that in-app install path is what
`POST /api/proxy-request` exists for, see above: browsers can't fetch
GitHub/obsidian.md directly due to missing CORS headers).

## Example / demo vault content (`template.js`) — wired, not a stub
`template.js` holds the **demo vault** — 11 example files (`Welcome.md`,
`How It Works.md`, `Features/*.md`, `.obsidian/*` config). It **is wired**: the
"כספת דמו" (demo vault) button on the onboarding screen (see "What the Worker
does now" above) opens a fixed-id local (OPFS) vault; the first time that
vault is empty, `boot.js` seeds it from `template.js` (via the static
`/example-vault.json` built by `build-assets.sh` — see "Deploy" below) using
`seed-example-vault.js`. A visitor who never clicks that button gets Obsidian's
plain native onboarding chooser instead, with no vault pre-opened. Do **not**
delete `template.js`.

## What's included (finished)
- OPFS vault engine on the mobile runtime (create local vault, notes, nested
  folders, reload-persistence — all client-side, verified static/no-server).
- Native mobile onboarding/vault-chooser screen renders fully at `/`.
- Example vault + system-plugins seed to OPFS on first visit (`cf-mobile-seed`)
  — see "Example / demo vault content" above.
- **`POST /api/proxy-request`** — edge Worker proxy (`cf-worker-proxy`) with
  allow-list, SSRF-safe redirects, and Cache API for immutable downloads. See
  "What the Worker does now" above.
- **LiveSync preinstalled, disabled** (`cf-preinstall-livesync`) —
  `obsidian-livesync` ships in every new vault's `.obsidian/plugins/`, off by
  default; the user opts in via Settings → Community plugins. See "System
  plugins" above.
- **Dataview preinstalled, enabled** (`demo-and-docs-truth` §3.5-a) — the
  demo vault's "Dataview Queries" note runs live queries out of the box.
  See "System plugins" above.
- Native "**Create a vault**" button (mobile onboarding UI) works end-to-end:
  it used to call `Filesystem.mkdir()` and hit the non-existent `/api/fs/mkdir`
  here (always failing with "mkdir failed: ..."), since `window.__owVaultType`
  still defaulted to `'server'` at that point in boot. Fixed at two layers —
  a DOM click-interceptor (`boot.js:577-641`, `installCreateVaultInterceptor`)
  that routes the click straight to an OPFS/folder vault creation, and an
  FS-level safety net (`shims/capacitor-shim.js:291-313`) that catches the
  same case if the DOM interceptor is ever bypassed. Verified on this
  deployment and on the local dev server.

## Known gaps (follow-ups)
1. **Per-IP rate-limiting** on `/api/proxy-request` — not implemented yet.
   Requires a KV namespace binding + Cloudflare account config (out of scope
   for a code-only slice). Cache already cuts most of the repeat-download
   load; rate-limiting is a defense-in-depth follow-up against abuse of the
   proxy as an open relay, not a functional blocker. (Tracked for
   `client-only-resilience` — update this note once implemented.)
2. Two font files referenced by `obsidian-mobile/app.css` ("Inter",
   `public/fonts/*.woff2`) 404 — `vendor/obsidian-mobile` never included a
   `public/` dir. Cosmetic only (`font-display: swap` → system font fallback);
   does not block rendering. Not a `vendor/obsidian-desktop` dependency (path is under
   `/obsidian-mobile/` already) — just an incomplete upstream extraction.
3. `/api/proxy-request` is verified via a **Bun integration test** against the
   real network (manifest fetch, release-asset redirect, SSRF, cache) — not
   `wrangler dev`, which doesn't produce results in the current dev sandbox
   (workerd hangs). The one thing that test *can't* cover is an actual
   community-plugin **install through a running Worker** (browser → `wrangler
   dev`/deployed Worker → GitHub) — deferred to a real `wrangler deploy` or a
   CF environment where `workerd` runs.

## Deploy
```
npm run build          # scripts/build-assets.sh → .tmp/deployments/cloudflare/public
npm run dev             # local emulation (wrangler dev) — does NOT publish anywhere
wrangler deploy        # from src/deployments/cloudflare/ — publishes for real, only when intended
```
`npm run build` needs network access to GitHub (`api.github.com` +
release-asset CDN) to fetch the LiveSync plugin on a cold cache — see
"System plugins" above. It never blocks the build if unreachable (WARN +
continue, layout-switcher only).
