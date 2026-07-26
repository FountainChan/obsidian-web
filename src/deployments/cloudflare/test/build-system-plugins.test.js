// Isolated unit test for scripts/build-system-plugins.js's per-plugin resolve
// step. Unlike build-assets.test.js (which runs the REAL build against the
// REAL committed config + REAL network), this test drives the script
// directly against a throwaway fixture — no network, no vendor/, no
// deploy-config.json — so it stays fast and deterministic.
//
// demo-and-docs-truth §3.7 (calev NO-GO round 3, finding 4): DoD#13's
// hard-fail guards the DOWNLOAD (a GitHub fetch that fails throws), but not
// the RESULT — a first-party plugin with `install: true` whose
// `manifest.json` exists but whose `main.js` does not still exited 0 and
// shipped `{"files":["manifest.json"],"enabled":true}`: a promised, enabled
// plugin with zero code. The noisy download failure covered a broken
// package, not a failed download. This test proves the RED case first.

import { expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF_DIR = path.resolve(__dirname, '..');
const SCRIPT = path.join(CF_DIR, 'scripts', 'build-system-plugins.js');

/** Builds a throwaway { configPath, mainDir, publicDir } fixture under a
 * fresh tmp dir, with a first-party plugin `fakeplug` whose manifest.json
 * exists but whose main.js is missing (the exact bug shape). Returns the
 * paths build-system-plugins.js expects as argv.
 */
function makeFixture({ withMainJs }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsp-test-'));
  const mainDir = path.join(root, 'main');
  const pluginDir = path.join(mainDir, 'src', 'plugins', 'fakeplug');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: 'fakeplug', version: '1.0.0' }),
  );
  if (withMainJs) {
    fs.writeFileSync(path.join(pluginDir, 'main.js'), '// fake plugin code\n');
  }

  const configPath = path.join(root, 'cfg.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      plugins: {
        fakeplug: { install: true, enabled: true, source: 'first-party' },
      },
    }),
  );

  const publicDir = path.join(root, 'out');
  return { root, configPath, mainDir, publicDir };
}

test('build-system-plugins.js: first-party install:true plugin with manifest.json but no main.js fails the build (§3.7 finding 4)', () => {
  const { configPath, mainDir, publicDir } = makeFixture({ withMainJs: false });

  let threw = false;
  let status;
  let stderr = '';
  try {
    execFileSync('node', [SCRIPT, configPath, mainDir, publicDir], { stdio: 'pipe' });
  } catch (err) {
    threw = true;
    status = err.status;
    stderr = String(err.stderr || '');
  }

  expect(threw).toBe(true);
  expect(status).not.toBe(0);
  expect(stderr).toMatch(/fakeplug/);
  expect(stderr).toMatch(/main\.js/);

  // The failure must be a hard build failure, not a soft one that ships an
  // incomplete-but-enabled plugin — no manifest.json should be written at all.
  expect(fs.existsSync(path.join(publicDir, 'system-plugins', 'manifest.json'))).toBe(false);
});

test('build-system-plugins.js: first-party install:true plugin WITH main.js still succeeds (regression guard)', () => {
  const { configPath, mainDir, publicDir } = makeFixture({ withMainJs: true });

  execFileSync('node', [SCRIPT, configPath, mainDir, publicDir], { stdio: 'pipe' });

  const manifest = JSON.parse(
    fs.readFileSync(path.join(publicDir, 'system-plugins', 'manifest.json'), 'utf8'),
  );
  const entry = manifest.plugins.find((p) => p.id === 'fakeplug');
  expect(entry).toBeTruthy();
  expect(entry.enabled).toBe(true);
  expect(entry.files).toContain('main.js');
  expect(entry.files).toContain('manifest.json');
});
