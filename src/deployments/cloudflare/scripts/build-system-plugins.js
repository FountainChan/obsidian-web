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
 * A plugin listed with `install: true` MUST resolve — a GitHub download
 * failure (or a bad config: no repo, unknown source, missing first-party
 * manifest) throws and fails the WHOLE build (see main()'s top-level
 * .catch(), which process.exit(1)s). This used to warn-and-skip instead,
 * matching the previous LiveSync-only behavior — but once a demo text
 * *claims* a plugin is installed (docs/plans/demo-and-docs-truth.md §3.5-a,
 * "Features/Dataview Queries.md"), a soft failure here silently reships
 * that exact claim as a lie: build exits 0, the manifest just drops the
 * plugin, and nobody notices until a visitor sees 4 raw ```dataview code
 * blocks (§3.6-ג, DoD#13). Failing loudly is the fix.
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

// Only called for cfg.install === true entries (main()'s loop filters first)
// — every branch here means "this plugin was promised, so it must resolve."
// Throwing (rather than warn+return null) is the point of this function now:
// see the header comment above (§3.6-ג, F4).
async function buildOne(id, cfg, mainDir) {
  if (cfg.source === 'first-party') {
    const srcDir = path.join(mainDir, 'src', 'plugins', id);
    const manifestPath = path.join(srcDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `plugin "${id}" has install=true (source=first-party) but no ` +
        `src/plugins/${id}/manifest.json — cannot ship what's promised`,
      );
    }
    const version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
    return { srcDir, version };
  }

  if (cfg.source === 'github') {
    if (!cfg.repo) {
      throw new Error(`plugin "${id}" has install=true (source=github) but no repo configured`);
    }
    const pinnedVersion = (cfg.versionEnv && process.env[cfg.versionEnv]) || undefined;
    try {
      const result = await installPlugin({ repo: cfg.repo, dest: id, version: pinnedVersion });
      // Use the dir installPlugin() actually wrote to (honors
      // OW_VENDOR_PLUGINS_DIR — see scripts/install-plugin.js), not a
      // recomputed vendor/plugins/<id> that would silently diverge from it.
      return { srcDir: result.dir, version: result.version };
    } catch (err) {
      throw new Error(`plugin "${id}" has install=true but the GitHub download failed: ${err.message}`);
    }
  }

  throw new Error(`plugin "${id}" has install=true but unknown source "${cfg.source}"`);
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

    // No `if (!resolved) continue` here anymore — buildOne() now throws
    // instead of returning null for an install=true entry that can't be
    // resolved, and that throw is meant to reach main().catch() below and
    // fail the whole build (§3.6-ג, F4).
    const { srcDir, version } = await buildOne(id, cfg, mainDir);

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
    // buildOne() above only guards the DOWNLOAD/manifest step (a GitHub
    // fetch failure, or a first-party plugin with no manifest.json at all).
    // It says nothing about whether the plugin's actual CODE landed — an
    // `install:true` entry whose main.js is missing (corrupt release asset,
    // half-finished first-party plugin) used to still exit 0 here and ship
    // `enabled:true` with zero code (§3.7, calev NO-GO round 3, finding 4).
    // A plugin promised via `install:true` must ship runnable code, not just
    // a manifest.
    if (!files.includes('main.js')) {
      throw new Error(
        `plugin "${id}" has install=true but no main.js was found in ${srcDir} — ` +
        `cannot ship an enabled plugin with no code`,
      );
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
