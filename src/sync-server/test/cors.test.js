'use strict';

// Integration (brief sync-server-cors §4 Commit 2): the cors module wired
// into a real express app + real HTTP server, exercised with fetch() —
// mirrors the auth.test.js pattern (real listen(), real requests, no
// mocking of express itself).

const test = require('node:test');
const assert = require('assert/strict');
const express = require('express');
const http = require('http');

const { createCorsMiddleware } = require('../cors');

function startApp({ corsEnv } = {}) {
  // createCorsMiddleware() reads process.env.SYNC_CORS_ORIGIN synchronously
  // at call time, so it's safe to set-call-restore around the one call.
  const prev = process.env.SYNC_CORS_ORIGIN;
  if (corsEnv === undefined) delete process.env.SYNC_CORS_ORIGIN;
  else process.env.SYNC_CORS_ORIGIN = corsEnv;
  const { cors, preflight } = createCorsMiddleware();
  if (prev === undefined) delete process.env.SYNC_CORS_ORIGIN;
  else process.env.SYNC_CORS_ORIGIN = prev;

  const app = express();
  let routeHit = 0;
  app.use(cors);
  app.options('/protected', preflight);
  app.get('/protected', (req, res) => {
    routeHit += 1;
    res.status(200).json({ ok: true });
  });
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        getRouteHit: () => routeHit,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('OPTIONS preflight (no token, no auth header at all) -> 204 + full CORS headers', async (t) => {
  const { baseUrl, close } = await startApp();
  t.after(close);

  const res = await fetch(`${baseUrl}/protected`, {
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
  assert.equal(res.headers.get('access-control-max-age'), '86400');
});

test('Access-Control-Allow-Methods never includes PUT (v1 is pull-only)', async (t) => {
  const { baseUrl, close } = await startApp();
  t.after(close);

  const res = await fetch(`${baseUrl}/protected`, { method: 'OPTIONS' });
  assert.doesNotMatch(res.headers.get('access-control-allow-methods') || '', /PUT/);
});

test('default SYNC_CORS_ORIGIN is "*" — any Origin gets "*" back on a real GET', async (t) => {
  const { baseUrl, close } = await startApp();
  t.after(close);

  const res = await fetch(`${baseUrl}/protected`, {
    headers: { origin: 'https://anything.example' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('vary'), 'Origin');
});

test('SYNC_CORS_ORIGIN set to an explicit allowlist echoes a matching Origin', async (t) => {
  const { baseUrl, close } = await startApp({ corsEnv: 'https://allowed.example' });
  t.after(close);

  const res = await fetch(`${baseUrl}/protected`, {
    method: 'OPTIONS',
    headers: { origin: 'https://allowed.example' },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://allowed.example');
});

test('SYNC_CORS_ORIGIN allowlist: a non-matching Origin falls back to the configured value (not echoed)', async (t) => {
  const { baseUrl, close } = await startApp({ corsEnv: 'https://allowed.example' });
  t.after(close);

  const res = await fetch(`${baseUrl}/protected`, {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://allowed.example');
});

test('preflight does not reach the downstream route handler (OPTIONS is fully handled by cors.js)', async (t) => {
  const { baseUrl, getRouteHit, close } = await startApp();
  t.after(close);

  await fetch(`${baseUrl}/protected`, { method: 'OPTIONS' });
  assert.equal(getRouteHit(), 0);
});
