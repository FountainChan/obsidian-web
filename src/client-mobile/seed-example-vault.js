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
 * `.obsidian/community-plugins.json` lists `['dataview']` — seeding it
 * verbatim would OVERWRITE the community-plugins.json that seedSystemPlugins
 * just wrote (merging in whatever's *actually* bundled + enabled, e.g.
 * `['obsidian-web-layout','dataview']`), un-enabling the layout switcher.
 * The fix: seed ONLY vault content, skip the entire `.obsidian/` subtree —
 * plugin/layout config stays exclusively owned by seedSystemPlugins, which
 * is the single source of truth for what's actually shipped (unlike this
 * template file's own `.obsidian/community-plugins.json`, which documents
 * intent only and is never seeded verbatim — see template.js's own header
 * comment).
 *
 * (This comment used to also claim, as "finding 3", that dataview/
 * templater-obsidian "aren't bundled on this deployment" — that's no longer
 * true for dataview: it IS genuinely installed and shipped as of
 * docs/plans/demo-and-docs-truth.md §3.5-a (build-system-plugins.js,
 * config-driven). templater-obsidian was never installed or planned and
 * has since been removed from the template's list entirely, §3.5-ב.)
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
      if (path.indexOf('.obsidian/') === 0 || path.indexOf('/.obsidian/') !== -1) continue;   // דלג על config (finding 1 — seedSystemPlugins הוא מקור-האמת)
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
