/**
 * platform-bridge.js — runtime interception of Obsidian's `Platform` object.
 *
 * Replaces 3 of the 4 build-time patches previously applied to
 * vendor/obsidian-mobile/app.js by scripts/patch-obsidian-mobile.js
 * (expose-platform, iife-overrides, is-mobile-class). Those patches edited
 * Obsidian's own minified source; this module achieves the same effect by
 * intercepting the native `Object.defineProperty` call webpack's export map
 * uses to wire up `Platform` (`n.d(e,{Platform:()=>bn})`), without touching
 * a single byte of app.js. See docs/plans/runtime-platform-descriptors.md
 * (§0-§3) for the full design and the live-browser spike that proved it.
 *
 * The 4th patch (vault-profile-on-desktop-layout) is NOT replaced by this
 * module — it stays a build-time patch (see scripts/patch-obsidian-mobile.js
 * and brief §1) until the vault-panel slice removes it.
 *
 * Load order (brief §3.0 — this is what makes the timing work):
 *   index.html   this script          → installs the interceptor, idle
 *   index.html   boot.js              → sets window.__owPlatformOverrides
 *                                        (sync, before anything async runs)
 *   boot.js      injectMobileScripts() → dynamically injects app.js (later,
 *                                        after vault verification)
 *   app.js       n.d(...Platform...)  → interceptor fires, reads
 *                                        __owPlatformOverrides (already set)
 *
 * Must be loaded as a classic <script> BEFORE boot.js — see index.html.
 * ES5 style throughout (var/function, no arrow functions, no
 * Object.assign/optional-chaining) to match this codebase's convention for
 * code that must survive being parsed before any transpiler runs (see
 * boot.js's "ES5 guard pattern" comment) — index.html serves classic
 * scripts only, `type="module"` would be silently rejected.
 *
 * Exports the pure decision logic (no window/document access) for
 * node:test — same "module.exports under Node, window.__owX in the
 * browser" pattern as bootstrap-lookup.js / local-vault-registry.js. The
 * actual interception (Object.defineProperty wrapping, the candidate queue,
 * Element.prototype.addClass wrapping) needs a live DOM/webpack bundle and
 * is verified in a real browser only (brief §5 DoD#12).
 */
(function () {
  'use strict';

  // ── named, reasoned constants — never magic numbers (brief §3.7 defect #5) ──

  // Per-candidate queueMicrotask retry budget before giving up on that one
  // candidate. The spike measured 2 ticks between webpack wiring the export
  // getter (`n.d(...Platform...)`) and the `var bn=` assignment landing
  // (brief §3.1 "קריטי"). 500 is a wide margin: ticks are microtask turns,
  // not wall-clock time, so waiting longer is essentially free — but an
  // unbounded loop would wrap Object.defineProperty forever if Obsidian's
  // shape ever changes so the assignment never lands.
  var CAPTURE_TICK_CEILING = 500;

  // Absolute wall-clock upper bound — brief §3.1a (post-calev fix): this is
  // NOT the normal give-up path. The normal path is anchored to app.js's
  // own `load` event (see notifyAppJsLoaded() below), because a plain
  // wall-clock deadline from install() was measured to count Obsidian's own
  // bundle-DOWNLOAD time (13 scripts + vault verification happen before
  // app.js is even injected) — 92% of a 5000ms budget consumed at 3 Mbps,
  // a perfectly ordinary mobile connection. This timer exists purely as a
  // last-resort guarantee that Object.defineProperty gets restored even if
  // app.js's <script> element NEVER fires `load` at all (e.g. the request
  // fails outright). Deliberately long: unlike the old deadline, this one
  // no longer races a normal download, so there is no cost to being
  // generous (brief §3.1a: "רשת-ביטחון בשעון-קיר נשארת... אבל ארוכה").
  var GLOBAL_SAFETY_NET_MS = 30000;

  // Mirrors the spike's addClass safety net: if document.body's "is-mobile"
  // class is never added (so the wrapped addClass never self-restores — see
  // wrapAddClass() "restore on first filter"), unwrap
  // Element.prototype.addClass anyway after this window so the wrapper
  // doesn't tax addClass calls for the rest of the runtime (brief §3.1
  // "עטיפה שנשארת היא מס על כל הרנטיים").
  var ADDCLASS_SAFETY_NET_MS = 3000;

  // Exactly these three are locked — brief §3.2. isPhone/isTablet are read
  // from window.__owPlatformOverrides upstream (boot.js) but intentionally
  // never locked here: Obsidian's own wn() rewrites them on every viewport
  // change (matchMedia), and locking would freeze
  // canSplit/canStackTabs/canDisplayRibbon/canPinSidebar. isDesktopApp is
  // never set by the bundle on the mobile codepath, so overriding it would
  // be a no-op — deliberately not attempted (brief §3.2).
  var LOCKED_FLAGS = ['isMobile', 'isMobileApp', 'isDesktop'];

  // ── pure decision logic — no window/document access, unit-testable ──────

  // brief §3.1 — spike defect #1: this check existed in the spike but was
  // only computed, never enforced. Here it gates whether a captured object
  // is accepted at all.
  function isValidShape(P) {
    return !!P && typeof P === 'object' &&
      ('isMobileApp' in P) && ('canPinSidebar' in P);
  }

  // brief §3.5 says "truthy VALUE, not mere key existence" — but a plain JS
  // `!!value` check is wrong here: localStorage always stores strings, and
  // the strings "0" and "false" are both truthy in JS while every human
  // (and every other on/off flag in this codebase) reads them as "off". A
  // second calev pass on this exact slice caught it live:
  // `localStorage.EmulateMobile = "0"` was turning emulation ON. Treat "0"/
  // "false" (case-insensitively) the same as the empty string.
  function isEmulateActive(value) {
    if (!value) return false;
    var normalized = String(value).toLowerCase();
    return normalized !== '0' && normalized !== 'false';
  }

  // Combines brief §3.0 (fallback when __owPlatformOverrides is missing) and
  // §3.5 (EmulateMobile takes precedence — "קדימות"). `overrides` is
  // whatever window.__owPlatformOverrides currently holds; `emulateValue` is
  // the raw string from localStorage.getItem('EmulateMobile') (checked via
  // isEmulateActive() above — truthy VALUE and not one of the "off" strings
  // a user could plausibly set by hand, not mere key existence).
  //
  // Returns null when there is nothing valid to lock onto — callers MUST
  // treat null as "do not lock anything, do not wrap addClass" (brief §3.0
  // "המלכודת": on an empty object `!want.isMobile` is `true`, which would
  // wrongly suppress is-mobile while Platform still reports mobile).
  function computeWant(overrides, emulateValue) {
    if (isEmulateActive(emulateValue)) {
      return { isMobile: true, isMobileApp: true, isDesktop: false };
    }
    if (!overrides || typeof overrides !== 'object') return null;
    return {
      isMobile: !!overrides.isMobile,
      isMobileApp: true, // brief §3.2: always locked true, never derived from overrides
      isDesktop: !!overrides.isDesktop,
    };
  }

  // brief §3.3 — "כל שלושת הסייגים במקום אחד": want must exist AND be a
  // real (non-empty) decision, AND that decision must be "not mobile". A
  // missing/null want must never satisfy this (see computeWant's doc above).
  function shouldWrapAddClass(want) {
    return !!want && !want.isMobile;
  }

  var api = {
    isValidShape: isValidShape,
    isEmulateActive: isEmulateActive,
    computeWant: computeWant,
    shouldWrapAddClass: shouldWrapAddClass,
    CAPTURE_TICK_CEILING: CAPTURE_TICK_CEILING,
    GLOBAL_SAFETY_NET_MS: GLOBAL_SAFETY_NET_MS,
    ADDCLASS_SAFETY_NET_MS: ADDCLASS_SAFETY_NET_MS,
    LOCKED_FLAGS: LOCKED_FLAGS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return; // under node:test — never touch window/Object.defineProperty
  }
  if (typeof window === 'undefined') return;

  window.__owPlatformBridge = api; // exposed for the same-turn self-test (brief §5 DoD#12)

  // ── browser wiring — installs the Object.defineProperty interceptor ─────

  var orig = Object.defineProperty;
  var queue = [];            // { getter, tries } — brief §3.1 "תור מועמדים, לא מועמד יחיד"
  var pumpScheduled = false;
  var settled = false;       // true once we've captured (or globally given up) — stop everything
  var appJsLoadSignalReceived = false; // set by notifyAppJsLoaded() — brief §3.1a

  // One warning PER DISTINCT message, not one warning total (brief §3.1a
  // finding 3, calev): a single shared flag let an early, low-value warning
  // ("a foreign candidate never resolved") permanently swallow the two
  // high-value ones ("overrides missing", "capture never completed") —
  // weakening the one telemetry signal that replaced applyPatches' loud
  // throw (brief §3.0).
  var warnedFor = {};
  function warnOnce(key, msg) {
    if (warnedFor[key]) return;
    warnedFor[key] = true;
    console.warn('[obsidian-web] platform-bridge: ' + msg);
  }

  // A genuine give-up (not the benign "one foreign candidate dropped, still
  // listening" case) gets more than a console message nobody will see
  // (brief §3.1a: "warning אחד לא מספיק... להוסיף אינדיקציה שהמשתמש יכול
  // לפעול לפיה"). boot.js exposes this hook right after defining its own
  // setStatus(), long before app.js is even injected — both give-up paths
  // below only fire after app.js has been injected (or, for the absolute
  // fallback, well after boot.js's synchronous top level has run), so the
  // hook is always present by the time this could possibly be called.
  function reportCaptureFailure(key, msg) {
    warnOnce(key, msg);
    if (typeof window.__owReportPlatformFailure === 'function') {
      window.__owReportPlatformFailure(msg);
    }
  }

  var wrapped = function (target, prop, desc) {
    if (!settled && prop === 'Platform' && desc && typeof desc.get === 'function') {
      queue.push({ getter: desc.get, tries: 0 });
      schedulePump();
    }
    return orig.apply(this, arguments);
  };
  Object.defineProperty = wrapped;

  function restoreDefineProperty() {
    if (Object.defineProperty === wrapped) Object.defineProperty = orig;
  }

  // Global safety net (brief §3.1 "רשת-ביטחון: משחזרים בכל מקרה אחרי חלון
  // קצוב, גם אם לא נלכד כלום") — real wall-clock timer, independent of the
  // microtask-driven queue above. Per §3.1a this is now a LAST-RESORT path
  // only (app.js never finished loading at all); the normal give-up path is
  // notifyAppJsLoaded() below and pump()'s post-load queue-drain check.
  setTimeout(function () {
    if (settled) return;
    settled = true;
    restoreDefineProperty();
    reportCaptureFailure('global-safety-net',
      'capture never completed within the ' + (GLOBAL_SAFETY_NET_MS / 1000) +
      's absolute fallback (app.js may have failed to load); running with Platform unmodified. Try reloading the page.');
  }, GLOBAL_SAFETY_NET_MS);

  // Called by boot.js once app.js's OWN <script> element fires its native
  // `load` event (brief §3.1a) — this is the anchor for "give up on
  // capture", replacing the wall-clock deadline that used to count
  // Obsidian's own bundle-download time (finding 1). By the time `load`
  // fires, app.js's synchronous top-level evaluation — where the real
  // defineProperty('Platform', ...) call happens (webpack's export map,
  // n.d(e,{Platform:()=>bn})) — has already run to completion. So:
  //   · if NO candidate was ever queued, the export shape must have
  //     changed — nothing left to wait for, give up right away.
  //   · if a candidate WAS queued but hasn't resolved yet (bn's assignment
  //     lands a couple microtask ticks later per the spike's measurement),
  //     its own per-candidate ceiling (tick-based, not ms — CAPTURE_TICK_
  //     CEILING) keeps governing it via the normal pump() path; pump()'s
  //     own post-load queue-drain check (below) takes over from there.
  function notifyAppJsLoaded() {
    if (settled || appJsLoadSignalReceived) return;
    appJsLoadSignalReceived = true;
    // One microtask hop of margin (brief §3.1a "ניקוז microtasks, ticks לא
    // ms") before deciding — defensive: per HTML's task/microtask-queue
    // ordering this is already guaranteed to run after any pump() turn
    // queued during app.js's own synchronous evaluation, but checking
    // straight from a queued microtask (rather than synchronously inside
    // this call, which runs from boot.js's script-load task handler) keeps
    // this independent of that guarantee.
    queueMicrotask(function () {
      if (settled) return;
      if (queue.length === 0) {
        settled = true;
        restoreDefineProperty();
        reportCaptureFailure('no-candidate-post-load',
          'app.js finished loading but no Platform export was ever intercepted; running with Platform unmodified. Try reloading the page.');
      }
      // else: a real candidate is mid-flight — see pump()'s post-load
      // queue-drain check for what happens once it settles.
    });
  }
  window.__owPlatformBridge.notifyAppJsLoaded = notifyAppJsLoaded;

  function schedulePump() {
    if (pumpScheduled || settled) return;
    pumpScheduled = true;
    queueMicrotask(pump);
  }

  // Single recurring microtask pump processing the WHOLE queue each turn
  // (brief §3.1 "מי מתזמן: queueMicrotask יחיד ורץ-בלולאה... לא tick נפרד
  // למועמד"). This is what lets two defineProperty('Platform', ...) calls
  // that land in the same synchronous turn (before any microtask has run)
  // both get a fair first check — the second is not simply overwritten by
  // the first (brief §5 DoD#12 same-turn self-test).
  function pump() {
    pumpScheduled = false;
    if (settled) return;
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      if (settled) return; // capture() below may settle mid-loop
      var candidate = queue[i];
      var P;
      try { P = candidate.getter(); } catch (e) { P = undefined; }
      if (P && typeof P === 'object') {
        if (isValidShape(P)) {
          capture(P);
          return; // capture() restores synchronously (finally) — stop
        }
        // Foreign Platform-shaped object that failed shape validation —
        // dropped immediately, keep scanning the REST of the queue in this
        // same tick (brief §3.1 "נזרק מיד, ועוברים לבא בתור באותו tick").
        continue;
      }
      // Not ready yet (getter returned undefined — var not assigned yet).
      candidate.tries++;
      if (candidate.tries >= CAPTURE_TICK_CEILING) {
        // Per-candidate ceiling, not global (brief §3.1) — a candidate stuck
        // forever does not consume the budget of others behind it, because
        // each candidate carries its own `tries` counter. Benign by itself
        // (re-arm keeps listening) — not a reportCaptureFailure, just a
        // diagnostic warning.
        warnOnce('candidate-ceiling', 'a Platform candidate never resolved to an object within ' + CAPTURE_TICK_CEILING + ' ticks; dropping it.');
        continue;
      }
      next.push(candidate);
    }
    queue = next;
    if (queue.length) {
      schedulePump();
      return;
    }
    // Queue drained without a verified capture this turn. Before app.js has
    // finished loading, an empty queue is expected and fine — a later
    // <script> may still queue the real candidate (brief §3.1 "נשארים
    // עטופים"). But once app.js HAS loaded, every script that could ever
    // call defineProperty('Platform', ...) has already run — nothing left
    // to wait for, so restore synchronously right now instead of relying
    // on the wall-clock fallback (brief §3.1a finding 2: "תקרה פר-מועמד
    // חייבת לשחזר defineProperty סינכרונית" — an existing §3.1 requirement
    // that wasn't met, not a new one).
    if (appJsLoadSignalReceived && !settled) {
      settled = true;
      restoreDefineProperty();
      reportCaptureFailure('queue-drained-post-load',
        'app.js finished loading and the capture queue drained with nothing captured; running with Platform unmodified. Try reloading the page.');
    }
  }

  function capture(P) {
    settled = true; // no more candidates accepted/scheduled from here on
    try {
      var want = computeWant(window.__owPlatformOverrides, localStorage.getItem('EmulateMobile'));
      if (want) {
        for (var i = 0; i < LOCKED_FLAGS.length; i++) {
          lockFlag(P, LOCKED_FLAGS[i], want);
        }
        // Expose only a validated, (attempted-)locked reference — brief
        // §3.0 "מועמד שנדחה באימות — לעולם לא נחשף" / "רק להפניה שעברה
        // אימות-צורה". If lockFlag above throws, we never reach this line —
        // that's the point of try/finally over try/catch here (brief §3.7
        // defect #4): a genuine failure mid-install must not expose a
        // half-configured Platform nor wrap addClass.
        window.__owPlatform = P;
        if (shouldWrapAddClass(want)) wrapAddClass();
      } else {
        // brief §3.0 fallback: __owPlatformOverrides missing/invalid at
        // install time — do not lock anything and do NOT wrap addClass, but
        // still expose the validated reference (existing consumers like
        // obsidian-web-layout/main.js:65 must keep working) and warn once.
        warnOnce('overrides-missing', 'window.__owPlatformOverrides missing at install — running without platform locking.');
        window.__owPlatform = P;
      }
    } finally {
      restoreDefineProperty();
    }
  }

  function lockFlag(P, key, want) {
    // `set` no-op is mandatory, not optional (brief §3.2): the bundle's own
    // entry IIFE assigns these flags inside `"use strict"`, and assigning to
    // an accessor with no setter throws there.
    orig(P, key, {
      get: function () { return want[key]; },
      set: function () {},
      configurable: true,
      enumerable: true,
    });
  }

  function wrapAddClass() {
    var proto = Element.prototype;
    if (typeof proto.addClass !== 'function') return;
    var origAC = proto.addClass;
    var acRestored = false;
    function restoreAC() {
      if (acRestored) return;
      acRestored = true;
      if (proto.addClass === wrappedAC) proto.addClass = origAC;
    }
    var wrappedAC = function () {
      var args = Array.prototype.slice.call(arguments);
      if (this === document.body) {
        var idx = args.indexOf('is-mobile');
        if (idx !== -1) {
          args.splice(idx, 1);
          restoreAC(); // restore on first filter — brief §3.3
          // Mirror the ORIGINAL addClass's return contract: it always
          // returns undefined (brief §3.7 defect #7 — the spike wrongly
          // returned `this`). Only call through when there's something left
          // to add; either way, return undefined.
          if (args.length) origAC.apply(this, args);
          return undefined;
        }
      }
      return origAC.apply(this, args);
    };
    proto.addClass = wrappedAC;
    setTimeout(restoreAC, ADDCLASS_SAFETY_NET_MS);
  }
})();
