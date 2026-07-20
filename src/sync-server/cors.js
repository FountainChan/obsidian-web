'use strict';

// Cross-origin support for sync-server (brief sync-server-cors §3א).
//
// The whole point of sync-server is to be pulled from *another* origin (the
// obsidian-web app running on pages.dev, syncing a vault exposed by the
// user through a tunnel). A plain browser fetch() to a cross-origin URL
// first sends an OPTIONS preflight *without* Authorization — if that
// preflight ever reaches the auth middleware it gets a bare 401 with no
// Access-Control-* headers, and the browser refuses the whole request
// before the real GET is even attempted.
//
// DDoS constraint (unchanged from auth.js): this module must stay O(1) —
// no filesystem access, no hashing, no vault walk. Flooding OPTIONS costs
// the server the same ~nothing as flooding wrong tokens costs auth.js.
//
// `createCorsMiddleware()` returns two pieces, both mounted app-level in
// index.js *before* `app.use('/sync/v1', syncRouter)` (the syncRouter is
// where auth lives) — see index.js for the exact mount order:
//   - `cors`: sets Access-Control-Allow-Origin (+ Vary) on every response,
//     including the real GET/PUT responses that do reach the router.
//   - `preflight`: the OPTIONS handler — 204, no auth, no FS, just headers.

const ALLOW_HEADERS = 'Authorization';
const ALLOW_METHODS = 'GET, OPTIONS'; // v1 is pull-only — no PUT (that's a v2 stub)
const MAX_AGE = '86400';

function createCorsMiddleware() {
  // SYNC_CORS_ORIGIN default '*' — safe here because the client sends the
  // token as an Authorization header, never `credentials: 'include'`
  // cookies (brief §0.1(2)), so there is no credential-leak risk in
  // reflecting '*'. An operator who wants to lock this down can set
  // SYNC_CORS_ORIGIN to one or more comma-separated exact origins, e.g.
  // SYNC_CORS_ORIGIN=https://obsidian-online.pages.dev
  const configured = process.env.SYNC_CORS_ORIGIN || '*';
  const allowlist = configured === '*'
    ? null
    : configured.split(',').map((s) => s.trim()).filter(Boolean);

  // Resolve the Access-Control-Allow-Origin value for a given request:
  //  - no allowlist configured (default) -> always '*'.
  //  - allowlist configured -> echo the request Origin if it's on the
  //    list, otherwise fall back to the first configured origin (keeps the
  //    header non-empty/well-formed even for a disallowed origin; the
  //    browser still enforces the mismatch and blocks the response).
  function resolveAllowOrigin(reqOrigin) {
    if (!allowlist) return '*';
    if (reqOrigin && allowlist.includes(reqOrigin)) return reqOrigin;
    return allowlist[0];
  }

  function cors(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', resolveAllowOrigin(req.headers.origin));
    res.setHeader('Vary', 'Origin');
    next();
  }

  // OPTIONS preflight handler — mounted at app level, before the syncRouter
  // (and therefore before auth). Zero I/O: set the CORS headers and return
  // 204 immediately. Never touches the vault, never checks the token.
  function preflight(req, res) {
    res.setHeader('Access-Control-Allow-Origin', resolveAllowOrigin(req.headers.origin));
    res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.setHeader('Access-Control-Max-Age', MAX_AGE);
    res.setHeader('Vary', 'Origin');
    res.status(204).end();
  }

  return { cors, preflight };
}

module.exports = { createCorsMiddleware };
