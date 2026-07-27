# Walkthrough — obsidian-web

> יומן-ביצוע כרונולוגי (אליעזר). רציונל ארכיטקטוני חי ב-docs/decisions (ריפו brief-driven-slices), לא כאן.

## 2026-07-27 — slice/desktop-layout-now — Commit 6: אימות מלא בדפדפן

**סביבה**: Node runtime-server מקומי (`http://127.0.0.1:3577`, secure-context —
127.0.0.1 נחשב trustworthy), Chromium (Playwright 1.61.1 מקומי, headless), כספת דמו
OPFS (`0000demo0000demo`, נוצרת lazy דרך `/vault/0000demo0000demo`).
⚠️ `SYSTEM_PLUGINS_SEED_DISABLED=obsidian-livesync` נדרש כדי ש-livesync ייזרע מקומית —
ברירת-המחדל של השרת המקומי (לא CF) לא זורעת אותו כלל (התנהגות קיימת, לא קשורה לסלייס).

### מה נבדק ואומת (לייב, לא בקוד)

- **DoD#0** — `window.__owPlatform.isDesktopApp === true` בפריסת-דסקטופ, `=== false`
  בפריסת-מובייל (נבדק בקונסולה, לא דרך `require('obsidian')`). ✅
- **DoD#1** — ribbon, `.mod-left-split`, `.mod-right-split`, status bar קיימים;
  `.mobile-navbar`/`.mobile-toolbar` נעדרים; `is-mobile` נעדר מ-`body`. ✅
- **DoD#2** — `app.vault !== null`, `getName()==='Demo'`, `.workspace-leaf` קיים.
  ⚠️ `getFiles().length === 0` — **לא רגרסיה**: `example-vault.json` קיים רק ב-build
  של CF (מתועד כבר בקוד `boot.js`), אז כספת-הדמו המקומית ריקה במכוון בסביבת-הפיתוח
  המקומית. נבדק גם קרוא+כתיבה אמיתיים (DoD#9, ראה למטה) שמוכיחים שהכספת אכן פעילה.
- **DoD#3** — `resourcePathPrefix === "file:///"`, "Show debug info" מציג
  `API version: 1.12.7` (לא ריק) ואין "installer version too low"/"Manual update
  required". ✅
- **DoD#4** — `canExportPdf === false`, `canPopoutWindow === false` **קפדני**. ✅
- **DoD#7** — קליק-ימני בתוך העורך פותח `.menu.mod-context` (הבדיקה המכריעה של
  §2.6א — לפני התיקון היה "לא קורה כלום"). ✅
- **DoD#8** — מעבר `mobile`/`desktop`/`auto` (localStorage + reload) — כל שלושתם
  עקביים (`isMobile`/`isDesktopApp`/`is-mobile`/`.mobile-navbar` תואמים), אפס שגיאות. ✅
- **DoD#9** — יצירת קובץ + הקלדה אמיתית בעורך (מקלדת, לא API בלבד) + reload —
  התוכן שרד. ✅
- **DoD#11** — `obsidian-livesync` מופעל ידנית (`enablePluginAndSave`) — אפס שגיאות
  חדשות. `window.require('electron')` (הנתיב שפלאגין-real מקבל) מחזיר אובייקט אמיתי
  עם `ipcRenderer`. ✅
- **DoD#12** — הזרקת `delete window.__owPlatformOverrides` (route interception על
  בקשת `app.js`, לפני שהוא רץ — **חובה** `serviceWorkers:'block'` בקונטקסט, אחרת
  ה-SW עוקף את ה-interception) → הבאנר `#ow-platform-warning` מופיע עם הטקסט הנכון,
  `isDesktopApp === false` (לא נעול, לא crash). ✅
- **DoD#13** — הדלקת `nativeMenus` (`vault.setConfig` + `saveConfig()` + reload,
  1000ms debounce על `requestSaveConfig` — נדרש להמתין/לקרוא ל-save מפורשות) → קליק-ימני
  על tab-header פותח `.menu.mod-context` (השim שלנו, `remote.Menu.buildFromTemplate`)
  **במיקום הקליק בדיוק** (לא 0,0). ✅ מאשש את תיקון §5ד.
- **DoD#14** — קליק כפול על כותרת-טאב לא זורק (מפעיל בפועל את
  `remote.systemPreferences.getUserDefault` → `electronWindow.isMaximized()`/`maximize()`
  — state אמיתי, לא no-op). כל שיטות ה-alias (`isMinimized`/`restore`/`isMaximized`/
  `unmaximize`/`minimize`/`setAlwaysOnTop`/`webContents`) נבדקו ישירות — אף אחת לא זרקה.
  `remote.app.relaunch()` לא זרק. ✅
- **DoD#5** — **נדחה במכוון ל-אחרי Commit 7** (כפי שהבריף דורש: חטיפת-הקליק ב-`boot.js`
  עדיין קיימת, ומפנה ל-`/starter` **דרך ה-`starter` channel שממומש כבר** — אישרתי את
  זה ישירות: קליק על `.workspace-drawer-vault-switcher` נחת על `/starter`, מוכיח
  ש-`sendSync('starter')` עובד).
- **מסך-בדיקה כללי (חלק מ-DoD#10)** — Settings, Command palette (`Ctrl+P`), Search
  (`Ctrl+Shift+F`), About tab — כולם נפתחים, אפס `pageerror` חדשות.

### רעש שאינו רגרסיה (נמדד ומתועד, לא תוקן)

- **"A network error occurred." × 8** ו-404 על שני קובצי `.woff2` — **מופיע גם
  בפריסת-מובייל הטהורה** (`isDesktopApp` לא מעורב כלל, נבדק ישירות) — רעש קיים-מראש
  של סביבת-הבדיקה הזו (ככל-הנראה fetch חיצוני שנכשל ברשת הסנדבוקס של הריצה), **לא
  רגרסיה מהסלייס הזה**.

### חריגות

- אין קוד חדש ב-commit הזה — אימות בלבד, לפי §6 Commit 6 בבריף.

## 2026-07-27 — slice/desktop-layout-now — Commit 5: הדלקת הדגל (isDesktopApp) + lockConst + עדכון טסטים + חיווט DoD#12

### מה בוצע?

- **`src/client-mobile/platform-bridge.js`**:
  - `LOCKED_FLAGS` — נוסף `'isDesktopApp'` (4 דגלים במקום 3).
  - `computeWant()` — **שני** מסלולי-היציאה מחזירים `isDesktopApp` עכשיו: מסלול
    ה-emulate-mobile (early return) → `isDesktopApp: false` **קפדני** · המסלול הרגיל →
    `isDesktopApp: !!overrides.isDesktop` (מגזרת isDesktop, לא נקרא מ-`overrides.isDesktopApp`
    ישירות — אותה גישה כמו isMobileApp הקבוע).
  - **§1ג** — ההערה שליד `LOCKED_FLAGS` נכתבה מחדש: כבר לא טוענת ש-`isDesktopApp` הוא no-op
    (זה היה נכון לפני שהיה shim ל-`window.electron`; עכשיו זה שקר).
  - **§4** — `lockConst(P, key, value)` חדש (אותה צורת `defineProperty`/`set` no-op כמו
    `lockFlag`, בלי תלות ב-`want`) — נקרא **תמיד** (בשני הענפים של `capture`, גם כש-`want`
    הוא `null`): `lockConst(P, 'canExportPdf', false)` ו-`lockConst(P, 'canPopoutWindow', false)`.
  - **DoD#12** — הענף `overrides-missing` (`want === null`) עבר מ-`warnOnce(...)`
    (console-only) ל-`reportCaptureFailure(...)` — עכשיו יש גם באנר-משתמש, לא רק console.warn.
- **`src/client-mobile/boot.js`** — `window.__owPlatformOverrides.isDesktopApp` עבר מ-`false`
  קבוע ל-`!layout.isMobile` (עקבי עם `isDesktop`). ההערה בת-3-השורות ליד השדה נכתבה מחדש
  (אותה מחלקה כמו §1ג — הנימוק הישן, "הריצה תמיד דפדפן", כבר לא נכון).
- **`src/client-mobile/test/platform-bridge.test.js`** (§1ד) — **6 ה-assertions שנשברו
  תוקנו** (לא נמחקו): 5× `deepEqual(want, {...})` קיבלו `isDesktopApp` בליטרל הצפוי ·
  ה-assertion של `LOCKED_FLAGS.sort()` עודכן ל-4 איברים. **נוספו 4 טסטים חדשים** (כיסוי
  מפורש ל-`isDesktopApp === false`/`=== true` בשני המסלולים, כולל את המקרה הקריטי של
  §1א — emulate מתוך overrides של desktop).

### בדיקות

- `bun test` תחת `src/client-mobile` — **86 pass / 0 fail** (עלה מ-84 → 86, מעל ה-baseline
  76 — DoD#16 "מספר טסטים ≥ base" מתקיים, בלי "רצפה" של מחיקת assertions).
- `node --check` על כל הקבצים שנגעו בהם — עבר.
- **טרם בוצעה בדיקת-דפדפן חיה** — DoD#0 (`Platform.isDesktopApp`), DoD#4
  (`canExportPdf`/`canPopoutWindow`), DoD#12 (הזרקת `undefined` ל-`__owPlatformOverrides`
  ובדיקת הבאנר) דורשים סביבה חיה — Commit 6.

### חריגות

- **מתועד ולא מבוצע ע"י אליעזר**: §1ג מבקש גם לתקן את `runtime-platform-descriptors.md`
  §3.2 (המסמך ב-docs-repo, לא בריפו הזה) — לפי הקונבנציה שנקבעה בבריפים הקודמים באותה
  שרשרת (`electron-shim-foundation.md`/`desktop-shell-shim.md` §6: "ב-docs-repo, mordechai
  מעדכן, לא בני-commit מהסלייס"), התיקון הזה מדווח כאן ומופנה למרדכי, לא מבוצע כ-commit
  בריפו הקוד.

## 2026-07-27 — slice/desktop-layout-now — Commit 4: ערוצי vault*/starter/help + context-menu round-trip + clipboard.readImage

### מה בוצע?

- **`shims/electron.js`** — `sendSync`:
  - `vault` → `{ path: api.vaultPath(__owVaultId, (registry.get(id)||{}).name) }`.
  - `vault-list` → מפה `{ [id]: {path} }` על `registry.list()` (רק local/folder — server
    לא מופיע, מוסכם ב-desktop-shell-shim.md §2.4).
  - `vault-open` → מחלץ `id` מ-`/^\/ow\/([^/]+)\//` (שם-כספת עשוי להכיל `/`, לא נסמכים על
    שאר המחרוזת), מנווט ל-`/vault/<id>` (setTimeout-0), **מחזיר `true` בדיוק**.
  - `starter` → `location.href = '/starter'`. `help` → `window.open('https://help.obsidian.md/')`.
  - `vault-remove`/`vault-move` — **לא מומשו בכוונה** (0 קריאות בבאנדל, נמדד).
- **`send('context-menu')`** — שודרג מ-no-op שקט ל-**round-trip אמיתי**: מגיב ב-microtask
  עם `{webContentsId, editFlags:{canCut,canCopy,canPaste,...}, misspelledWord:''}` דרך
  `ipcRenderer.emit`. בלעדיו — תפריט-ההקשר בעורך "לא קורה כלום" (§2.6א, מצב-כשל שקט).
- **`remote.webContents.fromId`/`getFocusedWebContents`** — מחזירים עכשיו את
  `webContentsInstance` האמיתי (לא `null`) כדי ש-`.cut()`/`.copy()`/`.paste()` על
  תוצאת ה-context-menu round-trip לא יזרקו.
- **`clipboard.readImage()`** — **סינכרוני** (לא Promise — הבאנדל קורא בלי await), מחזיר
  `nativeImage` ריק (`isEmpty()===true`) כדי שנתיב ה"הדבקת תמונה" ידלג בחן במקום לזרוק.

### בדיקות

- `node --check` על `shims/electron.js` — עבר.
- `bun test` תחת `src/client-mobile` — 84 pass / 0 fail (ללא רגרסיה; אין עדיין טסטים
  ייעודיים ל-electron.js — האימות האמיתי בדפדפן, Commit 6).

### חריגות

- אין.

## 2026-07-27 — slice/desktop-layout-now — Commit 3: EISDIR בשורש-הכספת + api.vaultPath + בדיקות-יחידה

### מה בוצע?

- **`src/client-mobile/vault-root-path.js`** (חדש) — `isVaultRootPath(p)`, לוגיקה טהורה
  (בלי DOM), דפוס dual-export זהה ל-`bootstrap-lookup.js`. מנרמל trailing slashes ובודק
  `''`/`'.'` אחרי נירמול — **לא** `path === ''` בלבד (electron-shim-foundation.md §3.3:
  הנתיב שנמדד בפועל הוא `"<id>//"`, לא `""`).
- **`src/client-mobile/shims/capacitor-shim.js`** — ה-`Filesystem` Proxy (get trap) עוטף
  את `readFile` ספציפית: אם `fullPath(opts)` הוא שורש-הכספת → `Promise.reject(EISDIR)`
  במקום להמשיך ל-backend (server/local/folder — התיקון מגן על שלושתם דרך נקודת-ההשתלה
  היחידה). שאר המתודות (כולל ה-`bind`) לא נגעו.
- **`src/client-mobile/local-vault-registry.js`** — `api.vaultPath(id, name)` →
  `'/ow/' + id + '/' + (name || id)`. חתימת שני-ארגומנטים במכוון (§3.4: `get(id)` לא מחזיר
  `id`, כך ש-`vaultPath(get(id))` היה נותן `/ow/undefined/<name>`).
- **`src/client-mobile/index.html`** — תג script חדש ל-`vault-root-path.js?v=1`, אחרי
  `local-vault-registry.js`/`opfs-store.js`/`folder-handle-store.js` ולפני `capacitor-shim.js`.
- **בדיקות-יחידה חדשות**: `test/vault-root-path.test.js` (שורש: `''`/`'/'`/`'.'`/`'//'`/`'///'`
  → root; `'Welcome.md'`/`'Features/Backlinks.md'`/`'.obsidian/...'`/`'Features/'` → **לא**
  root) · תוספת ל-`test/local-vault-registry.test.js` עבור `vaultPath` (כולל fallback ל-id).

### בדיקות

- `bun test` תחת `src/client-mobile` — **84 pass / 0 fail** (עלה מ-76 — 8 טסטים חדשים).
- `node --check` על כל הקבצים שנגעו בהם — עבר.

### חריגות

- אין.

## 2026-07-27 — slice/desktop-layout-now — Commit 2: shims/electron.js (seed + §5א/§5ב) + boot.js רישום

### מה בוצע?

- **`src/client-mobile/shims/electron.js`** (חדש, 510→~530 שורות) — seeded מ-
  `archive/desktop-runtime:src/client/shims/electron.js`, עם השינויים המחייבים
  (electron-shim-foundation.md §3.1): הסרת **כל** מופעי `__owSyncJson` (טבלת-ערוצים
  מקומית עם תשובה קנויה במקום XHR לשרת שלא קיים) · `remote.safeStorage` (4 מתודות) ·
  export כפול (`window.electron` **וגם** `global.__owElectron`, אותו אובייקט) ·
  `getCurrentWebContents().session.availableSpellCheckerLanguages` · הסרת ה-short-circuit
  של `__owBootstrapCache.electron` · `nativeImage` + `clipboard.writeImage` (לא מגודר-דגל,
  Web Viewer "העתק תמונה").
- **§5א** — `sendSync('frame')` מחזיר **תמיד** `'native'`, ללא תלות בכתיבה דרך Settings
  (דריסה מפורשת ומתועדת של `electron-shim-foundation.md` §3.2, שקבע `'hidden'`).
- **§5ב** — `makeWindow()` נשאר Proxy יחיד (מותר ע"י foundation) אך עם טבלה מורחבת:
  המתודות שנמדדו דרך alias (`isMinimized`/`restore`/`isMaximized`/`unmaximize`/`minimize`/
  `setAlwaysOnTop`) מקבלות מימוש **stateful** אמיתי (לא סתם no-op), כדי שהגייט הכפול-קליק
  (`isMaximized()` אחרי `maximize()`) יתנהג בעקביות.
- **§5ג** — `remote.systemPreferences` (2 צרכנים: double-click-titlebar guard +
  `AudioRecorder.getMediaAccessStatus`), `remote.app.relaunch`/`quit` (quit עושה
  `location.reload()`; relaunch no-op — שני הכפתורים תמיד קוראים לשניהם ברצף).
- **§5ד** — `Menu.buildFromTemplate(...).popup()` נופל חזרה למיקום-עכבר אחרון
  (`lastPointer`, נעקב ב-`mousedown`/`contextmenu` capture) כש-`opts.x`/`opts.y` חסרים —
  שני אתרי-הקריאה בבאנדל מעבירים רק `{window}`.
- **`file-url` → `'file:///'`** — ערוץ top-level שרץ בכל עלייה (נשמט מהטיוטה הראשונה,
  נתפס בבדיקת ה-grep מול הבאנדל האמיתי; ראה "חריגות" למטה).
- **`vault-open`/`vault-remove`/`vault-move`** — לא מומשו (מוקצים ל-Commit 4 / נמחקו כקוד-מת
  לפי המדידה שאין קריאות בבאנדל).
- **`src/client-mobile/boot.js`** — `modules['electron'] = window.electron` (רישום
  ללא-תנאי, כמו כל שאר המפה) · `process.versions.electron = '30.0.0'` (ליטרל נושא-משקל —
  שלושה אילוצים בו-זמנית: `major>=13`, `>= '28.2.3'`, `major<40`).
- **`src/client-mobile/index.html`** — תג script חדש ל-`shims/electron.js?v=1`, אחרי
  `platform-bridge.js` ולפני `boot.js`.

### בדיקות

- `node --check` על `shims/electron.js` ו-`boot.js` — עבר.
- `bun test` תחת `src/client-mobile` — 76 pass / 0 fail (baseline; טסטים ייעודיים ל-electron.js
  לא נדרשים ב-DoD של הבריף — האימות האמיתי הוא בדפדפן, Commit 6).
- לא בוצעה עדיין בדיקת-דפדפן חיה (מתוכננת ל-Commit 6, per §6 בבריף — "אימות מלא בדפדפן").

### חריגות

- טיוטה ראשונית של הקובץ פספסה את ערוץ `file-url` (מטופל ב-§3.0 של
  electron-shim-foundation.md, לא בטבלת §3.2) — אותר ותוקן **לפני** ה-commit, ע"י גריפ ישיר
  מול `vendor/obsidian-mobile/app.js` (לא מתוך זיכרון של טבלת הבריף). בלעדיו
  `resourcePathPrefix` היה נשאר `''` (ברירת-המחדל הריקה), לא `'file:///'` — DoD#3 היה נכשל.
- **החלטה מתועדת**: `makeWindow()` נשאר Proxy (לפי היתר foundation "בדיוק אחד מותר"),
  לא הומר לאובייקט רגיל — למרות שדיווח-ה-dispatch הזהיר מ"Proxy גורף = truthy". הפתרון
  שיושם: לא שינוי המנגנון (Proxy), אלא הרחבת הטבלה המפורשת + תיקון root-cause האמיתי
  (`remote.systemPreferences` חסר לגמרי) — כי "isMaximizable" כבר היה בטבלה עם ערך נכון
  (`true`), לא ברירת-מחדל שגויה של ה-Proxy. מתועד גם בקוד עצמו (הערה מעל
  `windowMethodReturns`).

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
