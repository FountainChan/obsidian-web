# AGENTS.md — obsidian-web

> Conventions for anyone (human or coding agent) changing this repo.
> Tool-neutral; `CLAUDE.md` just imports this file.
> **Start with `README.md`** for what the project is and how to run it.

## What this project is

Runs Obsidian's own renderer in a regular browser — no Electron — by shimming the
Electron/Capacitor/Node APIs it expects. There is **one runtime core**
(`src/client-mobile/`) with a **swappable backend**:

| Layer | Status | Storage |
|-------|--------|---------|
| serverless | primary | OPFS in the browser + folder vaults (File System Access API) |
| server | supported | real files via `/api/fs` |

See `docs/architecture.md` for the full picture.

## Conventions — required

- **Node 18+ or Bun — depends on the package.** Most packages' scripts invoke `node`
  (`src/client-mobile` tests, `src/runtime-server/server`, and the Cloudflare deployment's
  *build* script, `build-assets.sh`). `src/sync-server` runs entirely on `bun`
  (`bun index.js` / `bun test`) — but it is **not** the only package that needs `bun`:
  the Cloudflare deployment's own *test suite* (`src/deployments/cloudflare/test/`,
  `npm test`) also requires `bun` (`bun test`), even though that package's build is
  `bash` + `node`. The maintainer's own dev environment symlinks `node` to `bun`, which
  is a local habit, not a repo-wide requirement — don't assume `bun` works for every
  package's *build*, and don't assume `node` alone covers every package's *tests*.
- **`vendor/` is gitignored.** It holds Obsidian's own bundle, generated locally by
  `scripts/update-obsidian-*.js`, and is never committed. This repository does not
  contain or distribute that bundle — each user downloads Obsidian themselves via the
  setup scripts. The public live demo deployment *does* serve the bundle to visitors'
  browsers (see `build-assets.sh`), which is a separate thing from this repo.
- **The bundle is minified.** Anchor any patch or edit to a **pattern / symbol
  shape**, never to a line number — line numbers move on every Obsidian release.
  See `scripts/patch-obsidian-mobile.js`, which documents this in-body.
- **No personal data in this repo.** Personal vault names, machine paths, run logs,
  and internal planning notes do not belong here.

## Layout

| What | Where |
|------|-------|
| Architecture and rationale | `docs/architecture.md` |
| Reverse-engineering notes, solved issues | `docs/investigations.md` |
| Writing a system plugin | `docs/system-plugin-dev-guide.md` |
| Runtime (the browser side) | `src/client-mobile/` |
| Node backend (optional) | `src/runtime-server/` |
| Pull-sync server | `src/sync-server/` |
| Cloudflare deployment | `src/deployments/cloudflare/` |

## Before you touch the bundle

`vendor/obsidian-mobile/app.js` is Obsidian's proprietary code. We apply a small,
documented set of patches to the **local** copy. Keep that set as small as
possible, and prefer a shim over a patch whenever the same result is reachable
through a platform API.
