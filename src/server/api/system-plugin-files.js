/**
 * System plugin distribution API — for OPFS (local) vaults.
 *
 * Server vaults get system plugins overlaid live over /api/fs (see
 * ../system-plugins.js + api/fs.js — tryGetSystemFilePath, mergeCommunityList).
 * OPFS vaults never touch /api/fs, so the client-side boot instead seeds
 * them once from these two endpoints (see client-mobile/boot.js
 * seedSystemPlugins()):
 *
 *   GET /api/system-plugins               → manifest: ids + files + version
 *   GET /api/system-plugin-file?id=&file= → raw bytes of one plugin file
 *
 * The file endpoint reuses tryGetSystemFilePath — the same traversal-safe
 * resolver the /api/fs overlay already relies on — so an unknown id or a
 * `..` segment simply resolves to null → 404, with no separate guard logic
 * to keep in sync.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const {
  getSystemPluginIds,
  getSystemPluginDir,
  tryGetSystemFilePath,
} = require('../system-plugins');

const MIME_BY_EXT = {
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css',
};

function createSystemPluginFilesRouter() {
  const router = express.Router();

  // Manifest: for each known system plugin, its version (from manifest.json)
  // and the list of files actually present in its directory on disk.
  router.get('/system-plugins', (req, res) => {
    const plugins = getSystemPluginIds().map((id) => {
      const dir = getSystemPluginDir(id);
      let version = '0.0.0';
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        if (manifest && typeof manifest.version === 'string') version = manifest.version;
      } catch (_) { /* keep fallback version */ }

      let files = [];
      try {
        files = fs.readdirSync(dir).filter((name) => {
          try {
            return fs.statSync(path.join(dir, name)).isFile();
          } catch (_) {
            return false;
          }
        });
      } catch (_) { /* dir vanished mid-request: empty file list */ }

      return { id, version, files };
    });
    res.json({ plugins });
  });

  // Raw file bytes for one system plugin file.
  router.get('/system-plugin-file', (req, res) => {
    const id = req.query.id;
    const file = req.query.file;
    if (typeof id !== 'string' || typeof file !== 'string' || !id || !file) {
      return res.status(400).json({ error: 'id and file query params required' });
    }

    const relPath = '.obsidian/plugins/' + id + '/' + file;
    const absPath = tryGetSystemFilePath(relPath);
    if (!absPath) {
      return res.status(404).json({ error: 'not found' });
    }

    res.type(MIME_BY_EXT[path.extname(absPath)] || 'application/octet-stream');
    res.sendFile(absPath);
  });

  return router;
}

module.exports = createSystemPluginFilesRouter;
