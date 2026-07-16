// obsidian-web — Cloudflare deployment (browser file system / OPFS only).
//
// Vaults live ENTIRELY in the browser (OPFS). There is NO server-side vault
// storage here: the previous Durable Object `VaultDO` (which stored vault
// files server-side and handled /api/fs/*) has been removed on purpose — this
// deployment is client-only. The Worker's sole job is to serve the static app
// bundle; the vault, its files, and all FS operations happen in the browser
// via the OpfsStore engine.
//
// FOLLOW-UP (per "add the other options later"): port the Node server's
//   • /api/proxy-request         (community-plugin downloads: follow-redirects,
//                                 allow-list + SSRF guard, cache — see
//                                 src/server/api/proxy.js)
//   • /api/system-plugins        (seed manifest)
//   • /api/system-plugin-file    (seed bytes — src/server/api/system-plugin-files.js)
// to Worker routes, so community-plugin install + LiveSync install work on the
// static edge deployment. Recommended env for CF: SYSTEM_PLUGINS_SEED_DISABLED=
// "obsidian-livesync" (LiveSync pre-installed but disabled). Until those routes
// exist, this deployment serves the app + OPFS vaults (local note-taking works;
// community-plugin download does not yet).

export default {
  async fetch(request, env) {
    // Static-only: the app bundle. No /api/* — vault storage is OPFS in the
    // browser, not the server.
    return env.ASSETS.fetch(request);
  },
};
