#!/usr/bin/env node
'use strict';

/**
 * patch-obsidian-mobile.js
 *
 * Applies build-time patches to the extracted Obsidian mobile bundle
 * (obsidian-mobile/app.js) so that:
 *
 *   1. The internal `Platform` object is exposed as `window.__owPlatform`.
 *   2. The entry IIFE merges `window.__owPlatformOverrides` into the
 *      Platform flags via `Object.assign`, so callers can override defaults.
 *   3. The body `is-mobile` class is gated on the post-override `isMobile`
 *      flag instead of being added unconditionally.
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
    // WHAT: Obsidian defines its `Platform` singleton as an object literal
    //   `{isDesktop:!1,isMobile:!1,isDesktopApp:!1,...}` assigned to a short var.
    //   We alias that var to `window.__owPlatform` so boot.js and the other
    //   patches below can read/gate on the live Platform flags from outside.
    // ANCHOR: search app.js for  isDesktop:!1,isMobile:!1,isDesktopApp:!1
    //   (the start of the Platform object literal — unique & stable). The
    //   `var X=` immediately before it is the assignment we hook.
    // REBUILD: keep the literal prefix verbatim; `\w{1,3}` matches the minified
    //   var name — widen it only if the name grows past 3 chars. `replace`
    //   just injects `window.__owPlatform=` after `var X=`.
    name: 'expose-platform',
    find:    /var (\w{1,3})=\{isDesktop:!1,isMobile:!1,isDesktopApp:!1/,
    replace: 'var $1=window.__owPlatform={isDesktop:!1,isMobile:!1,isDesktopApp:!1',
    expectedMatches: 1,
  },
  {
    // WHAT: at boot the entry IIFE sets the platform flags from runtime
    //   detection — `X.isMobileApp=!0,X.isMobile=!0,X.isAndroidApp=Dv,X.isIosApp=Tv,`.
    //   We wrap that run of assignments in `Object.assign(X,{...},window.__owPlatformOverrides||{})`
    //   so boot.js can override them (force desktop layout, block desktop-only
    //   plugins, etc.) — this is THE hook the whole platform-override system rides on.
    // ANCHOR: search app.js for  .isMobileApp=!0   (then confirm the following
    //   `.isMobile=!0,.isAndroidApp=<expr>,.isIosApp=<expr>,` run on the SAME var).
    // REBUILD: $1=the platform var, $2=the isAndroidApp expression, $3=the
    //   isIosApp expression. If Obsidian adds/removes/reorders a flag in this
    //   run, mirror the new order in BOTH `find` and the Object.assign literal.
    name: 'iife-overrides',
    find:    /(\w+)\.isMobileApp=!0,\1\.isMobile=!0,\1\.isAndroidApp=(\w+),\1\.isIosApp=(\w+),/,
    replace: 'Object.assign($1,{isMobileApp:!0,isMobile:!0,isAndroidApp:$2,isIosApp:$3},window.__owPlatformOverrides||{}),',
    expectedMatches: 1,
  },
  {
    // WHAT: the bundle unconditionally does `document.body.addClass("is-mobile")`.
    //   In desktop-layout mode (isMobile overridden to false) that class must
    //   NOT be added — it drives mobile-only CSS. We gate it on the live flag.
    // ANCHOR: search app.js for  addClass("is-mobile")   (stable string literal).
    // REBUILD: prefix the matched call with `window.__owPlatform.isMobile&&`.
    //   If the surrounding punctuation changes (e.g. `;` instead of `,`), adjust
    //   the trailing char in `find` and `replace` to match.
    name: 'is-mobile-class',
    find:    /document\.body\.addClass\("is-mobile"\),/,
    replace: 'window.__owPlatform.isMobile&&document.body.addClass("is-mobile"),',
    expectedMatches: 1,
  },
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
