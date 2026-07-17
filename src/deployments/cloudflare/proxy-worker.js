// Cloudflare Worker port of src/server/api/proxy.js — outbound HTTP proxy for
// requests Obsidian initiates via ipcRenderer.send("request-url", ...). The
// browser cannot make these requests directly because external servers (e.g.
// releases.obsidian.md, GitHub) do not send CORS headers. capacitor-shim.js
// (client-mobile) intercepts those and forwards them here.
//
// POST /api/proxy-request
// Body:     { url, method, headers, contentType, body, binary }
// Response: { status, headers (lowercase), body } — body is ALWAYS base64
//           (matches capacitor-shim.js:732-740, which expects base64 always,
//           not just for binary payloads).
//
// Same allow-list + SSRF guard + redirect handling as the Node proxy — see
// src/server/api/proxy.js for the reference implementation this was ported
// from. Differences are Worker-runtime constraints only (no Buffer/Node http,
// manual redirect handling via fetch({redirect:'manual'})).
//
// Cache API (caches.default) for immutable downloads is added in a follow-up
// commit — see isCacheableHost/CACHEABLE_HOSTS below (not present yet here).

// Simple allow-list of hostnames we are willing to proxy. Keeps this from
// becoming an open proxy.
const ALLOWED_HOSTS = new Set([
  'releases.obsidian.md',
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'forum.obsidian.md',
  'obsidian.md',
  // Templater uses this:
  'templater-unsplash-2.fly.dev',
]);

export function isAllowed(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    if (ALLOWED_HOSTS.has(hostname)) return true;
    // Allow any subdomain of allowed roots.
    if (hostname.endsWith('.obsidian.md')) return true;
    if (hostname.endsWith('.github.com')) return true;
    if (hostname.endsWith('.githubusercontent.com')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

// ── base64 helpers (finding 1 🔴) ───────────────────────────────────────────
// There is no Buffer in the Worker runtime, and btoa() only accepts a
// "binary string" — NOT a Uint8Array/ArrayBuffer directly (it would silently
// stringify to "104,101,..." instead of encoding the bytes). Converting the
// whole buffer to a string in one shot via String.fromCharCode.apply(null,
// bytes) also blows the call stack on large buffers (plugin/asset downloads
// can be several MB), so this chunks the conversion.
export function bytesToB64(arrBuf) {
  const bytes = new Uint8Array(arrBuf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleProxy(request, ctx) {
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const { url, method = 'GET', headers = {}, contentType, body, binary } = payload || {};

  if (!url || typeof url !== 'string') return json({ error: 'url required' }, 400);
  if (!isAllowed(url)) return json({ error: 'host not allowed' }, 403);

  let resp;
  try {
    // finding 2 🔴: the whole outbound fetch + redirect chain is wrapped in
    // try/catch → 502 on any network failure, matching proxy.js's error
    // contract (capacitor-shim.js throws when `!pr.ok`).
    let cur = url;
    let m = method;
    const hdrs = { 'User-Agent': 'Obsidian/1.12.7', ...headers };
    if (contentType) hdrs['Content-Type'] = contentType;
    let reqBody = body ? (binary ? b64ToBytes(body) : body) : undefined;

    for (let i = 0; i < 6; i++) {
      resp = await fetch(cur, { method: m, headers: hdrs, body: reqBody, redirect: 'manual' });
      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location') && i < 5) {
        const next = new URL(resp.headers.get('location'), cur).toString();
        // SSRF guard: the redirect target must ALSO be allow-listed. GitHub's
        // release CDN (objects/release-assets.githubusercontent.com) is
        // covered by the `.githubusercontent.com` rule, so real downloads
        // still follow; a redirect to an internal/metadata host
        // (169.254.169.254, localhost) is refused.
        if (!isAllowed(next)) return json({ error: 'redirect to disallowed host blocked' }, 502);
        if (new URL(next).hostname !== new URL(cur).hostname) {
          delete hdrs.authorization;
          delete hdrs.Authorization;
          delete hdrs.cookie;
          delete hdrs.Cookie;
        }
        if (resp.status === 303) {
          m = 'GET';
          reqBody = undefined;
        }
        cur = next;
        continue;
      }
      break;
    }
  } catch (err) {
    return json({ error: (err && err.message) || 'fetch failed' }, 502);
  }

  const buf = await resp.arrayBuffer();
  const outHeaders = {};
  for (const [k, v] of resp.headers) outHeaders[k.toLowerCase()] = v;
  const responsePayload = JSON.stringify({
    status: resp.status,
    headers: outHeaders,
    body: bytesToB64(buf),
  });
  return new Response(responsePayload, { headers: { 'Content-Type': 'application/json' } });
}
