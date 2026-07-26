// Local, in-process stand-in for the GitHub API endpoints scripts/install-plugin.js
// calls (release metadata, asset downloads, license lookup) — demo-and-docs-truth
// §3.8ג: "a test that fails without network protects nothing", de-networking the
// cloudflare package's real-GitHub-dependent tests.
//
// scripts/install-plugin.js reads its API base from OW_GITHUB_API_BASE (falls back
// to the real `https://api.github.com/repos` when unset — production behavior is
// unchanged). Point it at this server's `baseUrl` instead to run a full install
// (release lookup + main.js/manifest.json/LICENSE download) with zero real network.
//
// Not a GitHub emulator — just enough surface for installPlugin()'s calls:
//   GET /repos/:owner/:repo/releases/latest        → release JSON
//   GET /repos/:owner/:repo/releases/tags/:tag     → release JSON, or 404 for an
//                                                     unrecognized tag (lets tests
//                                                     exercise the "pinned version
//                                                     doesn't exist" failure path)
//   GET /repos/:owner/:repo/license                → license JSON (always present —
//                                                     tests that need a missing
//                                                     license use their own smaller
//                                                     mock, see install-plugin.test.js)
//   GET /download/:owner/:repo/:file               → asset bytes

import http from 'http';

const KNOWN_BAD_TAGS = new Set(['99.99.99-does-not-exist', 'v99.99.99-does-not-exist']);

function releasePayload(rootUrl, owner, repoName, tag) {
  return JSON.stringify({
    tag_name: tag,
    assets: [
      { name: 'main.js', browser_download_url: `${rootUrl}/download/${owner}/${repoName}/main.js`, size: 32 },
      { name: 'manifest.json', browser_download_url: `${rootUrl}/download/${owner}/${repoName}/manifest.json`, size: 64 },
    ],
  });
}

export function startMockGithubServer() {
  return new Promise((resolve) => {
    let rootUrl;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean);

      if (parts[0] === 'repos' && parts[3] === 'releases') {
        const [, owner, repoName, , kind, rawTag] = parts;
        if (kind === 'latest') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(releasePayload(rootUrl, owner, repoName, 'v0.0.0-mock'));
          return;
        }
        if (kind === 'tags') {
          const tag = decodeURIComponent(rawTag || '');
          if (KNOWN_BAD_TAGS.has(tag)) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ message: 'Not Found' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(releasePayload(rootUrl, owner, repoName, tag.startsWith('v') ? tag : `v${tag}`));
          return;
        }
      }

      if (parts[0] === 'repos' && parts[3] === 'license') {
        const content = Buffer.from('MIT License\n\nCopyright (c) mock\n').toString('base64');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ path: 'LICENSE', content, encoding: 'base64' }));
        return;
      }

      if (parts[0] === 'download') {
        const file = parts[parts.length - 1];
        const repoName = parts[2];
        if (file === 'main.js') {
          res.writeHead(200, { 'content-type': 'text/javascript' });
          res.end(`// mock plugin main.js for ${repoName}\n`);
          return;
        }
        if (file === 'manifest.json') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: repoName, version: '0.0.0-mock' }));
          return;
        }
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('mock-github-server: no route for ' + req.url);
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      rootUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl: `${rootUrl}/repos`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
