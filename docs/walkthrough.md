# Walkthrough — obsidian-web

> יומן-ביצוע כרונולוגי (אליעזר). רציונל ארכיטקטוני חי ב-docs/decisions (ריפו brief-driven-slices), לא כאן.

## 2026-07-27 — slice/desktop-layout-now — Commit 1: מקור-אמת לגרסת Obsidian

### מה בוצע?

- **`src/client-mobile/obsidian-version.js`** (חדש) — `window.__owObsidianVersion = '1.12.7'`, GENERATED,
  מקור-אמת יחיד לגרסה (docs/plans/electron-shim-foundation.md §3.0).
- **`scripts/update-obsidian-mobile.js`** — כותב את הקובץ הנ"ל מיד אחרי resolve הגרסה (לפני ההורדה),
  עם הודעת-console בולטת.
- **`src/client-mobile/shims/capacitor-shim.js`** — `App.getInfo().version` קורא עכשיו מ-
  `window.__owObsidianVersion` (עצלנית, בתוך גוף הפונקציה) במקום ליטרל `'1.12.7'` קשיח.
  Fallback ל-`'1.12.7'` נשאר, למקרה שהסקריפט לא רץ.
- **`src/client-mobile/index.html`** — תג script חדש ל-`obsidian-version.js?v=1`, לפני
  `shims/capacitor-shim.js` (וממילא לפני `boot.js`).

### בדיקות

- `node --check` על שלושת הקבצים הנוגעים ב-JS — עבר.
- `bun test` תחת `src/client-mobile` — 76 pass / 0 fail (baseline, לא נגעו בטסטים כאן).

### חריגות

- אין.
