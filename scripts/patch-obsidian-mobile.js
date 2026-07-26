#!/usr/bin/env node
'use strict';

/**
 * patch-obsidian-mobile.js
 *
 * Applies build-time patches to the extracted Obsidian mobile bundle
 * (obsidian-mobile/app.js).
 *
 * As of docs/plans/runtime-platform-descriptors.md, this is down to ONE
 * documented patch (`vault-profile-on-desktop-layout`). The three patches
 * that used to expose `window.__owPlatform`, merge
 * `window.__owPlatformOverrides` into the Platform flags, and gate the
 * `is-mobile` body class were replaced by a runtime interceptor —
 * `src/client-mobile/platform-bridge.js` — that achieves the same effect by
 * wrapping `Object.defineProperty` instead of rewriting app.js. See that
 * brief for the full rationale (§0-§1) and the removed patches' history.
 *
 * The one patch that remains here is a genuine bundle edit with no runtime
 * equivalent yet: it makes the desktop-layout vault-profile panel render on
 * a code path that upstream mobile always guards off. Removing it is
 * blocked on a separate slice (our own vault-profile panel) — see this
 * patch's own doc block below.
 *
 * Importable:
 *   const { applyPatches, PATCHES } = require('./patch-obsidian-mobile');
 *
 * CLI-runnable:
 *   node scripts/patch-obsidian-mobile.js <path-to-app.js>
 *
 * If any regex no longer matches exactly the expected number of times,
 * `applyPatches` throws — silent failures here produce subtly broken
 * bundles that are hard to debug.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW TO FIX A BROKEN PATCH AFTER AN OBSIDIAN VERSION BUMP
 * ───────────────────────────────────────────────────────────────────────────
 * The bundle (app.js) is a single minified line. Variable names change between
 * builds, but the *structural shape* around each patch is stable. Each PATCH
 * below has a `doc` block with:
 *   • WHAT — the behavior the patch changes and why.
 *   • ANCHOR — a short, stable substring to grep for in the new app.js to
 *              locate the code (survives minification; not the full regex).
 *   • REBUILD — how to turn what you find into the new `find`/`replace`.
 * Workflow when a patch throws "expected N match(es), found M":
 *   1. Open the new vendor/obsidian-mobile/app.js.
 *   2. Search for that patch's ANCHOR string.
 *   3. Compare the surrounding code to the current `find` regex; adjust only
 *      the parts that changed (usually a variable name or added/removed flag).
 *   4. Keep capture groups aligned with `replace`. Re-run the patch.
 * The regexes intentionally use `\w+`/`\w{1,3}` for identifiers so a pure
 * variable-rename does NOT break them — only structural changes do.
 * Verified applying cleanly across Obsidian 1.11.7 and 1.12.7.
 */

const fsp = require('fs/promises');
const path = require('path');

const PATCHES = [
  {
    // The "vault profile" panel at the bottom of the left sidebar — contains
    // help icon, settings icon, and the current-vault dropdown. The mobile
    // bundle gates its rendering on `Platform.isDesktopApp` (always false in
    // a real mobile build). When we override `isMobile=false` to get desktop
    // layout, the panel is still missing because we don't (and can't) flip
    // `isDesktopApp` globally — that flag enables ~95 other code paths that
    // use Electron-only APIs which would crash at boot.
    //
    // This patch flips THIS ONE check to `!isMobile`, so the panel appears
    // whenever we're showing desktop layout, without touching the rest.
    //
    // Side effect: the vault-switcher dropdown click handler inside this
    // block calls `electron.ipcRenderer.sendSync("vault")` etc., which will
    // throw ReferenceError in mobile (we don't shim window.electron there).
    // The settings (⚙) and help (?) icons in the same block work fine
    // because they only call `app.setting.open()` / `app.openHelp()`.
    // Vault switching via this dropdown is a known follow-up; for now,
    // users can use `/starter` to switch vaults.
    //
    // ANCHOR: search app.js for  .vault.getName()   inside a block guarded by
    //   `<var>.isDesktopApp){var <x>=<app>.vault.getName(),<y>=""`.
    // REBUILD: $1=the Platform var; the group $2 captures everything from `){`
    //   through `getName(),<y>=""`. We only replace `<var>.isDesktopApp` with
    //   `!<var>.isMobile`, leaving $2 intact. If the vault-name rendering shape
    //   changes, re-anchor on `.vault.getName()` and re-capture the guard.
    name: 'vault-profile-on-desktop-layout',
    find:    /(\w+)\.isDesktopApp(\)\{var \w+=\w+\.vault\.getName\(\),\w+="")/,
    replace: '!$1.isMobile$2',
    expectedMatches: 1,
  },
];

async function applyPatches(appJsPath) {
  let content = await fsp.readFile(appJsPath, 'utf8');

  for (const patch of PATCHES) {
    // Count matches using a global flag (cloned from the non-global regex).
    const globalRegex = new RegExp(patch.find.source, 'g');
    const matches = content.match(globalRegex) || [];

    if (matches.length !== patch.expectedMatches) {
      throw new Error(
        `Patch "${patch.name}" expected ${patch.expectedMatches} match(es), ` +
        `found ${matches.length}. Obsidian's bundle changed shape.\n` +
        `  → Open scripts/patch-obsidian-mobile.js, find the "${patch.name}" PATCH,\n` +
        `    and follow its ANCHOR/REBUILD doc block to re-derive the regex\n` +
        `    against the new vendor/obsidian-mobile/app.js. See the "HOW TO FIX"\n` +
        `    header for the full workflow.`
      );
    }

    content = content.replace(patch.find, patch.replace);
    console.log(`  patched: ${patch.name} (${matches.length}x)`);
  }

  await fsp.writeFile(appJsPath, content, 'utf8');
}

module.exports = { applyPatches, PATCHES };

// CLI mode
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/patch-obsidian-mobile.js <path-to-app.js>');
    process.exit(1);
  }
  applyPatches(path.resolve(target))
    .then(() => console.log('Done.'))
    .catch(err => { console.error('Error:', err.message); process.exit(1); });
}
