'use strict';

// Integration (brief §4 Commit 4): curl-style end-to-end through the real
// wired app — auth gates manifest/blob/stubs; SYNC_TOKEN missing at boot
// -> the process refuses to start (fail-closed) before ever listening.

const test = require('node:test');
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { createApp } = require('../index');

const TOKEN = 'e2e-test-token-xyz';

async function makeFixtureVault() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-server-e2e-'));
  await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
  await fsp.writeFile(path.join(root, 'notes', 'a.md'), 'hello e2e');
  return root;
}

async function startApp(vaultPath) {
  const app = createApp({ vaultPath, syncToken: TOKEN });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test('end-to-end: no token -> 401 on manifest and blob', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const manifestRes = await fetch(`${baseUrl}/sync/v1/manifest`);
  assert.equal(manifestRes.status, 401);

  const blobRes = await fetch(`${baseUrl}/sync/v1/blob/${'a'.repeat(64)}`);
  assert.equal(blobRes.status, 401);
});

test('end-to-end: full pull flow with a correct token — manifest then blob', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const manifestRes = await fetch(`${baseUrl}/sync/v1/manifest`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(manifestRes.status, 200);
  const manifest = await manifestRes.json();
  assert.equal(manifest.entries.length, 1);
  const [entry] = manifest.entries;
  assert.equal(entry.path, 'notes/a.md');
  assert.equal(entry.hash, crypto.createHash('sha256').update('hello e2e').digest('hex'));

  const blobRes = await fetch(`${baseUrl}/sync/v1/blob/${entry.hash}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(blobRes.status, 200);
  assert.equal(await blobRes.text(), 'hello e2e');
});

test('end-to-end: v2 stubs return 501 (with a valid token)', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const headers = { authorization: `Bearer ${TOKEN}` };
  for (const [method, urlPath] of [
    ['GET', '/sync/v1/changes'],
    ['GET', '/sync/v1/live'],
    ['POST', '/sync/v1/commit'],
    ['PUT', `/sync/v1/blob/${'b'.repeat(64)}`],
    ['GET', '/sync/v1/deletions'],
  ]) {
    const res = await fetch(`${baseUrl}${urlPath}`, { method, headers });
    assert.equal(res.status, 501, `${method} ${urlPath} should be 501`);
  }

  // v2 stubs are behind auth too — no token -> 401, not 501.
  const noAuthRes = await fetch(`${baseUrl}/sync/v1/changes`);
  assert.equal(noAuthRes.status, 401);
});

test('boot fail-closed: SYNC_TOKEN unset -> process exits before listening', async (t) => {
  const env = { ...process.env };
  delete env.SYNC_TOKEN;
  env.VAULT_PATH = '/tmp';
  env.PORT = '0'; // irrelevant — should never reach listen()

  const child = spawn('bun', [path.join(__dirname, '..', 'index.js')], { env, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { child.kill(); } catch (_) { /* already dead */ } });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /SYNC_TOKEN/);
});

test('boot fail-closed: VAULT_PATH unset -> process exits before listening', async (t) => {
  const env = { ...process.env, SYNC_TOKEN: TOKEN };
  delete env.VAULT_PATH;

  const child = spawn('bun', [path.join(__dirname, '..', 'index.js')], { env, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { child.kill(); } catch (_) { /* already dead */ } });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /VAULT_PATH/);
});

test('boot fail-closed: VAULT_PATH pointing at a nonexistent path -> process exits before listening (calev-heavy finding 1)', async (t) => {
  const env = {
    ...process.env,
    SYNC_TOKEN: TOKEN,
    VAULT_PATH: path.join(os.tmpdir(), 'sync-server-definitely-does-not-exist-' + Date.now()),
  };

  const child = spawn('bun', [path.join(__dirname, '..', 'index.js')], { env, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { child.kill(); } catch (_) { /* already dead */ } });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /VAULT_PATH does not exist/);
});

test('CORS (brief sync-server-cors §5): OPTIONS preflight on a real mounted route succeeds without a token', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const res = await fetch(`${baseUrl}/sync/v1/manifest`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://obsidian-online.pages.dev',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('access-control-allow-headers'), 'Authorization');
  assert.equal(res.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('CORS (brief sync-server-cors §5): cross-origin GET with a valid token succeeds and carries CORS headers', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const res = await fetch(`${baseUrl}/sync/v1/manifest`, {
    headers: {
      origin: 'https://obsidian-online.pages.dev',
      authorization: `Bearer ${TOKEN}`,
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('CORS (brief sync-server-cors §5): CORS does not bypass auth — cross-origin GET without/with-wrong token is still 401', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  const noToken = await fetch(`${baseUrl}/sync/v1/manifest`, {
    headers: { origin: 'https://obsidian-online.pages.dev' },
  });
  assert.equal(noToken.status, 401);

  const wrongToken = await fetch(`${baseUrl}/sync/v1/manifest`, {
    headers: { origin: 'https://obsidian-online.pages.dev', authorization: 'Bearer wrong' },
  });
  assert.equal(wrongToken.status, 401);
});

test('CORS (brief sync-server-cors §5, DDoS): OPTIONS preflight does zero filesystem work (never reaches the vault)', async (t) => {
  const root = await makeFixtureVault();
  const { baseUrl, close } = await startApp(root);
  t.after(async () => { await close(); await fsp.rm(root, { recursive: true, force: true }); });

  // Same technique as auth.test.js's "zero filesystem work" check — instrument
  // the real fs module; the preflight handler (cors.js) must never touch it,
  // since it's mounted before syncRouter/auth/manifestService entirely.
  const spies = ['stat', 'readdir', 'readFile', 'createReadStream'];
  const originals = spies.map((name) => fs[name]);
  const calls = { count: 0 };
  spies.forEach((name, i) => {
    fs[name] = (...args) => {
      calls.count += 1;
      return originals[i](...args);
    };
  });
  t.after(() => spies.forEach((name, i) => { fs[name] = originals[i]; }));

  await fetch(`${baseUrl}/sync/v1/manifest`, { method: 'OPTIONS', headers: { origin: 'https://x.example' } });
  await fetch(`${baseUrl}/sync/v1/blob/${'a'.repeat(64)}`, { method: 'OPTIONS', headers: { origin: 'https://x.example' } });

  assert.equal(calls.count, 0);
});

test('boot fail-closed: VAULT_PATH pointing at a file (not a directory) -> process exits before listening (calev-heavy finding 1)', async (t) => {
  const notADir = path.join(os.tmpdir(), 'sync-server-vault-path-is-a-file-' + Date.now());
  await fsp.writeFile(notADir, 'not a directory');
  t.after(() => fsp.rm(notADir, { force: true }));

  const env = { ...process.env, SYNC_TOKEN: TOKEN, VAULT_PATH: notADir };

  const child = spawn('bun', [path.join(__dirname, '..', 'index.js')], { env, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { child.kill(); } catch (_) { /* already dead */ } });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /VAULT_PATH is not a directory/);
});
