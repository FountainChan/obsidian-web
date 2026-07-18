/**
 * seed-example-vault.js — seed-on-boot of demo content (Welcome.md,
 * Features/*.md) into an empty OPFS (local) vault, on CF static hosting
 * where there is no server to seed content through /api/*.
 *
 * No DOM deps beyond the global `fetch` (available under node:test/bun test
 * AND in the browser) — runs under node:test and inside the browser via a
 * plain <script> tag (attaches to window.__owSeedExampleVault).
 *
 * `store` is an OpfsStore instance (storage/opfs-store.js makeStore(vaultId))
 * — only `stat({path})` / `writeFile({path,data,encoding})` are used, so a
 * fake with the same shape works fine in tests.
 *
 * finding 1 (docs/plans/cf-mobile-seed.md §3ג): the demo template's
 * `.obsidian/community-plugins.json` lists `['dataview','templater-obsidian']`
 * — seeding it verbatim would OVERWRITE the community-plugins.json that
 * seedSystemPlugins just wrote (`['obsidian-web-layout']`), un-enabling the
 * layout switcher. finding 3: dataview/templater-obsidian aren't bundled on
 * this deployment, so seeding them would cause load errors anyway. The fix:
 * seed ONLY vault content, skip the entire `.obsidian/` subtree — plugin/
 * layout config stays exclusively owned by seedSystemPlugins.
 */
(function () {
  'use strict';

  async function seedExampleVault(store) {
    let already = false;
    try { await store.stat({ path: 'Welcome.md' }); already = true; } catch (_) {}   // idempotent gate
    if (already) return;

    const files = await fetch('/example-vault.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!files) return;   // מקומי (אין example-vault.json) / רשת נכשלה → דלג

    for (const [path, content] of files) {
      if (path.indexOf('.obsidian/') === 0 || path.indexOf('/.obsidian/') !== -1) continue;   // דלג על config (finding 1+3)
      // writeFile יוצר תיקיות-אב recursive (אומת opfs-store.js:18, Features/*)
      await store.writeFile({ path: path, data: content, encoding: 'utf8' });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { seedExampleVault };
  } else if (typeof window !== 'undefined') {
    window.__owSeedExampleVault = { seedExampleVault };
  }
})();
