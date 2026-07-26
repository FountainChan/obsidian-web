// Integration test for scripts/build-assets.sh's config-driven behavior
// (docs/plans/deploy-config.md §4 Commit 3): plugins install/enabled must
// follow src/config/deploy-config.json (not the old hardcoded values), and
// the CF build must inject window.__owConfigInjected into index.html BEFORE
// the deploy-config.js loader tag.
//
// Runs the REAL build script against the REAL vendor/obsidian-mobile bundle
// and the REAL committed config, but against a LOCAL mock GitHub server
// (test/fixtures/mock-github-server.js) instead of the real network —
// demo-and-docs-truth §3.8ג: the cloudflare package was 21/26 under
// `unshare -rn` (this test's own happy path was one of the 5 network-bound
// failures) — "a test that fails without network protects nothing".
// scripts/install-plugin.js reads OW_GITHUB_API_BASE to redirect its GitHub
// calls at build time; production is unaffected (env var unset there).
//
// demo-and-docs-truth §3.6-ג (calev NO-GO round 3, F4): a GitHub download
// failure for an `install: true` plugin used to WARN and let the build
// exit 0, silently reshipping a demo that *claims* a plugin is installed
// while it ships 0 files for it (exactly the Dataview lie this slice exists
// to kill). build-system-plugins.js now throws instead — an install:true
// plugin MUST resolve, or the whole build fails loudly. That means this
// test's happy-path assertions below are no longer "soft": if the build
// below didn't throw, every install:true plugin in config DID resolve.
//
// Uses async execFile, NOT execSync: the mock GitHub server above runs
// in-process, and execSync blocks this process's event loop for its whole
// duration — the server could never accept the build's HTTP requests,
// deadlocking the child process against its own parent. Async exec keeps
// the event loop free to service the mock server while the child runs.
//
// OW_VENDOR_PLUGINS_DIR redirects scripts/install-plugin.js's writes to a
// throwaway temp dir (demo-and-docs-truth round 5, calev finding 7): without
// it, this test runs the REAL build-assets.sh against the REAL, configured
// plugin ids ("dataview", "obsidian-livesync") and installPlugin() would
// write their mock (v0.0.0-mock) files straight into vendor/plugins/ —
// which is a symlink shared by every git worktree of this repo, so a test
// run in one worktree would corrupt vendor/plugins/dataview and
// vendor/plugins/obsidian-livesync in every sibling worktree too.

import { expect, test } from 'bun:test';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { startMockGithubServer } from './fixtures/mock-github-server.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF_DIR = path.resolve(__dirname, '..');
const MAIN_DIR = path.resolve(CF_DIR, '..', '..', '..');
const PUBLIC_DIR = path.join(MAIN_DIR, '.tmp', 'deployments', 'cloudflare', 'public');
const CONFIG_PATH = path.join(MAIN_DIR, 'src', 'config', 'deploy-config.json');

test('build-assets.sh: plugins install/enabled follow config.json + index.html gets window.__owConfigInjected before deploy-config.js', async () => {
  const mock = await startMockGithubServer();
  const vendorPluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-vendor-plugins-'));
  try {
    await execFileAsync('bash', ['scripts/build-assets.sh'], {
      cwd: CF_DIR,
      timeout: 120000,
      env: { ...process.env, OW_GITHUB_API_BASE: mock.baseUrl, OW_VENDOR_PLUGINS_DIR: vendorPluginsDir },
    });
  } finally {
    await mock.close();
    fs.rmSync(vendorPluginsDir, { recursive: true, force: true });
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'system-plugins', 'manifest.json'), 'utf8'));
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  // ── layout-switcher: config-driven, no network dependency ────────────────
  const layout = manifest.plugins.find((p) => p.id === 'obsidian-web-layout');
  expect(layout).toBeTruthy();
  expect(layout.enabled).toBe(config.plugins['obsidian-web-layout'].enabled);
  expect(fs.existsSync(path.join(PUBLIC_DIR, 'system-plugins', 'obsidian-web-layout'))).toBe(
    config.plugins['obsidian-web-layout'].install,
  );

  // ── LiveSync: install=true now means it MUST have resolved (build-time
  // download failure would have made execSync above throw) — no more
  // "network unavailable, skip the assertion" branch.
  const liveSyncEntry = manifest.plugins.find((p) => p.id === 'obsidian-livesync');
  if (config.plugins['obsidian-livesync'].install) {
    expect(liveSyncEntry).toBeTruthy();
    expect(liveSyncEntry.enabled).toBe(config.plugins['obsidian-livesync'].enabled);
    // MIT attribution (demo-and-docs-truth §3.5-a point 3): the license
    // must travel with the shipped plugin files, not just be documented.
    expect(liveSyncEntry.files).toContain('LICENSE');
    expect(fs.existsSync(path.join(PUBLIC_DIR, 'system-plugins', 'obsidian-livesync', 'LICENSE'))).toBe(true);
  } else {
    expect(liveSyncEntry).toBeUndefined();
  }

  // ── Dataview: same config-driven pattern as LiveSync above. Added in
  // demo-and-docs-truth §3.5-a — the demo's "Dataview Queries.md" claims the
  // plugin is installed and active; this (now hard-required) is what makes
  // that true.
  const dataviewEntry = manifest.plugins.find((p) => p.id === 'dataview');
  if (config.plugins.dataview.install) {
    expect(dataviewEntry).toBeTruthy();
    expect(dataviewEntry.enabled).toBe(config.plugins.dataview.enabled);
    expect(dataviewEntry.files).toContain('LICENSE');
    expect(fs.existsSync(path.join(PUBLIC_DIR, 'system-plugins', 'dataview', 'LICENSE'))).toBe(true);
  } else {
    expect(dataviewEntry).toBeUndefined();
  }

  // ── window.__owConfigInjected: marker replaced, positioned before the
  // deploy-config.js loader tag (order is load-bearing — see
  // deploy-config.js comment).
  expect(html).not.toContain('<!-- OW_CONFIG_INJECT -->');
  const expectedSnippet = '<script>window.__owConfigInjected=' + JSON.stringify(config) + '</script>';
  expect(html).toContain(expectedSnippet);
  // (search for the actual <script src="..."> tag, not just any mention of
  // "deploy-config.js" — the comment above the marker also names the file.)
  expect(html.indexOf(expectedSnippet)).toBeLessThan(html.indexOf('src="/client-mobile/deploy-config.js'));
}, 120000);

test('build-assets.sh: fails loudly (non-zero exit) when an install:true plugin fails to download (demo-and-docs-truth §3.6-ג, F4)', async () => {
  // Against the mock server, `obsidian-livesync`'s unpinned /latest always
  // resolves and only `dataview`'s pinned (bad) tag 404s — deterministic,
  // unlike the real GitHub rate limit this test used to race against (see
  // the now-removed comment below about assertion flakiness, demo-and-docs-truth
  // §3.7, calev NO-GO round 3, finding 5 — no longer reachable once neither
  // plugin depends on a real, shared rate limit).
  const mock = await startMockGithubServer();
  const vendorPluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-vendor-plugins-'));
  let threw = false;
  let status;
  let stderr = '';
  try {
    await execFileAsync('bash', ['scripts/build-assets.sh'], {
      cwd: CF_DIR,
      timeout: 120000,
      env: {
        ...process.env,
        OW_GITHUB_API_BASE: mock.baseUrl,
        SEED_DATAVIEW_VERSION: '99.99.99-does-not-exist',
        OW_VENDOR_PLUGINS_DIR: vendorPluginsDir,
      },
    });
  } catch (err) {
    threw = true;
    status = err.code;
    stderr = String(err.stderr || '');
  } finally {
    await mock.close();
    fs.rmSync(vendorPluginsDir, { recursive: true, force: true });
  }

  expect(threw).toBe(true);
  expect(status).not.toBe(0);
  // Assert the shape of the error, not (necessarily) which plugin triggered
  // it — kept generic even though it's now deterministic, since asserting
  // the exact plugin name is not what this test exists to guard.
  expect(stderr).toMatch(/has install=true but the GitHub download failed/);
}, 120000);
