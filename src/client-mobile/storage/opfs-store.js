/**
 * OPFS-backed store for obsidian-web mobile runtime.
 *
 * Independent module — mirrors the async method surface + return shapes of
 * the `Filesystem` plugin in `src/client-mobile/shims/capacitor-shim.js`
 * (readFile/writeFile/mkdir/readdir/stat/rename/copy/deleteFile/
 * watchAndStatAll/…), but backs every operation with the browser's Origin
 * Private File System (OPFS) instead of the HTTP `/api/fs/*` API.
 *
 * Not wired into the app yet — that happens in slice `opfs-wire`. This
 * module is loaded + exercised standalone by `test/opfs-store.selftest.html`.
 *
 * Usage:
 *   const store = window.__owOpfsStore.makeStore('my-vault-id');
 *   await store.writeFile({ path: 'Notes/foo.md', data: 'hi', encoding: 'utf8' });
 *
 * Path convention: keys are vault-relative, `/`-separated. Root is `''` or
 * `'/'`. `writeFile`/`mkdir`/`appendFile` on a deep path auto-create missing
 * parent directories (mirrors the server's mkdir-on-write behavior — LiveSync
 * writes into empty vaults and must not fail on missing ancestors).
 *
 * CRITICAL CONTRACT — watchAndStatAll must return a FLAT list where every
 * entry's `name` is its FULL path relative to the vault root, and no entry
 * carries a `children` property. This mirrors the fix for the production bug
 * of 2026-05-12 (nested trees only populated their root level because
 * CapacitorAdapter does `for (const i of e.children) this.quickList("", i)`
 * without recursing).
 */
(function () {
  'use strict';

  // ── low-level OPFS helpers ──────────────────────────────────────────────

  async function rootDir() {
    return await navigator.storage.getDirectory();
  }

  async function vaultDir(vaultId, { create = false } = {}) {
    const root = await rootDir();
    const vaults = await root.getDirectoryHandle('vaults', { create });
    return await vaults.getDirectoryHandle(vaultId, { create });
  }

  // Walk to the parent directory handle of `relPath`, returns {parent, name}.
  // `create` applies to the vault container AND every intermediate segment —
  // i.e. create:true auto-creates the whole ancestor chain (mkdir-on-write).
  async function resolveParent(vaultId, relPath, { create = false } = {}) {
    const dir = await vaultDir(vaultId, { create });
    const parts = String(relPath).split('/').filter(Boolean);
    const name = parts.pop();
    let cur = dir;
    for (const part of parts) cur = await cur.getDirectoryHandle(part, { create });
    return { parent: cur, name };
  }

  // Walk to the directory handle AT `relPath` itself (used by readdir/stat-dir/
  // rmdir-target/copy-dir-dest). Root ('' or '/') resolves to the vault dir.
  async function resolveDir(vaultId, relPath, { create = false } = {}) {
    let cur = await vaultDir(vaultId, { create });
    const parts = String(relPath || '').split('/').filter(Boolean);
    for (const part of parts) cur = await cur.getDirectoryHandle(part, { create });
    return cur;
  }

  // 'file' | 'directory' | null (root '' / '/' is always 'directory')
  async function statKind(vaultId, relPath) {
    const normalized = String(relPath || '').replace(/^\/+|\/+$/g, '');
    if (normalized === '') return 'directory';
    try {
      const { parent, name } = await resolveParent(vaultId, normalized, { create: false });
      try {
        await parent.getFileHandle(name, { create: false });
        return 'file';
      } catch (_) {
        try {
          await parent.getDirectoryHandle(name, { create: false });
          return 'directory';
        } catch (__) {
          return null;
        }
      }
    } catch (_) {
      return null;
    }
  }

  // base64 string → ArrayBuffer — same shape as capacitor-shim:78
  function base64ToArrayBuffer(b64) {
    const bin = atob(b64 || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  // ArrayBuffer → base64 (chunked — btoa blows the arg stack at ~65k), same
  // as capacitor-shim:86.
  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let s = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function capError(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
  }

  function rethrowAsEnoent(e, message) {
    if (e && e.code) throw e; // already a capError
    throw capError('ENOENT', message);
  }

  // ── store factory ────────────────────────────────────────────────────────

  function makeStore(vaultId) {

    // low-level raw (ArrayBuffer) read/write, used internally by copy/rename
    // so they don't pay a redundant base64 round-trip.
    async function readFileRaw(relPath) {
      try {
        const { parent, name } = await resolveParent(vaultId, relPath, { create: false });
        const fh = await parent.getFileHandle(name, { create: false });
        const file = await fh.getFile();
        return await file.arrayBuffer();
      } catch (e) {
        rethrowAsEnoent(e, 'readFile: not found: ' + relPath);
      }
    }

    async function writeFileRaw(relPath, arrayBuffer) {
      const { parent, name } = await resolveParent(vaultId, relPath, { create: true });
      const fh = await parent.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      try {
        await w.write(arrayBuffer);
      } finally {
        await w.close();
      }
    }

    async function copyPath(fromPath, toPath) {
      const kind = await statKind(vaultId, fromPath);
      if (kind === null) throw capError('ENOENT', 'copy: source not found: ' + fromPath);
      if (kind === 'file') {
        const data = await readFileRaw(fromPath);
        await writeFileRaw(toPath, data);
      } else {
        await resolveDir(vaultId, toPath, { create: true }); // ensure dest dir exists
        const srcDir = await resolveDir(vaultId, fromPath, { create: false });
        for await (const [name, handle] of srcDir.entries()) {
          const childFrom = fromPath ? fromPath + '/' + name : name;
          const childTo = toPath ? toPath + '/' + name : name;
          if (handle.kind === 'directory') {
            await copyPath(childFrom, childTo);
          } else {
            const f = await handle.getFile();
            await writeFileRaw(childTo, await f.arrayBuffer());
          }
        }
      }
    }

    async function removePath(relPath) {
      const kind = await statKind(vaultId, relPath);
      if (kind === null) throw capError('ENOENT', 'remove: not found: ' + relPath);
      try {
        const { parent, name } = await resolveParent(vaultId, relPath, { create: false });
        await parent.removeEntry(name, { recursive: kind === 'directory' });
      } catch (e) {
        rethrowAsEnoent(e, 'remove failed: ' + relPath);
      }
    }

    return {

      async readFile(opts) {
        const encoding = opts.encoding; // 'utf8' | undefined (binary = base64)
        try {
          const { parent, name } = await resolveParent(vaultId, opts.path, { create: false });
          const fh = await parent.getFileHandle(name, { create: false });
          const file = await fh.getFile();
          if (encoding) {
            return { data: await file.text() };
          }
          const buf = await file.arrayBuffer();
          return { data: arrayBufferToBase64(buf) };
        } catch (e) {
          rethrowAsEnoent(e, 'readFile: not found: ' + opts.path);
        }
      },

      async writeFile(opts) {
        const encoding = opts.encoding;
        const { parent, name } = await resolveParent(vaultId, opts.path, { create: true });
        const fh = await parent.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        try {
          if (encoding) {
            await w.write(String(opts.data));
          } else {
            await w.write(base64ToArrayBuffer(opts.data));
          }
        } finally {
          await w.close();
        }
        return { uri: '' };
      },

      // appendFile: byte-exact `old ⧺ new` — this is the path LiveSync uses
      // for binary chunk writes. Creates the file (+ missing parents) if it
      // doesn't exist yet.
      async appendFile(opts) {
        const { parent, name } = await resolveParent(vaultId, opts.path, { create: true });
        let existing = new Uint8Array(0);
        let fh;
        try {
          fh = await parent.getFileHandle(name, { create: false });
          const f = await fh.getFile();
          existing = new Uint8Array(await f.arrayBuffer());
        } catch (_) {
          fh = await parent.getFileHandle(name, { create: true });
        }
        const toAppend = new Uint8Array(base64ToArrayBuffer(opts.data));
        const combined = new Uint8Array(existing.length + toAppend.length);
        combined.set(existing, 0);
        combined.set(toAppend, existing.length);
        const w = await fh.createWritable();
        try {
          await w.write(combined.buffer);
        } finally {
          await w.close();
        }
        return {};
      },

      async deleteFile(opts) {
        try {
          const { parent, name } = await resolveParent(vaultId, opts.path, { create: false });
          await parent.removeEntry(name);
        } catch (e) {
          rethrowAsEnoent(e, 'deleteFile: not found: ' + opts.path);
        }
        return {};
      },

      async mkdir(opts) {
        const dir = await vaultDir(vaultId, { create: true });
        const parts = String(opts.path).split('/').filter(Boolean);
        let cur = dir;
        const lastIdx = parts.length - 1;
        for (let i = 0; i < parts.length; i++) {
          const createFlag = !!opts.recursive || i === lastIdx;
          cur = await cur.getDirectoryHandle(parts[i], { create: createFlag });
        }
        return {};
      },

      async rmdir(opts) {
        try {
          const { parent, name } = await resolveParent(vaultId, opts.path, { create: false });
          await parent.removeEntry(name, { recursive: !!opts.recursive });
        } catch (e) {
          rethrowAsEnoent(e, 'rmdir failed: ' + opts.path);
        }
        return {};
      },

      async readdir(opts) {
        try {
          const dir = await resolveDir(vaultId, opts.path, { create: false });
          const files = [];
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'directory') {
              files.push({ name, type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' });
            } else {
              const f = await handle.getFile();
              files.push({ name, type: 'file', size: f.size, mtime: f.lastModified, ctime: f.lastModified, uri: '' });
            }
          }
          return { files };
        } catch (e) {
          rethrowAsEnoent(e, 'readdir: not found: ' + opts.path);
        }
      },

      async stat(opts) {
        const normalized = String(opts.path || '').replace(/^\/+|\/+$/g, '');
        if (normalized === '') {
          return { type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' };
        }
        try {
          const { parent, name } = await resolveParent(vaultId, normalized, { create: false });
          try {
            const fh = await parent.getFileHandle(name, { create: false });
            const f = await fh.getFile();
            return { type: 'file', size: f.size, mtime: f.lastModified, ctime: f.lastModified, uri: '' };
          } catch (_) {
            await parent.getDirectoryHandle(name, { create: false }); // throws if neither
            return { type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' };
          }
        } catch (e) {
          rethrowAsEnoent(e, 'stat: not found: ' + opts.path);
        }
      },

      // rename = copy + delete (OPFS has no atomic rename). Verify the
      // destination exists before removing the source so a failed copy
      // never loses data.
      async rename(opts) {
        const kind = await statKind(vaultId, opts.from);
        if (kind === null) throw capError('ENOENT', 'rename: source not found: ' + opts.from);
        await copyPath(opts.from, opts.to);
        const destKind = await statKind(vaultId, opts.to);
        if (destKind === null) throw capError('EIO', 'rename: copy to destination failed: ' + opts.to);
        await removePath(opts.from);
        return {};
      },

      async copy(opts) {
        await copyPath(opts.from, opts.to);
        return {};
      },

      async trash(opts) {
        // No real trash on OPFS — delegate to deleteFile (mirrors capacitor-shim).
        return this.deleteFile(opts);
      },

      async getUri(opts) {
        try {
          const { parent, name } = await resolveParent(vaultId, opts.path, { create: false });
          const fh = await parent.getFileHandle(name, { create: false });
          const file = await fh.getFile();
          return { uri: URL.createObjectURL(file) };
        } catch (e) {
          rethrowAsEnoent(e, 'getUri: not found: ' + opts.path);
        }
      },

      // No external file-system changes can happen to OPFS behind our back —
      // these are no-ops so the plugin surface still "works" when called.
      async startWatch() { return {}; },
      async stopWatch() { return {}; },
      async addListener(_eventName, _callback) {
        return { remove() {} };
      },

      async watchAndStatAll() {
        const children = [];
        async function walk(dirHandle, prefix) {
          for await (const [name, handle] of dirHandle.entries()) {
            const relPath = prefix ? prefix + '/' + name : name;
            if (handle.kind === 'directory') {
              children.push({ name: relPath, type: 'directory', size: 0, mtime: 0, ctime: 0, uri: '' });
              await walk(handle, relPath);
            } else {
              const f = await handle.getFile();
              children.push({ name: relPath, type: 'file', size: f.size, mtime: f.lastModified, ctime: f.lastModified, uri: '' });
            }
          }
        }
        const dir = await vaultDir(vaultId, { create: true });
        await walk(dir, '');
        return { children };
      },

      async setTimes() { return {}; },
      async verifyIcloud() { return {}; },
      async open() { return {}; },

      async checkPerms() { return { publicStorage: 'granted' }; },
      async requestPermissions() { return { publicStorage: 'granted' }; },
      async requestPerms() { return { publicStorage: 'granted' }; },
      async choose() { return null; },
    };
  }

  window.__owOpfsStore = { makeStore };
})();
