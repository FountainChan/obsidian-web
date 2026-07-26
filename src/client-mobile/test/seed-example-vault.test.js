'use strict';

/**
 * Integration test for seedExampleVault (seed-example-vault.js) — exercises
 * the real production logic end-to-end against a fake OpfsStore (same shape
 * as storage/opfs-store.js makeStore()) and a mocked global fetch (same
 * shape as /example-vault.json, see build-assets.sh). Full-browser/OPFS
 * verification (DoD #2-#6 in docs/plans/cf-mobile-seed.md §5) is out of
 * scope for a node:test/bun test process — covered separately by calev-heavy.
 */

const assert = require('assert/strict');
const test = require('node:test');
const { seedExampleVault } = require('../seed-example-vault');

// ── fake OpfsStore — same stat/writeFile contract as storage/opfs-store.js ──
function makeFakeStore(initialFiles) {
  const files = new Map(Object.entries(initialFiles || {}));
  return {
    files,
    async stat({ path }) {
      if (!files.has(path)) {
        const e = new Error('stat: not found: ' + path);
        e.code = 'ENOENT';
        throw e;
      }
      return { isDirectory: false };
    },
    async writeFile({ path, data }) {
      files.set(path, data);
      return { uri: '' };
    },
  };
}

const EXAMPLE_FILES = [
  ['.obsidian/app.json', '{"legacyEditor":false}'],
  // Mirrors the real template.js content (demo-and-docs-truth §3.5-ב):
  // templater-obsidian was removed from the list — never installed, never
  // planned. Only dataview remains (and IS genuinely bundled, §3.5-a).
  ['.obsidian/community-plugins.json', '["dataview"]'],
  ['Welcome.md', '# Welcome'],
  ['How It Works.md', '# How It Works'],
  ['Features/Markdown Showcase.md', '# Markdown Showcase'],
  ['Features/Tags.md', '# Tags'],
];

function makeFakeFetch(files) {
  return async function fakeFetch(url) {
    if (url === '/example-vault.json') return { ok: true, json: async () => files };
    return { ok: false };
  };
}

test('seedExampleVault seeds content files, skips .obsidian/ entirely (finding 1)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = makeFakeFetch(EXAMPLE_FILES);
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore();
  await seedExampleVault(store);

  assert.equal(store.files.get('Welcome.md'), '# Welcome');
  assert.equal(store.files.get('How It Works.md'), '# How It Works');
  assert.equal(store.files.get('Features/Markdown Showcase.md'), '# Markdown Showcase');
  assert.equal(store.files.get('Features/Tags.md'), '# Tags');

  // finding 1 — .obsidian/* must NOT be seeded (would overwrite seedSystemPlugins'
  // community-plugins.json and un-enable the layout switcher)
  assert.equal(store.files.has('.obsidian/app.json'), false);
  assert.equal(store.files.has('.obsidian/community-plugins.json'), false);
});

test('seedExampleVault is idempotent — a second run on an already-seeded vault is a no-op', async (t) => {
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url) => { calls.push(url); return makeFakeFetch(EXAMPLE_FILES)(url); };
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore();
  await seedExampleVault(store);
  assert.equal(calls.length, 1);

  await seedExampleVault(store);   // second boot — Welcome.md already exists → gate skips
  assert.equal(calls.length, 1, 'no /example-vault.json fetch on the second (idempotent) run');
});

test('seedExampleVault is a no-op when the vault already has Welcome.md (existing content, not first-visit)', async (t) => {
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url) => { calls.push(url); return makeFakeFetch(EXAMPLE_FILES)(url); };
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore({ 'Welcome.md': '# my own welcome note' });
  await seedExampleVault(store);

  assert.equal(calls.length, 0, 'gate short-circuits before any fetch');
  assert.equal(store.files.get('Welcome.md'), '# my own welcome note', 'existing content untouched');
});

test('seedExampleVault is a no-op when /example-vault.json is missing (local dev — no regression, DoD#6)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404 });
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore();
  await seedExampleVault(store);

  assert.equal(store.files.size, 0);
});

test('seedExampleVault does not reject when fetch throws (network failure)', async (t) => {
  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  t.after(() => { global.fetch = origFetch; });

  const store = makeFakeStore();
  await assert.doesNotReject(seedExampleVault(store));
  assert.equal(store.files.size, 0);
});
