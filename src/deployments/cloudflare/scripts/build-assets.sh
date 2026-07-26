#!/usr/bin/env bash
# Build static assets for the CF Worker deployment — MOBILE runtime.
#
# Reads from:  src/client-mobile/ (our mobile client) + vendor/obsidian-mobile/
#              (extracted mobile bundle — self-contained: app.js/worker.js/
#              i18n/lib all live inside it, no dependency on vendor/obsidian-desktop).
# Writes to:   .tmp/deployments/cloudflare/public/ (deployment artifacts)
#
# Run from the cloudflare/ directory:
#   bash scripts/build-assets.sh
#
# Or via npm:
#   npm run build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# MAIN_DIR is the repo root, three levels up from src/deployments/cloudflare/.
MAIN_DIR="$(cd "$CF_DIR/../../.." && pwd)"
PUBLIC_DIR="$MAIN_DIR/.tmp/deployments/cloudflare/public"

echo "obsidian-web CF — building assets (mobile)"
echo "  main project : $MAIN_DIR"
echo "  output       : $PUBLIC_DIR"

# ── Verify vendor/obsidian-mobile/ exists ──────────────────────────────────
if [[ ! -f "$MAIN_DIR/vendor/obsidian-mobile/app.js" ]]; then
  echo ""
  echo "ERROR: vendor/obsidian-mobile/ directory not found or incomplete."
  echo "Run first: node $MAIN_DIR/scripts/update-obsidian-mobile.js"
  exit 1
fi

# ── deploy-config (docs/plans/deploy-config.md §3) — single source of truth
# for which system plugins ship/are-enabled and for window.__owConfigInjected
# below. Committed to the repo (not gitignored), so it is always present at
# build time — unlike vendor/, no existence-fallback needed here.
CONFIG_PATH="$MAIN_DIR/src/config/deploy-config.json"
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo ""
  echo "ERROR: $CONFIG_PATH not found — required for deploy config (plugins + injected config)."
  exit 1
fi

# ── Clean and recreate public/ ─────────────────────────────────────────────
rm -rf "$PUBLIC_DIR"
mkdir -p "$PUBLIC_DIR"

# ── Copy client-mobile shims and boot script ───────────────────────────────
echo "  copying client-mobile/..."
cp -r "$MAIN_DIR/src/client-mobile" "$PUBLIC_DIR/client-mobile"

# ── Copy obsidian-mobile renderer ──────────────────────────────────────────
echo "  copying obsidian-mobile/..."
cp -r "$MAIN_DIR/vendor/obsidian-mobile" "$PUBLIC_DIR/obsidian-mobile"

# ── Mirror resource dirs at root level (app.js fetches /i18n/*, /lib/*, …)
# obsidian-mobile is self-contained (independent of vendor/obsidian — see
# docs/plans/cf-mobile-serve.md §0) but only ships i18n/ + lib/ (no public/
# or sandbox/ — the [[ -d ]] guard below absorbs that, it is not a bug).
echo "  copying resource dirs..."
for dir in i18n lib public sandbox; do
  if [[ -d "$MAIN_DIR/vendor/obsidian-mobile/$dir" ]]; then
    cp -r "$MAIN_DIR/vendor/obsidian-mobile/$dir" "$PUBLIC_DIR/$dir"
  fi
done

# Worker scripts served at root (critical for metadata indexer — app.js does
# `new Worker("worker.js")`, resolved against the document's base URL / root).
cp "$MAIN_DIR/vendor/obsidian-mobile/worker.js" "$PUBLIC_DIR/worker.js"
if [[ -f "$MAIN_DIR/vendor/obsidian-mobile/sim.js" ]]; then
  cp "$MAIN_DIR/vendor/obsidian-mobile/sim.js" "$PUBLIC_DIR/sim.js"
fi

# ── index.html: mobile entry point, served at / ────────────────────────────
# No vault=demo injection, no starter.html — the mobile boot.js renders its
# own native no-vault screen when there is no VAULT_ID (opfs-ux). Seeding of
# demo/example content is a later slice (cf-mobile-seed).
echo "  copying index.html..."
cp "$MAIN_DIR/src/client-mobile/index.html" "$PUBLIC_DIR/index.html"

# PWA web manifest at the root (scope "/"); icons ride along under
# public/client-mobile/icons/ via the client-mobile copy above.
cp "$MAIN_DIR/src/client-mobile/manifest.webmanifest" "$PUBLIC_DIR/manifest.webmanifest"

# Replace ?v=<anything> on /client-mobile/ script tags with a build timestamp
# so browsers always pick up updated files after a new deploy.
BUST=$(date +%s)
echo "  cache buster: $BUST"
sed -i "s|/client-mobile/\([^\"]*\)?v=[^\"&]*\"|/client-mobile/\1?v=${BUST}\"|g" "$PUBLIC_DIR/index.html"

# ── deploy-config inject (docs/plans/deploy-config.md §3ב) — replaces the
# <!-- OW_CONFIG_INJECT --> marker (see index.html comment) with a literal
# <script>window.__owConfigInjected={...}</script> holding the full parsed
# config.json. Must precede the deploy-config.js tag — it already does in the
# source index.html, this step only substitutes the marker in place. Uses
# node -e (not sed) because the JSON payload can contain characters that
# would need escaping in a sed replacement.
echo "  injecting deploy-config (window.__owConfigInjected)..."
CONFIG_PATH="$CONFIG_PATH" HTML_PATH="$PUBLIC_DIR/index.html" node -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, "utf8"));
  const html = fs.readFileSync(process.env.HTML_PATH, "utf8");
  const marker = "<!-- OW_CONFIG_INJECT -->";
  if (!html.includes(marker)) {
    throw new Error("OW_CONFIG_INJECT marker not found in " + process.env.HTML_PATH);
  }
  const snippet = "<script>window.__owConfigInjected=" + JSON.stringify(config) + "</script>";
  fs.writeFileSync(process.env.HTML_PATH, html.replace(marker, snippet));
'

# ── Service Worker (offline + asset-cache — docs/plans/service-worker-offline.md
# §3ד) — copied to the public root so its scope covers the whole app. BUST is
# the same timestamp already used for ?v= above, so a new deploy = a new SW
# cache (CACHE='ow-sw-'+BUILD_ID inside sw.js). Note: sw.js is served from the
# root, not under /client-mobile/, so the sed above (which only targets
# /client-mobile/...?v= tags in index.html) does not touch it.
echo "  installing sw.js (BUILD_ID=${BUST})..."
cp "$MAIN_DIR/src/client-mobile/sw.js" "$PUBLIC_DIR/sw.js"
sed -i "s/__OW_BUILD__/${BUST}/g" "$PUBLIC_DIR/sw.js"   # BUST = ה-timestamp שכבר משמש ל-?v=

# ── system plugins → static (docs/plans/cf-mobile-seed.md §3א,
# cf-preinstall-livesync §3, demo-and-docs-truth §3.5-a) ──────────────────
# CF static hosting has no /api/system-plugins — seed-system-plugins.js falls
# back to fetching these static files when the API route 404s.
#
# One entry in src/config/deploy-config.json's `plugins` map per plugin —
# NOT a hardcoded shell-variable block per plugin (that pattern is exactly
# what broke down the moment a second/third plugin (LiveSync, then Dataview)
# needed the same treatment: see build-system-plugins.js header comment).
# `install` gates whether the plugin ships at all; `enabled` becomes the
# manifest's `enabled` flag (seed-system-plugins.js reads it to decide
# installed-but-disabled vs auto-enabled-on-seed).
echo "  building system-plugins/ (static, config-driven)..."
node "$SCRIPT_DIR/build-system-plugins.js" "$CONFIG_PATH" "$MAIN_DIR" "$PUBLIC_DIR"

# ── example vault content → static JSON (docs/plans/cf-mobile-seed.md §3א) ──
# template.js (cf/) exports TEMPLATE_FILES but imports plugins-generated.js,
# which is only generated by the (retired) cf-mobile-serve build step —
# orphan import (cf-mobile-seed finding 2). Stub it with an empty Map so
# template.js loads standalone; the example notes themselves (Welcome.md,
# Features/*) live directly in TEMPLATE_FILES, not in PLUGIN_FILES.
echo "  building example-vault.json (static)..."
echo 'export const PLUGIN_FILES = new Map();' > "$MAIN_DIR/src/deployments/cloudflare/plugins-generated.js"
node -e "import('$MAIN_DIR/src/deployments/cloudflare/template.js').then(m=>{require('fs').writeFileSync('$PUBLIC_DIR/example-vault.json', JSON.stringify([...m.TEMPLATE_FILES]))})"
rm "$MAIN_DIR/src/deployments/cloudflare/plugins-generated.js"

# ── Summary ────────────────────────────────────────────────────────────────
FILE_COUNT=$(find "$PUBLIC_DIR" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$PUBLIC_DIR" 2>/dev/null | cut -f1)

echo ""
echo "Done."
echo "  files : $FILE_COUNT"
echo "  size  : $TOTAL_SIZE"
echo ""
echo "Next:"
echo "  wrangler deploy          # deploy to Cloudflare"
echo "  wrangler dev              # local dev"
