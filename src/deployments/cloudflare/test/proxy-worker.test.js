// Bun integration test for the Cloudflare Worker proxy (src/deployments/cloudflare/proxy-worker.js).
//
// Why Bun and not `wrangler dev`/workerd: workerd does not produce results in
// this sandbox (hangs even on a trivial Worker — known environment gap, see
// dev/docs/walkthrough.md:840 "אין לנו CF deploy מקומי"). Bun implements
// fetch/Request/Response/btoa/atob/URL to the same spec as workerd, so
// `handleProxy`/`isAllowed`/`bytesToB64`/`b64ToBytes` run unmodified under
// `bun test`, against the REAL network (GitHub/obsidian.md — no mocking of
// the outbound fetch itself). See brief §0 "Testing strategy — מעודכן".
//
// Run: bun test src/deployments/cloudflare/test/proxy-worker.test.js

import { expect, test, describe } from 'bun:test';
import { handleProxy, isAllowed, bytesToB64, b64ToBytes } from '../proxy-worker.js';

// Minimal ctx stub — handleProxy calls ctx.waitUntil() when caching (Commit 1
// onward); Commit 0 doesn't cache, but keep the stub future-proof.
function makeCtx() {
  const waited = [];
  return { waited, waitUntil: (p) => waited.push(p) };
}

function postRequest(body) {
  return new Request('https://worker.example/api/proxy-request', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── DoD#7 — isAllowed unit ──────────────────────────────────────────────────

describe('isAllowed', () => {
  test('explicit allow-listed hosts', () => {
    expect(isAllowed('https://releases.obsidian.md/x')).toBe(true);
    expect(isAllowed('https://raw.githubusercontent.com/x')).toBe(true);
    expect(isAllowed('https://api.github.com/x')).toBe(true);
    expect(isAllowed('https://github.com/x')).toBe(true);
    expect(isAllowed('https://forum.obsidian.md/x')).toBe(true);
    expect(isAllowed('https://obsidian.md/x')).toBe(true);
    expect(isAllowed('https://templater-unsplash-2.fly.dev/x')).toBe(true);
  });

  test('subdomains of allowed roots', () => {
    expect(isAllowed('https://publish.obsidian.md/x')).toBe(true);
    expect(isAllowed('https://api.github.com/x')).toBe(true);
    expect(isAllowed('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isAllowed('https://release-assets.githubusercontent.com/x')).toBe(true);
  });

  test('disallowed hosts', () => {
    expect(isAllowed('https://evil.com/x')).toBe(false);
    expect(isAllowed('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowed('http://localhost/x')).toBe(false);
    expect(isAllowed('http://127.0.0.1/x')).toBe(false);
    // not a real subdomain — githubusercontent.com.evil.com would fail too,
    // but check the more common trap: host that merely *contains* the string.
    expect(isAllowed('https://raw.githubusercontent.com.evil.com/x')).toBe(false);
  });

  test('malformed URL → false, not a throw', () => {
    expect(isAllowed('not a url')).toBe(false);
    expect(isAllowed('')).toBe(false);
  });
});

// ── DoD#5 — base64 round-trip binary-safe ───────────────────────────────────

describe('bytesToB64 / b64ToBytes', () => {
  test('round-trips small random binary content', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i; // 0x00..0xFF, all byte values
    const b64 = bytesToB64(bytes.buffer);
    const back = b64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  test('round-trips large buffer (chunked path, > 0x8000 bytes)', () => {
    const SIZE = 200 * 1024; // exceeds CHUNK (0x8000 = 32768)
    const bytes = new Uint8Array(SIZE);
    for (let i = 0; i < SIZE; i++) bytes[i] = (i * 7) % 256;
    const b64 = bytesToB64(bytes.buffer);
    const back = b64ToBytes(b64);
    expect(back.length).toBe(SIZE);
    for (let i = 0; i < SIZE; i += 997) {
      expect(back[i]).toBe(bytes[i]);
    }
  });

  test('empty buffer', () => {
    expect(bytesToB64(new ArrayBuffer(0))).toBe('');
    expect(b64ToBytes('').length).toBe(0);
  });
});

// ── DoD#1 — manifest fetch through handleProxy (real network) ──────────────

describe('handleProxy — real network', () => {
  test('DoD#1: raw.githubusercontent.com manifest → 200, base64 body decodes to JSON', async () => {
    const req = postRequest({
      url: 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json',
      method: 'GET',
    });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.status).toBe(200);
    expect(typeof payload.body).toBe('string');
    const decoded = new TextDecoder().decode(b64ToBytes(payload.body));
    const parsed = JSON.parse(decoded);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  }, 20000);

  test('DoD#2: release-asset (302 → githubusercontent CDN) is followed', async () => {
    const req = postRequest({
      url: 'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.4.16/obsidian-1.4.16.asar.gz',
      method: 'GET',
    });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(200);
    const payload = await res.json();
    // Followed the redirect to release-assets.githubusercontent.com (or
    // similar CDN host) and got the actual asset back, not the 302 itself.
    expect(payload.status).toBe(200);
    expect(typeof payload.body).toBe('string');
    expect(payload.body.length).toBeGreaterThan(0);
  }, 20000);

  test('DoD#3: SSRF — disallowed host → 403', async () => {
    const req = postRequest({ url: 'https://evil.com/steal', method: 'GET' });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(403);
  });

  test('DoD#3: SSRF — 169.254.169.254 (cloud metadata) → 403', async () => {
    const req = postRequest({ url: 'http://169.254.169.254/latest/meta-data/', method: 'GET' });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(403);
  });

  test('DoD#3: SSRF — localhost → 403', async () => {
    const req = postRequest({ url: 'http://localhost:8080/', method: 'GET' });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(403);
  });

  test('DoD#3: SSRF — real allow-listed host redirecting off-list stays 502-safe (sanity)', async () => {
    // Sanity check with real GitHub infra: an allow-listed URL that redirects
    // within the allow-list (release CDN) must NOT be spuriously blocked.
    // The actual "redirect lands on a disallowed/internal host → 502" branch
    // is exercised deterministically below (real GitHub won't redirect us to
    // 169.254.169.254 on demand), by stubbing only the transport (fetch)
    // while running the real handleProxy/isAllowed redirect-chain logic.
    const req = postRequest({
      url: 'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.4.16/obsidian-1.4.16.asar.gz',
      method: 'GET',
    });
    const res = await handleProxy(req, makeCtx());
    const payload = await res.json();
    expect(payload.status).not.toBe(502);
  }, 20000);

  test('DoD#3: SSRF — redirect chain landing on internal host → 502 blocked, not followed', async () => {
    // github.com is allow-listed, so the initial request passes isAllowed();
    // stub the transport to return a 302 pointing at the AWS/GCP metadata
    // endpoint, exactly as a compromised/malicious upstream could attempt.
    // handleProxy must re-check isAllowed() on the redirect target and
    // refuse to follow it (502), never leaking the request to 169.254.169.254.
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async (_url, _opts) => {
      fetchCalls++;
      return new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      });
    };
    try {
      const req = postRequest({ url: 'https://github.com/some/redirecting-path', method: 'GET' });
      const res = await handleProxy(req, makeCtx());
      const payload = await res.json();
      expect(payload.error).toBe('redirect to disallowed host blocked');
      expect(res.status).toBe(502);
      expect(fetchCalls).toBe(1); // never followed the redirect with a second fetch
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('missing url → 400', async () => {
    const req = postRequest({ method: 'GET' });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(400);
  });

  test('invalid JSON body → 400', async () => {
    const req = new Request('https://worker.example/api/proxy-request', {
      method: 'POST',
      body: 'not json',
    });
    const res = await handleProxy(req, makeCtx());
    expect(res.status).toBe(400);
  });
});
