/**
 * local-vault-registry.js
 *
 * Browser-side registry of "local" vaults (OPFS-backed, no server round-trip)
 * — as opposed to "server" vaults which live in the server's registry and
 * are served over /api/fs. Backed by localStorage so it persists across
 * reloads without any server involvement.
 *
 * Lives in `client/` (not `client-mobile/`) because both the desktop
 * starter page and the mobile runtime need it — loaded via a <script> tag
 * in each.
 *
 * See docs/plans/local-vaults-implementation.md → Phase 2a,
 * docs/plans/opfs-wire.md → §4 Commit 0.
 */
(function () {
  'use strict';

  var KEY = 'obsidian-web:local-vaults';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function save(map) {
    localStorage.setItem(KEY, JSON.stringify(map));
  }

  function uuid() {
    var arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  window.__owLocalVaults = {
    list: function () {
      var map = load();
      return Object.entries(map)
        .map(function (entry) { return { id: entry[0], name: entry[1].name, createdAt: entry[1].createdAt }; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; });
    },
    get: function (id) {
      var map = load();
      return map[id] || null;
    },
    has: function (id) {
      return !!this.get(id);
    },
    create: function (name) {
      var map = load();
      var id = uuid();
      map[id] = { name: name || 'Untitled', createdAt: Date.now() };
      save(map);
      return { id: id, name: map[id].name };
    },
    rename: function (id, name) {
      var map = load();
      if (!map[id]) return false;
      map[id].name = name;
      save(map);
      return true;
    },
    remove: function (id) {
      var map = load();
      if (!map[id]) return false;
      delete map[id];
      save(map);
      // Note: caller is responsible for deleting OPFS content too — this
      // milestone only clears the registry entry (see brief §9 Q2).
      return true;
    },
  };
})();
