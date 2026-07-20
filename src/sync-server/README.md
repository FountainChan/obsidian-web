# sync-server

Lean pull-sync server for obsidian-web: serves a vault directory over `/sync/v1`
so an OPFS-backed client can pull it (content-hash based, not mtime — the
hash is deterministic from file content, so the server never has to reconcile
mtimes across devices/filesystems).

Separate package from `src/runtime-server/server` — this app is
static/serverless by default, and this server is an *optional* thing you run
yourself, pointed at a vault folder you want to sync from. It is **not** the
same as the `/api/fs` server used by the "server vault" mode.

**v1 scope: pull, read-only.** A client can list the vault (`manifest`) and
fetch file contents (`blob`). There is no push, no realtime, no encryption —
see "v2 (not implemented)" below.

## Running

```bash
cd src/sync-server
bun install
SYNC_TOKEN=<a long random secret> VAULT_PATH=/path/to/your/vault bun index.js
```

Both `SYNC_TOKEN` and `VAULT_PATH` are **required** — the server refuses to
start without them (fail-closed), rather than starting in a broken or
insecure state.

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `SYNC_TOKEN` | yes | — | Bearer token clients must present. Server exits at boot if unset. |
| `VAULT_PATH` | yes | — | Absolute path to the vault directory to serve. |
| `PORT` | no | `4000` | TCP port to listen on. |
| `HOST` | no | `127.0.0.1` | Interface to bind. See **security** below. |
| `SYNC_CORS_ORIGIN` | no | `*` | `Access-Control-Allow-Origin` value. See **CORS** below. |

## ⚠️ Security — read this before exposing the server to a network

`sync-server` is meant to be reachable from another device (that's the
point — it's how a second device pulls your vault), but the **recommended**
way to reach it is a tunnel terminating on localhost, not binding the
process directly to all interfaces. `HOST` therefore **defaults to
`127.0.0.1`** (localhost-only bind):

- Expose it with a tunnel: [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
  (`cloudflared tunnel --url http://127.0.0.1:4000`), `ssh -R 4000:127.0.0.1:4000 user@relay-host`,
  or [Tailscale](https://tailscale.com/) — all of these reach a server
  bound to `127.0.0.1` without ever putting the raw port on a public
  interface.
- If you really want to bind all interfaces directly (e.g. a trusted LAN,
  no tunnel available), set `HOST=0.0.0.0`. In that mode the **only** thing
  standing between an attacker and your vault is `SYNC_TOKEN` — use a long,
  random one (e.g. `openssl rand -hex 32`). The server prints a warning at
  boot when it binds `0.0.0.0`.
- The server does not terminate TLS. A tunnel (cloudflared) or reverse proxy
  (Caddy, nginx, ...) in front of it gets you HTTPS — otherwise the Bearer
  token travels in plaintext.
- Auth is checked **before** any filesystem access, using a fixed-length
  (sha256 digest) constant-time comparison (`crypto.timingSafeEqual`) — a
  request with no/wrong token costs the server O(1) work (no directory walk,
  no hashing, no file open). This is the v1 defense against being flooded
  with bad requests; there's no per-IP rate limiting/backoff yet (v2).

## CORS — cross-origin clients

A browser client running on a different origin than `sync-server` (e.g. the
obsidian-web app on `https://obsidian-online.pages.dev` pulling from a
sync-server exposed through your own tunnel) needs CORS headers, and the
browser sends an `OPTIONS` preflight *without* `Authorization` before the
real request. `sync-server` handles this **before** auth, and it stays O(1)
(no filesystem access) so the DDoS posture is unchanged — flooding `OPTIONS`
costs the server the same ~nothing as flooding it with a wrong token does.

- `Access-Control-Allow-Origin` defaults to `*`. This is safe here: the
  client authenticates with an `Authorization: Bearer <token>` header, never
  `credentials: 'include'` cookies, so there is no credential-leak risk in
  reflecting `*`.
- To restrict it, set `SYNC_CORS_ORIGIN` to one or more comma-separated
  exact origins, e.g. `SYNC_CORS_ORIGIN=https://obsidian-online.pages.dev`.
  A request from an origin not on the list still gets a
  (non-matching) `Access-Control-Allow-Origin` value back — the browser is
  what enforces the mismatch and blocks the response, not the server.
- `Access-Control-Allow-Methods` is `GET, OPTIONS` only — v1 is pull-only,
  there's no cross-origin `PUT` (the v2 push stub is unaffected; it still
  requires a same-origin `Authorization` header today).

## API — `/sync/v1`

All routes below require `Authorization: Bearer <SYNC_TOKEN>`. Missing or
wrong token → `401` (empty body).

### `GET /sync/v1/manifest`

Recursively lists every file in `VAULT_PATH` (all file types, including
`.obsidian/` — v1 does not filter anything; see "Open questions" in the
brief for why).

```json
{
  "cursor": "<sha256 of the sorted entry list — changes iff any file changed>",
  "entries": [
    { "path": "notes/todo.md", "size": 1234, "hash": "<sha256 hex>" }
  ]
}
```

- `path` is `/`-separated and relative to `VAULT_PATH`.
- `hash` is the sha256 of the file's content — hashes are cached by
  `(mtime, size)`, so an unchanged file is not re-hashed on the next
  manifest build.
- The response carries `ETag: "<cursor>"`. Send `If-None-Match: "<cursor>"`
  to get a `304` instead of the full body if nothing changed. Note this only
  saves **bandwidth** — the server still has to walk the vault to know
  whether anything changed (skipping the walk itself needs a persisted
  cursor + change-log, which is v2).

### `GET /sync/v1/blob/:hash`

Streams the raw bytes of whichever file has that sha256 content hash
(content-addressed — files with identical content share one blob). Response
carries `Cache-Control: public, max-age=31536000, immutable` (a given hash's
content can never change, so clients/proxies can cache it forever).

- Unknown or malformed hash → `404`.
- If the hash isn't in the current index (e.g. a file was added after the
  last manifest scan), the server rescans once and retries before returning
  `404`.

## v2 (not implemented — stubs return `501`)

`GET /sync/v1/changes` (cursor-delta), `GET /sync/v1/live` (WebSocket
realtime), `POST /sync/v1/commit` (push), `PUT /sync/v1/blob/:hash` (push a
new blob), `/sync/v1/deletions` (tombstones). These exist as routed stubs so
a client gets a clear `501` describing the endpoint, not a bare `404`.

## Tests

```bash
cd src/sync-server
bun test
```
