#!/usr/bin/env bash
# Build static assets for the CF Worker deployment — MOBILE runtime.
#
# Reads from:  src/client-mobile/ (our mobile client) + vendor/obsidian-mobile/
#              (extracted mobile bundle — self-contained: app.js/worker.js/
#              i18n/lib all live inside it, no dependency on vendor/obsidian).
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

# Replace ?v=<anything> on /client-mobile/ script tags with a build timestamp
# so browsers always pick up updated files after a new deploy.
BUST=$(date +%s)
echo "  cache buster: $BUST"
sed -i "s|/client-mobile/\([^\"]*\)?v=[^\"&]*\"|/client-mobile/\1?v=${BUST}\"|g" "$PUBLIC_DIR/index.html"

# ── Service Worker (offline + asset-cache — docs/plans/service-worker-offline.md
# §3ד) — copied to the public root so its scope covers the whole app. BUST is
# the same timestamp already used for ?v= above, so a new deploy = a new SW
# cache (CACHE='ow-sw-'+BUILD_ID inside sw.js). Note: sw.js is served from the
# root, not under /client-mobile/, so the sed above (which only targets
# /client-mobile/...?v= tags in index.html) does not touch it.
echo "  installing sw.js (BUILD_ID=${BUST})..."
cp "$MAIN_DIR/src/client-mobile/sw.js" "$PUBLIC_DIR/sw.js"
sed -i "s/__OW_BUILD__/${BUST}/g" "$PUBLIC_DIR/sw.js"   # BUST = ה-timestamp שכבר משמש ל-?v=

# ── system plugins (layout-switcher + LiveSync) → static (docs/plans/cf-mobile-seed.md §3א, cf-preinstall-livesync §3) ──
# CF static hosting has no /api/system-plugins — seed-system-plugins.js falls
# back to fetching these static files when the API route 404s.
echo "  building system-plugins/ (static)..."

# system-plugins/ — layout-switcher (קיים) + LiveSync (חדש, מותקן-מכובה)
mkdir -p "$PUBLIC_DIR/system-plugins/obsidian-web-layout"
cp "$MAIN_DIR/src/plugins/obsidian-web-layout/"* "$PUBLIC_DIR/system-plugins/obsidian-web-layout/"
LAYOUT_VER=$(node -p "require('$MAIN_DIR/src/plugins/obsidian-web-layout/manifest.json').version")

# LiveSync — מותקן-מכובה. finding 1: `if node ...; then` בולע exit(1) → set -e לא מפיל.
LS_PIN="${SEED_LIVESYNC_VERSION:-}"      # ריק=latest; נעילת-גרסה אופציונלית
LS_VERSION=""; LS_FILES=""              # finding 3: init לפני set -u
if node "$MAIN_DIR/scripts/install-livesync.js" ${LS_PIN:+--version "$LS_PIN"}; then
  LS_SRC="$MAIN_DIR/vendor/plugins/obsidian-livesync"
  if [[ -f "$LS_SRC/main.js" && -f "$LS_SRC/manifest.json" ]]; then
    DEST="$PUBLIC_DIR/system-plugins/obsidian-livesync"; mkdir -p "$DEST"
    cp "$LS_SRC/main.js" "$LS_SRC/manifest.json" "$DEST/"          # finding 4: מפורש, לא *.json (מדלג data.json)
    LS_FILES='["main.js","manifest.json"]'
    if [[ -f "$LS_SRC/styles.css" ]]; then cp "$LS_SRC/styles.css" "$DEST/"; LS_FILES='["main.js","manifest.json","styles.css"]'; fi
    LS_VERSION=$(node -p "require('$LS_SRC/manifest.json').version")
  fi
else
  echo "  WARN: obsidian-livesync download failed — skipping preinstall (build continues, layout-switcher only)"
fi

# manifest.json — finding 2: env מיוצא inline לפני node -e (אחרת process.env undefined → abort)
LAYOUT_VER="$LAYOUT_VER" LS_VERSION="$LS_VERSION" LS_FILES="$LS_FILES" OUT="$PUBLIC_DIR/system-plugins/manifest.json" node -e '
  const fs=require("fs");
  const plugins=[{id:"obsidian-web-layout",version:process.env.LAYOUT_VER,files:["main.js","manifest.json"],enabled:true}];
  if (process.env.LS_VERSION) plugins.push({id:"obsidian-livesync",version:process.env.LS_VERSION,files:JSON.parse(process.env.LS_FILES),enabled:false});
  fs.writeFileSync(process.env.OUT, JSON.stringify({plugins}));
'

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
