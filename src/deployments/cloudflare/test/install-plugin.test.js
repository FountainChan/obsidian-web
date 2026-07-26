// Unit test for scripts/install-plugin.js's LICENSE attribution requirement
// (demo-and-docs-truth §3.5-a point 3 / calev round 4 finding 6): every
// plugin this project ships this way is MIT-licensed, and the license
// attribution is NOT optional — a GitHub repo where the `/license` endpoint
// genuinely 404s used to still ship (best-effort: WARN + exit 0, same
// "guard the action, not the result" family already fixed for main.js in
// build-system-plugins.js). This test proves the RED case first: a missing
// LICENSE must now fail the whole install, not just warn.
//
// Mocks Node's `https` module in-process by monkeypatching the module-level
// `https.get` — Node's require() cache guarantees this test's `https` object
// IS the same singleton scripts/install-plugin.js calls into, so no real
// network / no real "repo with no LICENSE" fixture is needed. Keeps this
// fast and deterministic (see also demo-and-docs-truth §3.8ג: de-networking
// the rest of this package's tests).

import { afterEach, afterAll, expect, test } from 'bun:test';
import https from 'https';
import { Readable } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Redirect scripts/install-plugin.js's writes to a throwaway temp dir
// (demo-and-docs-truth round 5, calev finding 7) — set BEFORE require()ing
// it, since it reads OW_VENDOR_PLUGINS_DIR once at module load. Without
// this, the dest dirs below (unique names, cleaned up per-test) would still
// be created and removed under the real vendor/plugins/, which is a symlink
// shared by every git worktree of this repo — this test never needs to
// touch that shared path at all.
const VENDOR_PLUGINS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-vendor-plugins-'));
process.env.OW_VENDOR_PLUGINS_DIR = VENDOR_PLUGINS_DIR;
afterAll(() => {
  fs.rmSync(VENDOR_PLUGINS_DIR, { recursive: true, force: true });
});

const require = createRequire(import.meta.url);
const { installPlugin } = require(path.join(REPO_ROOT, 'scripts', 'install-plugin.js'));

const realGet = https.get;

afterEach(() => {
  https.get = realGet;
});

function fakeRes(statusCode, body, headers = {}) {
  const res = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  res.statusCode = statusCode;
  res.headers = headers;
  return res;
}

// Installs a fake `https.get` that answers exactly the requests
// installPlugin() makes: release metadata, the two required asset
// downloads, and the license lookup — nothing else (an unexpected URL
// throws loudly so the test fails clearly instead of hanging).
function installMockGithub({ withLicense }) {
  https.get = (url, _options, callback) => {
    const urlStr = url.toString();
    let res;
    if (/\/releases\/latest$/.test(urlStr)) {
      res = fakeRes(200, JSON.stringify({
        tag_name: 'v0.0.0-test',
        assets: [
          { name: 'main.js', browser_download_url: 'https://fake.test/main.js', size: 10 },
          { name: 'manifest.json', browser_download_url: 'https://fake.test/manifest.json', size: 10 },
        ],
      }));
    } else if (urlStr === 'https://fake.test/main.js') {
      res = fakeRes(200, '// fake plugin\n');
    } else if (urlStr === 'https://fake.test/manifest.json') {
      res = fakeRes(200, JSON.stringify({ id: 'fakeplug-license-test', version: '1.0.0' }));
    } else if (/\/license$/.test(urlStr)) {
      res = withLicense
        ? fakeRes(200, JSON.stringify({
            path: 'LICENSE',
            content: Buffer.from('MIT License\n\nCopyright (c) mock\n').toString('base64'),
            encoding: 'base64',
          }))
        : fakeRes(404, JSON.stringify({ message: 'Not Found' }));
    } else {
      throw new Error(`unexpected URL in test: ${urlStr}`);
    }
    setImmediate(() => callback(res));
    return { on() {} }; // fake ClientRequest — no transport-level error path exercised here
  };
}

function cleanup(dest) {
  fs.rmSync(path.join(VENDOR_PLUGINS_DIR, dest), { recursive: true, force: true });
  fs.rmSync(path.join(REPO_ROOT, '.tmp', 'cache', `${dest}-releases`), { recursive: true, force: true });
}

test('installPlugin refuses to ship a plugin when GitHub has no detectable LICENSE (§3.5-a.3 — attribution is mandatory, not best-effort)', async () => {
  const dest = '__license-test-missing__';
  installMockGithub({ withLicense: false });
  try {
    // The throw happens after installPlugin() already downloaded main.js/
    // manifest.json to vendor/plugins/<dest>/ (an intermediate cache dir,
    // not the deployment output) — what matters is that it never reaches
    // build-system-plugins.js's copy-into-public-output step, so the
    // shipped deployment never gets this plugin without its LICENSE.
    await expect(installPlugin({ repo: 'fake/repo-no-license', dest })).rejects.toThrow(/LICENSE/i);
  } finally {
    cleanup(dest);
  }
});

test('installPlugin succeeds and writes LICENSE when GitHub detects one (regression guard)', async () => {
  const dest = '__license-test-present__';
  installMockGithub({ withLicense: true });
  try {
    const result = await installPlugin({ repo: 'fake/repo-with-license', dest });
    expect(result.files).toContain('main.js');
    expect(fs.existsSync(path.join(VENDOR_PLUGINS_DIR, dest, 'LICENSE'))).toBe(true);
  } finally {
    cleanup(dest);
  }
});
