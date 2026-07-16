# obsidian-web — Cloudflare deployment (browser file system / OPFS)

**Client-only.** Vaults live entirely in the browser via **OPFS** (Origin Private
File System). There is **no server-side vault storage** — the previous Durable
Object (`VaultDO`, server-backed vault) has been **removed** on this branch.

## What the Worker does now
- Serves the **static app bundle** only (`env.ASSETS`). See `index.js`.
- The vault, its files, and all FS ops happen **in the browser** (OpfsStore engine).

## Example / demo vault content — **KEEP** (`template.js`)
`template.js` holds the **demo vault** — 11 example files (`Welcome.md`,
`How It Works.md`, `Features/*.md`, `.obsidian/*` config) plus community plugins
(from `plugins-generated.js`, built by `build-assets.sh`). It **used to** load into
the removed Durable Object. It is **intentionally kept** as the demo/example content.

**Its new role (follow-up):** on the browser-FS deployment these example files are
**seeded into OPFS on first visit** (a fresh visitor lands in a demo vault with the
example content, then adds their own files client-side — nothing touches the server).
This replaces the old DO-preload. Wiring: a small client seed that writes
`TEMPLATE_FILES` into the OPFS vault when it's empty (mirrors `seedSystemPlugins`).
Do **not** delete `template.js`.

## What's included (finished)
- OPFS vault engine (create local vault, notes, nested folders — all client-side).
- Layout-switcher system plugin (seeded to OPFS).
- Community-plugin download proxy + LiveSync-as-community-plugin — **on the Node
  server**. These are **server-side** features (`src/server/api/proxy.js`,
  `system-plugin-files.js`) and are **not yet ported** to the Worker.

## Follow-ups (add later — "the other options")
1. **Port `/api/proxy-request`** (community-plugin downloads: follow-redirects,
   allow-list + SSRF guard, cache) to a Worker route → community plugins +
   LiveSync install work on the static edge deployment.
2. **Port `/api/system-plugins` + `/api/system-plugin-file`** (system-plugin seed)
   to Worker routes. Set `SYSTEM_PLUGINS_SEED_DISABLED=obsidian-livesync` so CF
   pre-installs LiveSync **disabled**.
3. **Seed the example vault** (`template.js` → `TEMPLATE_FILES`) into OPFS on first
   visit, so the demo lands in a populated vault (see "Example / demo vault content").
4. Folder-vault (File System Access API) + native-style vault chooser.

## Deploy
```
npm run build          # scripts/build-assets.sh → .tmp/deployments/cloudflare/public
wrangler deploy        # from src/deployments/cloudflare/
```
