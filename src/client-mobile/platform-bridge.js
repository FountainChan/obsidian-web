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

  // Absolute wall-clock upper bound for the WHOLE capture process,
  // independent of any single candidate — covers "no candidate was ever
  // captured at all" (e.g. the export shape changed). Restores
  // Object.defineProperty so a failed capture doesn't leave every future
  // defineProperty call on the page wrapped forever (brief §6 top risk).
  var GLOBAL_SAFETY_NET_MS = 5000;

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

  // Combines brief §3.0 (fallback when __owPlatformOverrides is missing) and
  // §3.5 (EmulateMobile takes precedence — "קדימות"). `overrides` is
  // whatever window.__owPlatformOverrides currently holds; `emulateValue` is
  // the raw string from localStorage.getItem('EmulateMobile') (checked for
  // truthiness of the VALUE, not mere key existence — mirrors upstream's own
  // `Zee` guard, brief §3.5).
  //
  // Returns null when there is nothing valid to lock onto — callers MUST
  // treat null as "do not lock anything, do not wrap addClass" (brief §3.0
  // "המלכודת": on an empty object `!want.isMobile` is `true`, which would
  // wrongly suppress is-mobile while Platform still reports mobile).
  function computeWant(overrides, emulateValue) {
    if (emulateValue) {
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
  var warned = false;

  function warnOnce(msg) {
    if (warned) return;
    warned = true;
    console.warn('[obsidian-web] platform-bridge: ' + msg);
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
  // microtask-driven queue above.
  setTimeout(function () {
    if (settled) return;
    settled = true;
    restoreDefineProperty();
    warnOnce('capture window elapsed with nothing captured; running with Platform unmodified.');
  }, GLOBAL_SAFETY_NET_MS);

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
        // each candidate carries its own `tries` counter.
        warnOnce('a Platform candidate never resolved to an object within ' + CAPTURE_TICK_CEILING + ' ticks; dropping it.');
        continue;
      }
      next.push(candidate);
    }
    queue = next;
    if (queue.length) schedulePump();
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
        warnOnce('window.__owPlatformOverrides missing at install — running without platform locking.');
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
