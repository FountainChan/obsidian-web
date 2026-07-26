#!/usr/bin/env node
'use strict';

/**
 * install-plugin.js
 *
 * Generic installer for third-party Obsidian community plugins distributed
 * as GitHub releases. Downloads `main.js` + `manifest.json` (+ `styles.css`
 * if present) from the plugin's latest (or pinned) GitHub release into
 * `vendor/plugins/<dest>/`, plus the repo's detected LICENSE file — every
 * plugin this project ships this way is MIT-licensed, and the license text
 * (with its copyright notice) must travel with the code, not just live in
 * a comment somewhere (docs/plans/demo-and-docs-truth.md §3.5-a point 3).
 *
 * This is the shared engine behind `scripts/install-livesync.js` and
 * `scripts/install-dataview.js` (thin per-plugin wrappers kept for the
 * documented CLI commands and env vars). `build-assets.sh` calls this
 * script directly, once per GitHub-sourced entry in
 * `src/config/deploy-config.json` — a loop, not a hardcoded block per
 * plugin (see docs/plans/demo-and-docs-truth.md §3.5-a point 2: the bug
 * this generalization fixes is that the *previous* version of this file
 * only knew about LiveSync, so a second plugin would have forced a copy of
 * the whole build-assets.sh block).
 *
 * Usage:
 *   node scripts/install-plugin.js --repo <owner/name> --dest <name>
 *   node scripts/install-plugin.js --repo <owner/name> --dest <name> --version v1.2.3
 *   node scripts/install-plugin.js --repo <owner/name> --dest <name> --force
 */

const fs  = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const http = require('http');
const path = require('path');
const { pipeline } = require('stream/promises');

const PROJECT_ROOT = path.resolve(__dirname, '..');
// Overridable so tests can point this at a local fixture server instead of
// the real GitHub API (demo-and-docs-truth §3.8ג: de-networking the
// cloudflare test suite — see test/fixtures/mock-github-server.js). Not
// meant to be set in normal use; the default is always the real API.
const GITHUB_REPOS = process.env.OW_GITHUB_API_BASE || 'https://api.github.com/repos';
const USER_AGENT   = 'obsidian-web-installer';

// Required assets that must be present in the release. fail loud if missing.
const REQUIRED_ASSETS = ['main.js', 'manifest.json'];
// Optional assets downloaded if present.
const OPTIONAL_ASSETS = ['styles.css'];

// ── helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { repo: null, dest: null, version: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') {
      opts.repo = argv[++i];
      if (!opts.repo) throw new Error('--repo requires a value, e.g. --repo owner/name');
    } else if (arg.startsWith('--repo=')) {
      opts.repo = arg.slice('--repo='.length);
    } else if (arg === '--dest') {
      opts.dest = argv[++i];
      if (!opts.dest) throw new Error('--dest requires a value');
    } else if (arg.startsWith('--dest=')) {
      opts.dest = arg.slice('--dest='.length);
    } else if (arg === '--version') {
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetries(label, fn, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (err.retryable === false || attempt === attempts) break;
      console.warn(`${label} failed (${err.message}); retrying ${attempt + 1}/${attempts}…`);
      await sleep(attempt * 1000);
    }
  }
  throw lastErr;
}

function request(url, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    // Real GitHub is always https:; a local test fixture server (see
    // OW_GITHUB_API_BASE above) is plain http: — pick the matching module
    // rather than assuming https: like production always uses.
    const transport = url.startsWith('http://') ? http : https;
    const req = transport.get(url, {
      headers: {
        Accept: json ? 'application/vnd.github+json' : 'application/octet-stream',
        'User-Agent': USER_AGENT,
      },
    }, (res) => {
      // Follow redirects.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).toString(), { json }));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const err = new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`);
          err.retryable = res.statusCode >= 500;
          reject(err);
        });
        return;
      }
      resolve(res);
    });
    req.on('error', err => { err.retryable = true; reject(err); });
  });
}

async function getJson(url) {
  return withRetries(`GET ${url}`, async () => {
    const res = await request(url, { json: true });
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  });
}

async function fetchRelease(repo, version) {
  if (!version) return getJson(`${GITHUB_REPOS}/${repo}/releases/latest`);
  // Tag conventions differ per plugin repo (LiveSync: "v0.23.8", Dataview:
  // "0.5.70", no "v"). Try the tag as given first, then the other form —
  // don't assume every plugin follows the same convention.
  const candidates = version.startsWith('v')
    ? [version, version.slice(1)]
    : [version, `v${version}`];
  let lastErr;
  for (const tag of candidates) {
    try {
      return await getJson(`${GITHUB_REPOS}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
    } catch (err) {
      lastErr = err;
      if (!/HTTP 404/.test(err.message)) throw err;   // only retry the tag-form on a 404
    }
  }
  throw lastErr;
}

/**
 * GitHub's repo-license endpoint auto-detects whatever license file the repo
 * actually has (LICENSE, LICENSE.txt, COPYING, ...) — no need to guess a
 * filename. Returns { path, content } (content already utf8-decoded) or null
 * if GitHub couldn't detect one (some repos genuinely have none).
 */
async function fetchLicense(repo) {
  let meta;
  try {
    meta = await getJson(`${GITHUB_REPOS}/${repo}/license`);
  } catch (err) {
    if (/HTTP 404/.test(err.message)) return null;   // no detected license — not our bug to fix here
    throw err;
  }
  if (!meta || typeof meta.content !== 'string') return null;
  const content = Buffer.from(meta.content, meta.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  return { path: meta.path || 'LICENSE', content };
}

/**
 * Pick a named asset from the release. Returns the asset object or null.
 */
function findAsset(release, name) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find(a => a.name === name) || null;
}

async function fileExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/**
 * Download a single release asset to a local file.
 * Uses a .download temp file to avoid partial writes.
 */
async function downloadAsset(asset, destination, force) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  if (!force && await fileExists(destination)) {
    console.log(`  Using cached ${path.relative(PROJECT_ROOT, destination)}`);
    return;
  }
  console.log(`  Downloading ${asset.name} (${(asset.size / 1024).toFixed(0)} KB)…`);
  await withRetries(`download ${asset.name}`, async () => {
    const tmp = `${destination}.download`;
    await fsp.rm(tmp, { force: true });
    try {
      const res = await request(asset.browser_download_url);
      await pipeline(res, fs.createWriteStream(tmp));
      await fsp.rename(tmp, destination);
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
  });
}

/**
 * Pick asset-download logic — pure function, testable without network.
 * Returns { required: [{asset, name}], optional: [{asset, name}] } or throws
 * if a required asset is missing.
 */
function resolveAssets(release) {
  const required = [];
  for (const name of REQUIRED_ASSETS) {
    const asset = findAsset(release, name);
    if (!asset) {
      throw new Error(
        `Required asset "${name}" not found in release ${release.tag_name}. ` +
        'Check the plugin repo\'s releases page for the actual asset names.',
      );
    }
    required.push({ asset, name });
  }

  const optional = [];
  for (const name of OPTIONAL_ASSETS) {
    const asset = findAsset(release, name);
    if (asset) optional.push({ asset, name });
  }

  return { required, optional };
}

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * installPlugin — importable entry point used by the per-plugin wrapper
 * scripts (install-livesync.js, install-dataview.js) and, in principle,
 * directly by build-assets.sh via `node scripts/install-plugin.js --repo ...`.
 *
 * Returns { version, files } on success (files = array of installed asset
 * filenames, e.g. ['main.js','manifest.json','styles.css']). Throws on any
 * unrecoverable failure (missing required asset, network failure after
 * retries, etc.) — the sole caller (build-system-plugins.js's buildOne(),
 * for an `install: true` entry) re-throws this to fail the whole build; it
 * does not warn-and-skip (see build-assets.sh, demo-and-docs-truth §3.6-ג).
 */
async function installPlugin({ repo, dest, version, force, extraData }) {
  if (!repo) throw new Error('installPlugin requires { repo }');
  if (!dest) throw new Error('installPlugin requires { dest }');

  const cacheDir  = path.join(PROJECT_ROOT, '.tmp', 'cache', `${dest}-releases`);
  const targetDir = path.join(PROJECT_ROOT, 'vendor', 'plugins', dest);

  console.log(version ? `Fetching ${repo} release ${version}…` : `Fetching latest ${repo} release…`);
  const release = await fetchRelease(repo, version);
  const resolvedVersion = release.tag_name;
  console.log(`Release: ${resolvedVersion}`);

  const { required, optional } = resolveAssets(release);

  console.log('Downloading assets…');
  const installedFiles = [];
  for (const { asset, name } of required.concat(optional)) {
    const cachePath = path.join(cacheDir, resolvedVersion, name);
    const destPath  = path.join(targetDir, name);
    await downloadAsset(asset, cachePath, force);
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.copyFile(cachePath, destPath);
    const stat = await fsp.stat(destPath);
    console.log(`  ${name.padEnd(20)} ${(stat.size / 1024).toFixed(0)} KB  →  vendor/plugins/${dest}/${name}`);
    installedFiles.push(name);
  }

  // License — mandatory attribution for the MIT-licensed plugins we install
  // this way (docs/plans/demo-and-docs-truth.md §3.5-a point 3: "the
  // attribution is not optional"). This used to be best-effort — warn and
  // ship anyway when GitHub's repo-license endpoint 404s — which is the
  // same "guard the action, not the result" gap already closed for main.js
  // in build-system-plugins.js (a plugin promised via `install:true` must
  // ship runnable code, not just resolve a download). Missing attribution
  // is that same gap for the LICENSE file: refuse to ship the plugin at all
  // rather than silently drop its required notice (calev round 4, finding 6).
  const license = await fetchLicense(repo);
  if (!license) {
    throw new Error(
      `plugin "${dest}" (${repo}) has no detectable LICENSE on GitHub — ` +
      'MIT attribution is mandatory for plugins installed this way, refusing to ship without one',
    );
  }
  await fsp.writeFile(path.join(targetDir, 'LICENSE'), license.content, 'utf8');
  console.log(`  LICENSE              (from ${repo}:${license.path})  →  vendor/plugins/${dest}/LICENSE`);

  // Read manifest to extract version string.
  const manifestPath = path.join(targetDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read downloaded manifest.json: ${err.message}`);
  }
  const pluginVersion = manifest.version || resolvedVersion;

  // Write data.json — only if missing or --force.
  const dataJsonPath = path.join(targetDir, 'data.json');
  const dataJsonExists = await fileExists(dataJsonPath);
  if (!dataJsonExists || force) {
    const dataJson = Object.assign({ version: pluginVersion }, extraData || {});
    await fsp.writeFile(dataJsonPath, JSON.stringify(dataJson, null, 2) + '\n', 'utf8');
    console.log(`  data.json             written (version: ${pluginVersion})`);
  } else {
    console.log(`  data.json             kept (already exists; use --force to overwrite)`);
  }

  console.log(`\nDone. ${manifest.id || dest} ${pluginVersion} installed to vendor/plugins/${dest}/`);
  return { version: pluginVersion, files: installedFiles };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.repo || !opts.dest) {
    console.log([
      'Usage: node scripts/install-plugin.js --repo <owner/name> --dest <name> [options]',
      '',
      'Downloads an Obsidian community plugin from its GitHub releases and',
      'installs it (+ its LICENSE) into vendor/plugins/<name>/.',
      '',
      'Required:',
      '  --repo <owner/name>  GitHub repo, e.g. blacksmithgu/obsidian-dataview',
      '  --dest <name>        Target subdirectory under vendor/plugins/',
      '',
      'Options:',
      '  --version <tag>  Specific version tag (default: latest)',
      '  --force          Re-download even if files are cached; overwrite data.json',
      '  -h, --help       Show this help',
    ].join('\n'));
    if (opts.help) return;
    process.exitCode = 1;
    return;
  }

  await installPlugin(opts);
  console.log('Restart the obsidian-web server for the plugin to become available.');
}

// ── exports for unit testing ─────────────────────────────────────────────────
module.exports = { resolveAssets, parseArgs, installPlugin };

// Run when invoked directly (not when require()d by tests).
if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1); });
}
