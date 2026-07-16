# obsidian-web — Cloudflare deployment (mobile runtime, browser file system / OPFS)

**Client-only, mobile runtime.** Serves `src/client-mobile/` + `vendor/obsidian-mobile/`
(not the desktop client/renderer). Vaults live entirely in the browser via **OPFS**
(Origin Private File System). There is **no server-side vault storage** — the
previous Durable Object (`VaultDO`, server-backed vault) has been **removed**.

## What the Worker does now
- Serves the **static app bundle** only (`env.ASSETS`). See `index.js`.
- `/` renders **Obsidian's native mobile onboarding screen** ("Create a vault" /
  "Use my existing vault") — no demo vault is injected, the vault chooser starts
  empty. Vault creation/writes/reads happen **entirely client-side** (OpfsStore
  engine); 0 dependency on `/api/*`.
- `vendor/obsidian-mobile/` is self-contained (own `app.js`/`worker.js`/`i18n`/
  `lib`) — `build-assets.sh` copies it (and mirrors its resource dirs at the
  bundle root) without touching `vendor/obsidian` (desktop).

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

## Known gaps (follow-ups)
1. **Seed the example vault** (`template.js` → OPFS) on first visit — **slice
   `cf-mobile-seed`**, not this slice.
2. **Seed system plugins** (layout-switcher etc.) to OPFS on static deploys —
   also `cf-mobile-seed` (mirrors `seedSystemPlugins`, currently fails soft
   without `/api/system-plugins`).
3. **Port `/api/proxy-request`** (community-plugin downloads) to a Worker route
   — later follow-up, community-plugin install doesn't work yet on static edge.
4. Native "**Create a vault**" button (mobile onboarding UI) calls
   `Filesystem.mkdir()` before `window.__owVaultType` is updated from the
   boot-time default (`'server'`) — the call is routed to `/api/fs/mkdir`,
   which doesn't exist here, so it always fails with "mkdir failed: ...". This
   is a `src/client-mobile/**` bug, out of scope for this deployment-only
   slice (verified: same failure on the local dev server, not CF-specific).
   Local (OPFS) vaults can still be created via `window.__owLocalVaults.create()`
   + navigating to `/?vault=<id>` (what `new-local.html` does — its own
   hardcoded `/mobile?vault=` link doesn't resolve on this static deployment
   though, since there is no `/mobile` route here — only `/`).
5. Two font files referenced by `obsidian-mobile/app.css` ("Inter",
   `public/fonts/*.woff2`) 404 — `vendor/obsidian-mobile` never included a
   `public/` dir. Cosmetic only (`font-display: swap` → system font fallback);
   does not block rendering. Not a `vendor/obsidian` dependency (path is under
   `/obsidian-mobile/` already) — just an incomplete upstream extraction.

## Deploy
```
npm run build          # scripts/build-assets.sh → .tmp/deployments/cloudflare/public
wrangler deploy        # from src/deployments/cloudflare/
```
