#!/usr/bin/env node
'use strict';

/**
 * build-system-plugins.js
 *
 * Builds public/system-plugins/ (manifest.json + per-plugin files) for the
 * CF static deployment, driven entirely by src/config/deploy-config.json's
 * `plugins` map.
 *
 * Replaces what used to be a hand-hardcoded bash block per third-party
 * plugin (LAYOUT_INSTALL/LAYOUT_ENABLED/LAYOUT_VER + a separate
 * LS_INSTALL/LS_ENABLED/LS_VERSION/LS_FILES set, one per plugin) — see
 * docs/plans/demo-and-docs-truth.md §3.5-a point 2. Adding a plugin now
 * means one entry in deploy-config.json, not a copy of this logic: the
 * bug this generalization fixes is that the *previous* shape only knew
 * about two specific plugins by name, so a third (Dataview) or fourth
 * would have forced yet another hardcoded block.
 *
 * Two plugin `source`s:
 *   - "first-party": lives in src/plugins/<id>/ (our own code, tracked in
 *     git) — just copied, no download/license step (this project's own
 *     GPL-3.0 already covers it).
 *   - "github": downloaded from a GitHub release via
 *     scripts/install-plugin.js (main.js/manifest.json/styles.css +
 *     LICENSE) into vendor/plugins/<id>/, then copied the same way.
 *
 * A GitHub download failure never fails the whole build — it warns, skips
 * that one plugin, and the build continues with everything else (matches
 * the previous LiveSync-only behavior).
 *
 * Usage (invoked by build-assets.sh):
 *   node build-system-plugins.js <configPath> <mainDir> <publicDir>
 */

const fs = require('fs');
const path = require('path');
const { installPlugin } = require('../../../../scripts/install-plugin');

// LICENSE is included here (not treated as a side artifact) so it travels
// into every visitor's seeded `.obsidian/plugins/<id>/` copy too, not just
// the publicly-served build output — see the header comment above.
const ASSET_NAMES = ['main.js', 'manifest.json', 'styles.css', 'LICENSE'];

async function buildOne(id, cfg, mainDir) {
  if (cfg.source === 'first-party') {
    const srcDir = path.join(mainDir, 'src', 'plugins', id);
    const manifestPath = path.join(srcDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      console.warn(`  WARN: first-party plugin "${id}" has no src/plugins/${id}/manifest.json — skipping`);
      return null;
    }
    const version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
    return { srcDir, version };
  }

  if (cfg.source === 'github') {
    if (!cfg.repo) {
      console.warn(`  WARN: plugin "${id}" has source=github but no repo — skipping`);
      return null;
    }
    const pinnedVersion = (cfg.versionEnv && process.env[cfg.versionEnv]) || undefined;
    try {
      const result = await installPlugin({ repo: cfg.repo, dest: id, version: pinnedVersion });
      return { srcDir: path.join(mainDir, 'vendor', 'plugins', id), version: result.version };
    } catch (err) {
      console.warn(`  WARN: ${id} download failed (${err.message}) — skipping preinstall (build continues)`);
      return null;
    }
  }

  console.warn(`  WARN: plugin "${id}" has unknown source "${cfg.source}" — skipping`);
  return null;
}

async function main() {
  const [, , configPath, mainDir, publicDir] = process.argv;
  if (!configPath || !mainDir || !publicDir) {
    throw new Error('Usage: build-system-plugins.js <configPath> <mainDir> <publicDir>');
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const pluginsCfg = config.plugins || {};
  const outDir = path.join(publicDir, 'system-plugins');
  const manifestEntries = [];

  for (const [id, cfg] of Object.entries(pluginsCfg)) {
    if (!cfg.install) {
      console.log(`  config: plugins.${id}.install=false — skipping ${id}`);
      continue;
    }

    const resolved = await buildOne(id, cfg, mainDir);
    if (!resolved) continue;
    const { srcDir, version } = resolved;

    const destDir = path.join(outDir, id);
    fs.mkdirSync(destDir, { recursive: true });
    const files = [];
    for (const name of ASSET_NAMES) {
      const from = path.join(srcDir, name);
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, path.join(destDir, name));
        files.push(name);
      }
    }
    const enabled = cfg.enabled === true;
    manifestEntries.push({ id, version, files, enabled });
    console.log(`  ${id.padEnd(24)} ${String(version).padEnd(12)} enabled=${enabled}  (${cfg.source})`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ plugins: manifestEntries }));
}

main().catch((err) => {
  console.error('build-system-plugins.js failed:', err);
  process.exit(1);
});
