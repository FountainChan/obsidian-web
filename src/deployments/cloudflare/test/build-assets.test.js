// Integration test for scripts/build-assets.sh's config-driven behavior
// (docs/plans/deploy-config.md §4 Commit 3): plugins install/enabled must
// follow src/config/deploy-config.json (not the old hardcoded values), and
// the CF build must inject window.__owConfigInjected into index.html BEFORE
// the deploy-config.js loader tag.
//
// Runs the REAL build script against the REAL vendor/obsidian-mobile bundle
// and the REAL committed config — same pattern as proxy-worker.test.js
// exercising real network (LiveSync download). The LiveSync-specific
// assertion is soft (only checked when the download actually succeeded) so
// this test doesn't flake when the sandbox has no network — the
// config-driven layout-switcher + injected-config assertions below never
// depend on the network and always run.
//
// Run: bun test src/deployments/cloudflare/test/build-assets.test.js

import { expect, test } from 'bun:test';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF_DIR = path.resolve(__dirname, '..');
const MAIN_DIR = path.resolve(CF_DIR, '..', '..', '..');
const PUBLIC_DIR = path.join(MAIN_DIR, '.tmp', 'deployments', 'cloudflare', 'public');
const CONFIG_PATH = path.join(MAIN_DIR, 'src', 'config', 'deploy-config.json');

test('build-assets.sh: plugins install/enabled follow config.json + index.html gets window.__owConfigInjected before deploy-config.js', () => {
  execSync('bash scripts/build-assets.sh', {
    cwd: CF_DIR,
    stdio: 'pipe',
    timeout: 120000,
  });

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

  // ── LiveSync: install gate is config-driven and network-independent; the
  // `enabled` flag is only checkable if the (network-dependent) download
  // actually produced a manifest entry.
  const liveSyncEntry = manifest.plugins.find((p) => p.id === 'obsidian-livesync');
  if (config.plugins['obsidian-livesync'].install) {
    if (liveSyncEntry) {
      expect(liveSyncEntry.enabled).toBe(config.plugins['obsidian-livesync'].enabled);
      // MIT attribution (demo-and-docs-truth §3.5-a point 3): the license
      // must travel with the shipped plugin files, not just be documented.
      expect(liveSyncEntry.files).toContain('LICENSE');
      expect(fs.existsSync(path.join(PUBLIC_DIR, 'system-plugins', 'obsidian-livesync', 'LICENSE'))).toBe(true);
    } // else: network unavailable in this environment — build.sh already WARNs and continues, nothing more to assert.
  } else {
    expect(liveSyncEntry).toBeUndefined();
  }

  // ── Dataview: same config-driven/network-soft pattern as LiveSync above.
  // Added in demo-and-docs-truth §3.5-a — the demo's "Dataview Queries.md"
  // claims the plugin is installed and active; this is what makes that true.
  const dataviewEntry = manifest.plugins.find((p) => p.id === 'dataview');
  if (config.plugins.dataview.install) {
    if (dataviewEntry) {
      expect(dataviewEntry.enabled).toBe(config.plugins.dataview.enabled);
      expect(dataviewEntry.files).toContain('LICENSE');
      expect(fs.existsSync(path.join(PUBLIC_DIR, 'system-plugins', 'dataview', 'LICENSE'))).toBe(true);
    } // else: network unavailable — build.sh WARNs and continues, nothing more to assert.
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
