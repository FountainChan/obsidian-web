/**
 * boot.js — mobile client
 *
 * מקביל ל-client/boot.js של הddesktop:
 *  1. בחירת vault + localStorage
 *  2. חישוב Platform overrides (לפני שה-bundle רץ)
 *  3. הגדרת window.require לפלאגינים
 *  4. async: אימות vault → הזרקה דינמית של scripts → הסרת ספינר
 *
 * הפריסה (mobile/desktop) נקבעת ב-build-time patches על
 * obsidian-mobile/app.js — ראה scripts/patch-obsidian-mobile.js.
 * כאן רק קובעים את ה-overrides שה-IIFE של הbundle יקרא.
 */

// רשימת הscripts של Obsidian Mobile — מוזרקים דינמית אחרי האימות.
// הlib חייבים לפני app.js (globals שנקראים ב-module level).
const MOBILE_SCRIPTS = [
  '/obsidian-mobile/lib/codemirror/codemirror.js',
  '/obsidian-mobile/lib/codemirror/overlay.js',
  '/obsidian-mobile/lib/codemirror/markdown.js',
  '/obsidian-mobile/lib/codemirror/cm-addons.js',
  '/obsidian-mobile/lib/codemirror/vim.js',
  '/obsidian-mobile/lib/codemirror/meta.min.js',
  '/obsidian-mobile/lib/moment.min.js',
  '/obsidian-mobile/lib/pixi.min.js',
  '/obsidian-mobile/lib/i18next.min.js',
  '/obsidian-mobile/lib/scrypt.js',
  '/obsidian-mobile/lib/turndown.js',
  '/obsidian-mobile/enhance.js',
  '/obsidian-mobile/i18n.js',
  '/obsidian-mobile/app.js',
];

(function () {
  'use strict';

  if (typeof global === 'undefined') window.global = window;

  // ── Vault selection ────────────────────────────────────────────────────────
  var params  = new URLSearchParams(location.search);
  var VAULT_ID = params.get('vault') || localStorage.getItem('obsidian-web:lastVaultId') || '';

  // ── מסך-פתיחה נייטיב — helpers (opfs-ux) ───────────────────────────────────
  // הנייטיב (`.mobile-vault-chooser-screen`) שומר בחירת-vault תחת
  // 'mobile-selected-vault'. אנחנו כותבים לשם ערכים בצורה '<id>/<name>'
  // (executor spike: docs/plans/opfs-ux.md §3ה — הפורמט האמיתי ש-Obsidian
  // מצפה לו ב-Lte הוא מערך של path-strings גולמיים, לא אובייקטים {name,
  // location,storageType} כפי שהבריף המקורי הניח; ve()/basename מחלץ את השם
  // מהמחרוזת עצמה — לכן 'id/name' נותן גם id-חילוץ נקי וגם שם קריא).
  // owNativeVaultIdFromValue מחלץ את ה-id ומאמת מול registry מקומי
  // (local/folder) או ow-known-vault-ids (גם server) — למניעת loop על ערך יתום.
  function owNativeVaultIdFromValue(value) {
    if (!value) return null;
    var slash = value.indexOf('/');
    var id = slash !== -1 ? value.slice(0, slash) : value;
    if (window.__owLocalVaults && window.__owLocalVaults.get(id)) return id;
    var known = [];
    try { known = JSON.parse(localStorage.getItem('ow-known-vault-ids') || '[]'); } catch (e) {}
    if (known.indexOf(id) !== -1) return id;
    return null;
  }

  // מסך-הפתיחה הנייטיב שומר את בחירת המשתמש תחת 'mobile-selected-vault' —
  // אימות מול registry/known-ids (פער 1 + finding 2 R1/R2) לפני שמשתמשים בו
  // כ-VAULT_ID, כדי לא ליפול ל-loop כש-sel יתום (stale/מוסר).
  if (!VAULT_ID) {
    var sel = localStorage.getItem('mobile-selected-vault') || '';
    var selId = owNativeVaultIdFromValue(sel);
    if (selId) VAULT_ID = selId;
  }

  // Vault type: 'local' (OPFS, no server round-trip), 'folder' (real
  // directory picked via showDirectoryPicker, also OPFS-store-backed — see
  // capacitor-shim's fsBackend), or 'server' (HTTP /api/fs). Determined by
  // the browser-side local vault registry's `type` field (window.__owLocalVaults,
  // loaded synchronously via <script> before boot.js — see index.html loading
  // order). No entry in the registry → 'server' (unchanged from before).
  var __owV = window.__owLocalVaults && window.__owLocalVaults.get(VAULT_ID);
  var VAULT_TYPE = __owV ? (__owV.type || 'local') : 'server';   // 'folder' | 'local' | 'server'
  window.__owVaultType = VAULT_TYPE;
  window.__owVaultId   = VAULT_ID;
  console.log('[obsidian-web] vault type:', VAULT_TYPE, 'id:', VAULT_ID);

  // (הוסר guard-הפניה ל-/starter כש-VAULT_ID ריק — brief §3א: no-vault
  // מזריק עכשיו את מסך-הפתיחה הנייטיב במקום redirect. /starter עדיין מטופל
  // בהמשך, אחרי setup ה-shims — ראה guard #2 למטה.)

  if (VAULT_ID) {
    localStorage.setItem('obsidian-web:lastVaultId', VAULT_ID);
    localStorage.setItem('mobile-selected-vault', VAULT_ID);
    localStorage.setItem('enable-plugin-' + VAULT_ID, 'true');
  }

  // ── Platform overrides — applied BEFORE app.js loads ──────────────────────
  // הbundle עבר 3 patches (ראה scripts/patch-obsidian-mobile.js) שגורמים
  // ל-IIFE שלו למזג את האובייקט הזה לתוך דגלי ה-Platform עם Object.assign,
  // אחרי ברירות המחדל. מה שמוגדר כאן מנצח.
  //
  // המצב נשמר ב-localStorage תחת המפתח 'obsidian-web:layout-mode'.
  function computeLayoutMode() {
    var pref = localStorage.getItem('obsidian-web:layout-mode') || 'auto';
    if (pref === 'mobile')  return { isMobile: true,  reason: 'user-pref-mobile' };
    if (pref === 'desktop') return { isMobile: false, reason: 'user-pref-desktop' };
    // 'auto' — viewport-based decision
    var small = window.innerWidth < 900 || window.innerHeight < 600;
    return { isMobile: small, reason: 'auto-' + (small ? 'mobile' : 'desktop') };
  }
  var layout = computeLayoutMode();
  window.__owPlatformOverrides = { isMobile: layout.isMobile };
  console.log('[obsidian-web] platform overrides:', layout);

  // ── window.require לפלאגינים ───────────────────────────────────────────────
  var modules = {
    'path':          window.__owPath,
    'url':           window.__owUrl,
    'os':            window.__owOs,
    'btime':         window.__owBtime,
    'crypto':        makeCryptoShim(),
    'node:crypto':   makeCryptoShim(),
    'util':          makeUtilShim(),
    'node:util':     makeUtilShim(),
    'buffer':        { Buffer: window.Buffer },
    'process':       window.process,
    'child_process': makeChildProcessStub(),
  };

  function makeChildProcessStub() {
    var ERR = new Error('[obsidian-web] child_process not available in web mode');
    function noop() {}
    function fakeProc() {
      return { stdout:{on:noop,pipe:noop}, stderr:{on:noop,pipe:noop},
               stdin:{write:noop,end:noop}, on:noop, once:noop, kill:noop, pid:0 };
    }
    return {
      exec: function(cmd,opts,cb){ if(typeof opts==='function')cb=opts; if(typeof cb==='function')setTimeout(function(){cb(ERR,'','')},0); return fakeProc(); },
      execSync: function(){ throw ERR; },
      spawn: function(){ return fakeProc(); },
      spawnSync: function(){ return {stdout:'',stderr:'',status:1,error:ERR}; },
      execFile: function(f,a,opts,cb){ if(typeof opts==='function')cb=opts; if(typeof cb==='function')setTimeout(function(){cb(ERR,'','')},0); return fakeProc(); },
      fork: function(){ return fakeProc(); },
    };
  }

  function makeUtilShim() {
    return {
      promisify: function(fn){ return function(){ var args=[].slice.call(arguments); return new Promise(function(res,rej){ args.push(function(e,v){e?rej(e):res(v);}); fn.apply(this,args); }); }; },
      callbackify: function(fn){ return function(){ var args=[].slice.call(arguments), cb=args.pop(); fn.apply(this,args).then(function(v){cb(null,v);},function(e){cb(e);}); }; },
      inspect: function(o){ try{return JSON.stringify(o);}catch(_){return String(o);} },
      inherits: function(ctor,sup){ ctor.super_=sup; Object.setPrototypeOf(ctor.prototype,sup.prototype); },
    };
  }

  function makeCryptoShim() {
    // Mirror of client/boot.js makeCryptoShim — keeps desktop and mobile
    // runtimes in sync. WebCrypto's subtle.digest is async-only; we expose
    // a callback-based async path on .digest() and a sync path that warns
    // and returns empty. Algo names mapped from Node to WebCrypto.
    return {
      randomBytes: function(n) {
        var arr = new Uint8Array(n);
        crypto.getRandomValues(arr);
        arr.toString = function(enc) {
          if (enc==='hex') { var s=''; for(var i=0;i<this.length;i++) s+=this[i].toString(16).padStart(2,'0'); return s; }
          return Uint8Array.prototype.toString.call(this);
        };
        return arr;
      },
      createHash: function(algo) {
        // Map Node algo names to WebCrypto names. md5 falls back to SHA-256
        // (browsers don't ship MD5); callers that need real MD5 must bundle
        // their own (e.g. spark-md5, as LiveSync already does).
        var algoMap = { sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512', md5: 'SHA-256' };
        var subtleAlgo = algoMap[(algo || '').toLowerCase()] || 'SHA-256';
        var chunks = [];
        var hash = {
          update: function(d){ chunks.push(typeof d==='string'?new TextEncoder().encode(d):d); return hash; },
          digest: function(encoding, cb){
            if (typeof encoding === 'function') { cb = encoding; encoding = 'hex'; }
            // Async path — caller provided a callback.
            if (typeof cb === 'function') {
              var totalLen = 0;
              for (var k = 0; k < chunks.length; k++) totalLen += chunks[k].length;
              var combined = new Uint8Array(totalLen);
              var off = 0;
              for (var j = 0; j < chunks.length; j++) { combined.set(chunks[j], off); off += chunks[j].length; }
              crypto.subtle.digest(subtleAlgo, combined).then(function(buf){
                var bytes = new Uint8Array(buf);
                if (encoding === 'hex') {
                  var s = '';
                  for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
                  cb(null, s);
                } else {
                  cb(null, bytes);
                }
              }).catch(function(err){ cb(err); });
              return hash;
            }
            // Sync path: WebCrypto cannot hash synchronously. Warn so we can
            // spot if something actually relies on it.
            console.warn('[obsidian-web] crypto.createHash(' + algo + ').digest() called synchronously — returning empty. If this causes issues, wrap the caller to use the async (callback) path.');
            return encoding === 'hex' ? '' : new Uint8Array(0);
          },
        };
        return hash;
      },
    };
  }

  var missing = (function(){
    var hits = {};
    return {
      record: function(n){ hits[n]=(hits[n]||0)+1; },
      summary: function(){ console.table(Object.entries(hits).map(function(e){return{module:e[0],count:e[1]};})); },
    };
  })();

  window.require = function(name) {
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
    missing.record(name);
    return undefined;
  };
  window.__owMissing = missing;

  window.process = window.process || {
    platform: 'linux', arch: 'x64',
    versions: { node: '0.0.0' }, env: {},
    cwd: function(){ return '/'; },
    nextTick: function(fn){ return Promise.resolve().then(fn); },
  };

  if (!window.Buffer) {
    window.Buffer = {
      from: function(data, enc) {
        if (typeof data==='string') {
          if (enc==='base64') { var b=atob(data),a=new Uint8Array(b.length); for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i); return a; }
          return new TextEncoder().encode(data);
        }
        return new Uint8Array(data);
      },
      isBuffer: function(x){ return x instanceof Uint8Array; },
      alloc: function(n){ return new Uint8Array(n); },
    };
  }

  console.log('[obsidian-web] mobile boot: require + shims installed, vault=' + VAULT_ID);

  // ── אימות vault + הזרקה דינמית של scripts ─────────────────────────────────
  if (location.pathname === '/starter') return;   // ל-/starter דף משלו

  var statusEl = document.getElementById('ow-status');
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  // הזרקה דינמית — browser מוריד במקביל, מריץ לפי סדר (async=false).
  // חולצה מ-for-loop inline (היה כאן במקור) לפונקציה נגישה גם לזרימת
  // ה-no-vault (מסך-הפתיחה הנייטיב, למטה) וגם לזרימת ה-VAULT_ID הרגילה.
  function injectMobileScripts() {
    var loaded = 0;
    for (var i = 0; i < MOBILE_SCRIPTS.length; i++) {
      (function (src) {
        var s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = function () {
          loaded++;
          setStatus('Loading Obsidian mobile (' + loaded + '/' + MOBILE_SCRIPTS.length + ')');
        };
        s.onerror = function () {
          console.error('[obsidian-web] failed to load: ' + src);
          setStatus('Error loading ' + src.split('/').pop());
        };
        document.head.appendChild(s);
      })(MOBILE_SCRIPTS[i]);
    }
  }

  // הסרת ספינר (#ow-loading) כש-selector מתרנדר — משותף לשתי הזרימות: זרימת
  // VAULT_ID רגילה ממתינה ל-.workspace; זרימת ה-no-vault (למטה) ממתינה למסך
  // הנייטיב עצמו (.mobile-vault-chooser-screen או .mobile-onboarding — ראה
  // executor spike: ל-Obsidian יש 2 מסכי-כניסה אפשריים, תלוי אם כבר יש
  // vault אחד לפחות ב-Lte/readdir; שניהם תקפים "מסך-פתיחה נייטיב מרונדר").
  // בלי זה — הספינר נשאר תקוע מעל המסך הנייטיב (regression שנתפס ב-spike).
  function removeLoadingOverlayWhen(selector) {
    var overlay = document.getElementById('ow-loading');
    if (!overlay) return;
    if (document.querySelector(selector)) { overlay.remove(); return; }
    var obs = new MutationObserver(function () {
      if (document.querySelector(selector)) {
        overlay.remove();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ── מסך-פתיחה נייטיב (no-vault) — seed רשימת ה-vaults ──────────────────────
  // מאכלס mobile-external-vaults (Lte של הנייטיב) + ow-known-vault-ids
  // (משמש גם ע"י owNativeVaultIdFromValue וגם ע"י capacitor-shim's stat()
  // polyfill). /api/vaults/list מחזיר object map keyed-by-id (לא array —
  // finding 3 אביגיל) — Object.keys ולא array-iteration.
  // כל item בפורמט '<id>/<name>' — ראה הערת owNativeVaultIdFromValue למעלה.
  function seedNativeVaultList() {
    var localList = window.__owLocalVaults ? window.__owLocalVaults.list() : [];
    var items = localList.map(function (v) { return v.id + '/' + v.name; });
    var ids = localList.map(function (v) { return v.id; });
    return fetch('/api/vaults/list')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        Object.keys(res || {}).forEach(function (id) {
          var v = res[id] || {};
          var name = (v.path || id).split('/').pop();
          items.push(id + '/' + name);
          ids.push(id);
        });
      })
      .catch(function () { /* server vaults לא זמינים — ממשיכים עם local/folder בלבד */ })
      .then(function () {
        localStorage.setItem('mobile-external-vaults', JSON.stringify(items));
        localStorage.setItem('ow-known-vault-ids', JSON.stringify(ids));
      });
  }

  // ── מסך-פתיחה נייטיב (no-vault) — גישור בחירת/פתיחת-vault ──────────────────
  // executor spike (docs/plans/opfs-ux.md §3ד/§3ה, finding 4 אביגיל):
  // register() הנייטיב (הפונקציה שרצה אחרי "Open folder as vault"/לחיצה על
  // "Open vault" בשורת vault קיים/auto-resume בעלייה) פותח vault ישירות
  // בזיכרון (window.app=new ete(...)) בלי reload — עוקף לגמרי את זרימת
  // ה-VAULT_ID/boot.js שלנו. נקודת-העיגון האמינה היחידה: register תמיד כותב
  // ל-localStorage['mobile-selected-vault'] רגע לפני הפתיחה הישירה. מיירטים
  // את הכתיבה הזו (monkey-patch ל-localStorage.setItem, מותקן רק בזרימת
  // no-vault) ומנווטים בעצמנו ל-/mobile?vault=<id> — כך זרימת ה-boot.js
  // הרגילה (OPFS/folder/server, seed system plugins וכו') רצה כרגיל.
  function installNativeVaultOpenBridge() {
    if (window.__owNativeVaultBridgeInstalled) return;
    window.__owNativeVaultBridgeInstalled = true;
    var origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      if (key === 'mobile-selected-vault') {
        var id = owNativeVaultIdFromValue(value);
        if (id) {
          location.href = '/mobile?vault=' + encodeURIComponent(id);
          return;
        }
      }
      return origSetItem(key, value);
    };
  }

  // ── מסך-פתיחה נייטיב (no-vault) ─────────────────────────────────────────────
  // אין VAULT_ID תקף (לא ב-?vault=, לא ב-lastVaultId, ולא מ-mobile-selected-
  // vault תקף — ראה למעלה). ה-shims כבר מותקנים (require/capacitor) — מזריקים
  // ישירות את ה-bundle הנייטיב; מסך ה-vault-chooser שלו (Setup Sync/Create new
  // vault/Open folder as vault + רשימה) מתרנדר מלא בלי שינוי (spike §0).
  // choose()/stat() polyfill + seedNativeVaultList() + הגישור למעלה מחווטים
  // את הרשימה + הבחירה + open-folder ל-vaults שלנו (folder-vault/OPFS/server).
  if (!VAULT_ID) {
    setStatus('Loading Obsidian mobile...');
    installNativeVaultOpenBridge();
    seedNativeVaultList()
      .catch(function (err) { console.warn('[obsidian-web] seedNativeVaultList failed:', err); })
      .then(function () {
        injectMobileScripts();
        removeLoadingOverlayWhen('.mobile-vault-chooser-screen, .mobile-onboarding');
      });
    return;
  }

  // folder vaults need a re-grant click (user gesture) whenever
  // queryPermission comes back != 'granted' (typically: every fresh reload —
  // browsers don't persist FS Access permissions across sessions outside
  // installed PWAs, brief §9 Q2/v2). Renders a button inside the existing
  // #ow-loading overlay; resolves with the requestPermission() result.
  function showGrantScreen(handle) {
    return new Promise(function (resolve) {
      var overlay = document.getElementById('ow-loading');
      setStatus('Access to "' + handle.name + '" is needed to continue.');
      var btn = document.createElement('button');
      btn.textContent = 'Grant access to ' + handle.name;
      btn.style.cssText = 'margin-top:8px;padding:8px 16px;background:#7f6df2;color:#fff;' +
        'border:none;border-radius:4px;cursor:pointer;font:13px -apple-system,BlinkMacSystemFont,sans-serif;';
      btn.onclick = async function () {
        btn.disabled = true;
        btn.textContent = 'Requesting…';
        var perm;
        try {
          perm = await handle.requestPermission({ mode: 'readwrite' });
        } catch (e) {
          perm = 'denied';
        }
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        resolve(perm);
      };
      (overlay || document.body).appendChild(btn);
    });
  }

  setStatus('Verifying vault...');

  // אמת שה-vault קיים: local → OPFS getDirectoryHandle (idempotent, אין
  // bootstrap בשרת ל-local); folder → שחזור handle מ-IndexedDB + permission
  // gate (queryPermission → showGrantScreen אם צריך); server → HTTP stat על
  // ה-root (כמו קודם).
  var verifyPromise;
  if (VAULT_TYPE === 'local') {
    verifyPromise = (async function () {
      if (!window.__owOpfsStore) throw new Error('OPFS store not loaded');
      var root = await navigator.storage.getDirectory();
      var vaults = await root.getDirectoryHandle('vaults', { create: true });
      await vaults.getDirectoryHandle(VAULT_ID, { create: true });   // idempotent
      return { isDirectory: true };
    })();
  } else if (VAULT_TYPE === 'folder') {
    verifyPromise = (async function () {
      if (!window.__owOpfsStore) throw new Error('OPFS store not loaded');
      if (!window.__owFolderHandles) throw new Error('folder handle store not loaded');
      var h = await window.__owFolderHandles.loadHandle(VAULT_ID);
      if (!h) throw new Error('folder handle missing — re-open the folder');
      var perm = await h.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await showGrantScreen(h);   // נתיב ראשי: כפתור → requestPermission (gesture)
      if (perm !== 'granted') throw new Error('Access not granted');
      window.__owFolderRoot = h;                                 // רק אחרי granted
      return { isDirectory: true };
    })();
  } else {
    verifyPromise = fetch('/api/fs/stat?vault=' + encodeURIComponent(VAULT_ID) + '&path=')
      .then(function (res) {
        if (!res.ok) throw new Error('Vault not found (HTTP ' + res.status + ')');
        return res.json();
      });
  }

  verifyPromise
    .then(async function(stat) {
      if (!stat || (!stat.isDirectory && stat.type !== 'directory')) throw new Error('Vault path is not a directory');

      // seed system plugins ל-OPFS/folder לפני טעינת Obsidian (כדי ש-
      // community-plugins.json יהיה מוכן כש-Obsidian קורא אותו) — local
      // (OPFS) ו-folder vaults (לא server, שמקבל אותם דרך overlay צד-שרת
      // קיים). לא חוסם את הפתיחה אם נכשל (retry ב-boot הבא דרך ה-version-gate).
      if ((VAULT_TYPE === 'local' || VAULT_TYPE === 'folder') && window.__owOpfsStore && window.__owSeedSystemPlugins) {
        var gr = VAULT_TYPE === 'folder' ? (async () => window.__owFolderRoot) : undefined;
        try { await window.__owSeedSystemPlugins.seedSystemPlugins(window.__owOpfsStore.makeStore(VAULT_ID, { getRoot: gr })); }
        catch (e) { console.warn('[ow] seed system plugins failed', e); }
      }

      setStatus('Loading Obsidian mobile...');
      console.log('[obsidian-web] vault ok, injecting mobile scripts');

      // ── Bootstrap fetch (parallel to script injection) — SERVER VAULTS ONLY.
      // /api/bootstrap returns the entire .obsidian/ tree + vault content
      // + dirs in one pre-compressed response. We expose it on
      // window.__owBootstrapCache so capacitor-shim's Filesystem.readFile/
      // stat/readdir can answer from cache instead of round-tripping per
      // file. watchAndStatAll awaits __owBootstrapPromise instead of
      // re-fetching. See docs/plans/mobile-bootstrap-cache.md.
      //
      // Local vaults have no server bootstrap endpoint (static-file server
      // only, per brief §2 scope boundary) — OpfsStore.watchAndStatAll
      // supplies the file tree directly from OPFS, no fetch needed. See
      // docs/plans/opfs-wire.md §4 Commit 1(ג).
      if (VAULT_TYPE === 'server') {
        var bootstrapPromise = fetch(
          '/api/bootstrap?vault=' + encodeURIComponent(VAULT_ID) + '&full=1',
          { headers: { 'Accept-Encoding': 'br, gzip' } },
        )
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (!data) return null;
            if (data.disabled) {
              console.log('[obsidian-web] bootstrap disabled by server, all FS reads will round-trip');
              window.__owBootstrapCache = null;
              return null;
            }
            window.__owBootstrapCache = data;
            var fileCount = data.fs ? Object.keys(data.fs).length : 0;
            var capped = data.capped ? ' (CAPPED: ' + data.cappedReason + ')' : '';
            console.log('[obsidian-web] bootstrap loaded: ' + fileCount + ' files cached' + capped);
            return data;
          })
          .catch(function (err) {
            console.warn('[obsidian-web] bootstrap failed:', err && err.message || err);
            window.__owBootstrapCache = null;
            return null;
          });
        window.__owBootstrapPromise = bootstrapPromise;
      }

      // הזרקה דינמית — browser מוריד במקביל, מריץ לפי סדר (async=false).
      // חולצה ל-injectMobileScripts() למעלה — נגישה גם לזרימת ה-no-vault.
      injectMobileScripts();

      // הסרת ספינר כשה-workspace מוכן
      removeLoadingOverlayWhen('.workspace');

      // ── Vault switcher click → /starter ──────────────────────────────────
      // ה-mobile bundle מציג את ה-vault profile panel רק כש-Platform.isDesktopApp
      // הוא true. ב-patch-obsidian-mobile.js שינינו את התנאי הזה ל-!isMobile כדי
      // שהפאנל יופיע גם במצב desktop-layout. אבל ה-click handler המקורי בתוך
      // הפאנל קורא ל-`electron.ipcRenderer.sendSync("vault" | "vault-list" |
      // "vault-open")` — שלא קיים ב-mobile runtime (אין shim ל-window.electron
      // ב-client-mobile/). תופסים את הקליק בשלב ה-capture, חוסמים את ה-handler
      // המקורי, ומנווטים ל-/starter שיודע לעשות את אותו דבר ועוד.
      document.addEventListener('click', function (e) {
        var target = e.target && e.target.closest && e.target.closest('.workspace-drawer-vault-switcher');
        if (!target) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        location.href = '/starter';
      }, true);
    })
    .catch(function(err) {
      console.warn('[obsidian-web] vault check failed:', err.message);
      setStatus('Error: ' + err.message);
      localStorage.removeItem('obsidian-web:lastVaultId');
      setTimeout(function(){ location.href = '/starter'; }, 2000);
    });
}());
