'use strict';

// Lean pull-sync server: /sync/v1/{manifest,blob} behind Bearer auth.
// Separate package from src/runtime-server/server (brief §0 — the app is
// static/serverless; this server is optional, run by whoever wants to
// expose a vault directory for the OPFS sync client to pull from).

const fs = require('fs');
const express = require('express');

const { createAuthMiddleware } = require('./auth');
const { createManifestService, createManifestRouter } = require('./manifest');
const { createBlobRouter } = require('./blob');
const { createStubRouter } = require('./stubs-v2');
const { createCorsMiddleware } = require('./cors');

function createApp({ vaultPath, syncToken }) {
  if (!vaultPath) throw new Error('vaultPath is required');
  if (!syncToken) throw new Error('syncToken is required');

  const app = express();
  const manifestService = createManifestService(vaultPath);

  const syncRouter = express.Router();
  // auth is mounted FIRST, before any route/FS work (brief §3א) — a
  // rejected request never reaches manifestRouter/blobRouter, so it never
  // touches the vault.
  syncRouter.use(createAuthMiddleware(syncToken));
  syncRouter.use(createManifestRouter(manifestService));
  syncRouter.use(createBlobRouter(vaultPath, manifestService));
  syncRouter.use(createStubRouter());

  // CORS (brief sync-server-cors §3א) — app-level, mounted BEFORE
  // app.use('/sync/v1', syncRouter): the auth middleware lives *inside*
  // syncRouter, so a request that never reaches syncRouter never touches
  // auth/FS. The browser's OPTIONS preflight (sent without Authorization)
  // must succeed WITHOUT hitting auth, or cross-origin fetch() never gets
  // to send the real GET. `preflight` is O(1) — no FS, no vault walk — so
  // this preserves the DDoS posture: flooding OPTIONS costs ~nothing, same
  // as flooding wrong tokens costs auth.js. GET/PUT still go through
  // syncRouter -> auth first, unaffected.
  const { cors, preflight } = createCorsMiddleware();
  app.use(cors);
  app.options('/sync/v1/*', preflight);
  app.use('/sync/v1', syncRouter);

  // Generic error handler — keep response bodies free of stack traces /
  // absolute filesystem paths (e.g. a resolveSafe() rejection from blob.js).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[sync-server] error handling', req.method, req.originalUrl, '-', err.message);
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

function startServer() {
  // fail-closed at boot (brief §3א, avigail finding 1) — checked here,
  // before createApp()/listen(), not at request-time: an unset SYNC_TOKEN
  // must refuse to start, not throw a TypeError mid-request (which would
  // look like a 500, not a clean refusal). Deliberately NOT at module
  // top-level: this file's createApp export is also required directly by
  // the test suite (same pattern as runtime-server/server/index.js), and a
  // top-level process.exit(1) would kill the test runner itself whenever
  // SYNC_TOKEN isn't in its environment. Gating on `require.main === module`
  // (see bottom of file) keeps the fail-closed guarantee for the real
  // `bun index.js` entrypoint while keeping createApp importable as a library.
  if (!process.env.SYNC_TOKEN) {
    console.error('[sync-server] SYNC_TOKEN is required — refusing to start (fail-closed).');
    process.exit(1);
  }

  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    console.error('[sync-server] VAULT_PATH is required — refusing to start.');
    process.exit(1);
  }
  // Validity, not just presence (calev-heavy finding 1): a typo'd/missing
  // VAULT_PATH must not boot successfully and then fail per-request — fail
  // closed here too, before listen(), so a bad path is caught immediately
  // instead of silently degrading every request to a 500 later.
  let vaultStat;
  try {
    vaultStat = fs.statSync(vaultPath);
  } catch (err) {
    console.error(`[sync-server] VAULT_PATH does not exist: ${vaultPath} (${err.message})`);
    process.exit(1);
  }
  if (!vaultStat.isDirectory()) {
    console.error(`[sync-server] VAULT_PATH is not a directory: ${vaultPath}`);
    process.exit(1);
  }

  const port = Number(process.env.PORT) || 4000;
  // brief sync-server-cors §3ב: sync-server is meant to be reached from
  // another device (that's the whole point — pulling a vault remotely),
  // but the recommended way to expose it is a tunnel (cloudflared,
  // `ssh -R`, tailscale, ...) terminating on localhost — NOT binding
  // directly to all interfaces. HOST therefore defaults to 127.0.0.1
  // (localhost-only bind); the tunnel is what makes it reachable from
  // outside. Set HOST=0.0.0.0 to bind all interfaces directly instead (see
  // the security warning below and in README.md — SYNC_TOKEN is still the
  // only thing standing between an attacker and the vault in that case).
  const host = process.env.HOST || '127.0.0.1';
  if (host === '0.0.0.0') {
    console.warn(
      '[sync-server] listening on 0.0.0.0 (all interfaces) — protected only by ' +
      'SYNC_TOKEN. Set HOST=127.0.0.1 to restrict to localhost. See README.md.'
    );
  }

  const app = createApp({ vaultPath, syncToken: process.env.SYNC_TOKEN });
  app.listen(port, host, () => {
    console.log(`[sync-server] vault=${vaultPath} listening on http://${host}:${port}/sync/v1`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp };
