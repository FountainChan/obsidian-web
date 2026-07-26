#!/usr/bin/env node
'use strict';

/**
 * install-dataview.js
 *
 * Downloads the Dataview community plugin (blacksmithgu/obsidian-dataview,
 * MIT-licensed) from GitHub releases and installs it into
 * vendor/plugins/dataview/ (+ its LICENSE — see scripts/install-plugin.js).
 *
 * Thin per-plugin wrapper around the generic scripts/install-plugin.js
 * engine — see install-livesync.js for the sibling wrapper (same shape).
 *
 * Usage:
 *   node scripts/install-dataview.js
 *   node scripts/install-dataview.js --version 0.5.70
 *   node scripts/install-dataview.js --force
 */

const { installPlugin } = require('./install-plugin');

const REPO = 'blacksmithgu/obsidian-dataview';
const DEST = 'dataview';

function parseArgs(argv) {
  const opts = { version: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version') {
      opts.version = argv[++i];
      if (!opts.version) throw new Error('--version requires a value');
    } else if (arg.startsWith('--version=')) {
      opts.version = arg.slice('--version='.length);
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log([
      'Usage: node scripts/install-dataview.js [options]',
      '',
      'Downloads Dataview from GitHub and installs it into',
      'vendor/plugins/dataview/.',
      '',
      'Options:',
      '  --version <tag>  Specific version tag, e.g. 0.5.70 (default: latest)',
      '  --force          Re-download even if files are cached; overwrite data.json',
      '  -h, --help       Show this help',
    ].join('\n'));
    return;
  }

  await installPlugin({ repo: REPO, dest: DEST, version: opts.version, force: opts.force });
  console.log('Restart the obsidian-web server for the plugin to become available.');
}

// ── exports for unit testing ─────────────────────────────────────────────────
module.exports = { resolveAssets: require('./install-plugin').resolveAssets, parseArgs };

// Run when invoked directly (not when require()d by tests).
if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1); });
}
