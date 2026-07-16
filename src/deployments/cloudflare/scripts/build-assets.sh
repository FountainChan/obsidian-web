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
