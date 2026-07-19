# ‏יומן החלטות — obsidian-web

> ‏רציונל ‏ארכיטקטוני ‏פר-slice (‏מרדכי). ‏ליד הקוד, ‏לא ‏בריפו ‏השיטה.

## 2026-07-19 — folder-watch: תיקון addListener dispatch ב-Capacitor-shim (מחליף folder-refresh)

### רציונל
כספת-folder לא זיהתה שינויים חיצוניים. folder-refresh בנה את מנגנון-ה-watch נכון (FileSystemObserver
primary + rescan/כפתור fallback) אבל **נכשל ב-runtime (calev NO-GO)**: ה-callback של
`Filesystem.addListener('change', cb)` מעולם לא הגיע ל-store. folder-watch מתקן את שורש-הבעיה וממחזר את
קוד-ה-watch שכבר אומת ב-folder-refresh.

### שורש (אומת סטטית ע"י אביגיל מול vendor/obsidian-mobile/app.js)
ה-Capacitor registerPlugin proxy מנתב לפי `rtype`: `"promise"===rtype ? nativePromise : nativeCallback(e,n,t,i)`.
ה-shim הצהיר `addListener` כ-`rtype:'promise'` (`pm()`, capacitor-shim.js:991) → נותב ל-nativePromise
שמעביר **single-arg** (`method.call(plugin, options||{})`, :946) → ה-2nd arg (ה-callback) אבד לפני ה-store.

### שינויי-כיוון (לפי ממצאי אביגיל, סבב 1 USABLE-AFTER-FIX)
- **Option A המקורי נפסל**: override על `cap.Plugins.Filesystem.addListener` — אבל זה Proxy **get-only**
  (:672), ההצבה מוצללת, ו-Obsidian ניגש דרך ה-registerPlugin proxy שלו. חסר-אפקט.
- **התיקון הנכון = שכבת-הניתוב, שני חלקים חובה**: (1) הצהר `addListener` כ-`rtype:'callback'` (helper `cm()`)
  → ה-proxy מעביר 2-arg, בדיוק הסיגנטורה ש-store.addListener כבר מצפה לה; (2) override ל-`cap.nativeCallback`
  — כי אימות הראה ש-nativeCallback **לא עבר override** (רק nativePromise), אז הצהרת rtype לבדה תפנה ל-native-bridge
  המקורי → "not implemented on android". שני החלקים יחד.
- **regression scope הורחב**: nativeCallback הוא מסלול משותף → App.addListener (stub) חייב אימות מפורש, לא רק
  תחת fallback.

### רעיונות שנדחו
- **הסרת addListener מ-PluginHeaders** (Option B המקורי): נשאר כ-fallback ממוקד בלבד (אם ה-spike יגלה
  ש-core לא עובר דרך nativeCallback) — שביר, לא ברירת-מחדל.
- **polling מתמיד**: נדחה לטובת FileSystemObserver primary + rescan on-demand.

### אימות
calev-heavy (complexity 7) — **חובה מול Obsidian אמיתי** (הלקח מ-folder-refresh: self-test עקף את ה-Capacitor
bridge ופספס את הכשל). addListener capture דרך ה-bridge, שינוי חיצוני→מופיע (observer+fallback), regression App.

## 2026-07-17 — vault-switcher-fix: polyfill ל-native-select של "נהל כספות" (באג preview)

### ‏רציונל
‏המשתמשת מצאה ב-preview ‏ש-"‏נהל כספות" ‏לא עושה כלום — ‏זה ה-"native select ‏לא עובד פה" ‏שדגלה בתחילת ה-epic.

### ‏שורש (‏אומת אמפירית — ‏probes ‏ב-Chromium)
‏ה-vault-switcher ‏הוא `<select>` ‏שבסביבתנו ‏יש בו **‏אופציית `manage-vaults` ‏בלבד** (‏רשימת ה-vaults ‏ריקה כי `Bte()` ‏מחזיר ריק כשכספת פתוחה). ‏מכיוון שהאופציה היחידה כבר-נבחרה, ‏הקשה עליה ‏**‏לא מפעילה `change`** → `openVaultChooser()` ‏לא נקרא → no-op. (`openVaultChooser` ‏עצמו עובד — ‏removeItem+reload→chooser.)

### ‏הפתרון + ‏ממצא נוסף
- interceptor ‏על **pointerdown+mousedown** (‏לא change) ‏על ה-select (‏guard: `manage-vaults && length<=1`) → `openVaultChooser()`.
- **‏ממצא אביגיל**: ‏ה-handler ‏הקיים ‏ל-vault-switcher **‏div** (boot.js:605 → `/starter`) ‏גם הוא **‏שבור** ‏פוסט-mobile-native-polish (`/starter`→/ ‏עם mobile-selected-vault ‏מוגדר → resume, ‏לא chooser) → ‏תוקן גם הוא ל-openVaultChooser.
- ‏עיגון קריטי: ‏בזרימת ה-**vault-open** (‏verifyPromise.then, ‏ליד :605), ‏לא ב-no-vault branch.

### ‏רעיונות שנדחו
- **‏אכלוס רשימת ה-vaults ב-switcher** (‏תיקון Bte): ‏follow-up — ‏ה-chooser ‏כבר מציג vaults.
- **click-capture** (‏precedent): ‏ל-select ‏צריך event ‏מוקדם (pointerdown/mousedown) ‏לדיכוי ה-picker.

---

## 2026-07-16 — collapse-desktop: גמר ה-epic — המובייל כריצה יחידה, ארכוב דסקטופ

### ‏רציונל
‏הגמר של mobile-first collapse: ‏השרת המקומי מגיש את ריצת ה-**‏מובייל ב-`/`**, ‏ריצת הדסקטופ (`src/client`+`vendor/obsidian`) ‏מאורכבת.

### ‏הכרעות-מפתח
- **`/starter` = redirect 302 ל-`/`** (‏לא הסרה): `client-mobile/boot.js:610,617` ‏מנווטים ל-/starter (‏vault-switcher + error-recovery). ‏redirect ‏שומר עליהם עובדים (‏→ ‏מסך נייטיב) ‏**‏בלי לגעת ב-client-mobile**, ‏וגם משרת את הכוונה ("‏אין דף starter ‏דסקטופ").
- **‏re-point ‏משאבי-שורש** (`/i18n`,`/lib`,`/worker.js`,`/sim.js`) ‏מ-obsidianPath (‏דסקטופ) ‏ל-**obsidianMobilePath**: ‏המובייל המקומי היה תלוי בהם דרך תיקיית הדסקטופ; ‏obsidian-mobile ‏עצמאי (‏אושר ב-cf-mobile-serve) ‏→ ‏re-point ‏מנתק.
- **‏ארכוב = git rm + git tag** `archive/desktop-runtime` (‏recoverable, ‏לא מזהם עץ). `vendor/obsidian` (gitignored) + `scripts/update-obsidian.js` ‏נשארים vestigial.

### ‏ממצאי אביגיל (3 ‏סבבים, 5→3→0)
- **blocker**: test `vaults-api.test.js:267` ‏מאשר `/starter→200` → ‏עודכן ל-302 ‏(‏עם `redirect:'manual'` ‏אחרת undici ‏עוקב).
- **regression**: client-mobile /starter redirects → ‏נפתר ע"י ה-redirect (‏לא הסרה).
- **symlink** (finding 3): ‏`vendor/obsidian`→obsidian-mobile ‏מקומית → ‏re-point ‏no-op בדב; ‏אומת בקריאת-קוד (‏משמעותי ל-CF ‏שם ה-bundles ‏נפרדים).

### ‏שינויי-כיוון בתוך ה-epic (‏תיעוד)
- **cf-mobile ‏פוצל** ל-serve (‏בוצע) + seed (‏**‏נדחה** — ‏follow-up). LiveSync-preinstall ‏על CF ‏דורש bundling ‏של plugin ‏לא-מקומי → ‏נקשר ל-Worker-proxy port.
- **‏mobile-native-polish ‏הוכנס** (‏אופציה ב' ‏של המשתמשת) ‏לפני הגמר — ‏תיקן 2 ‏באגי-נייטיב + bug ‏לטנטי של CF bridge.

---

## 2026-07-16 — mobile-native-polish: תיקון משפחת-באגים בזרימה-הנייטיב (manage-vaults + Create-vault)

### ‏רציונל
‏שני סלייסים (opfs-ux, cf-mobile-serve) חשפו **‏אותה משפחת-באג**: ‏זרימות ב-bundle ‏הנייטיב ‏שמניחות native ‏שאין לנו.
‏המשתמשת בחרה (‏אופציה ב') ‏להכניס slice ‏ממוקד לפני המשך ה-epic, ‏כי אלה באגי-UX ‏שנתקלים בהם ב-preview.

### ‏הבאגים
1. **manage-vaults** (‏מצאה המשתמשת ב-preview): ‏native "‏ניהול כספות" ‏עושה `removeItem('mobile-selected-vault')+reload`,
   ‏אבל boot ‏עשה auto-resume ‏מ-`obsidian-web:lastVaultId` ‏(‏מפתח שלנו ‏שהנייטיב לא מנקה). ‏התיקון: **`mobile-selected-vault` = ‏מקור-אמת** — ‏היעדרו → ‏מנקה lastVaultId → ‏מסך.
2. **Create-vault**: ‏native `onCreateVault` ‏קורא `mkdir`→`/api/fs/mkdir`→404 (‏no-vault → VAULT_TYPE='server'). ‏התיקון: interceptor ‏ברמת-DOM (‏capture) → app→OPFS create, external→folder(choose) → navigate.

### ‏ממצאי אביגיל (2 ‏סבבים, 6→0)
- **‏קריטי (finding 1)**: entry-path ‏חייב **‏relative** (`location.pathname+'?vault='`) — ‏מקומית `/` ‏מגיש את ה**‏דסקטופ** (‏שלא משתמש ב-`__owLocalVaults`), ‏אז absolute `/?vault=` ‏"‏מאבד" ‏את ה-OPFS vault.
- **finding 5**: ‏ה-bridge ‏הקיים ‏של opfs-ux (boot.js:342) ‏מקודד `/mobile?vault=` → ‏שובר CF (‏entry ‏ב-`/`). ‏תוקן ל-relative ‏באותו slice (‏אותה משפחה).
- Bug 1 fix ‏אומת ‏ללא רגרסיה ל-server-vault resume (‏fallback ל-lastVaultId ‏כש-sel ‏קיים).

### ‏רעיונות שנדחו
- **‏interceptor ‏ברמת-mkdir** (‏לנתב no-vault mkdir ל-OPFS): ‏נדחה — ‏שביר (mkdir ‏גנרי); DOM-capture ‏על כפתור Create ‏ממוקד יותר.
- **‏absolute entry-path**: ‏נדחה — ‏שובר את ההפרדה המקומית desktop(`/`)/mobile(`/mobile`).
- fallback ל-new-local.html ‏נשמר ‏למקרה ש-DOM interception ‏שביר (‏executor ‏מחליט לפי spike).

---

## 2026-07-16 — epic mobile-first collapse: להפוך את המובייל לריצה היחידה, לארכב דסקטופ (החלטת המשתמשת)

### ‏רציונל
‏כל המומנטום (OPFS, folder-vault, ‏מסך-פתיחה נייטיב, LiveSync, layout-switcher) ‏על ריצת ה-**‏מובייל**.
‏הדסקטופ (`src/client`, `/`, `/starter`) ‏הוא המסלול הישן. ‏המשתמשת זיהתה ש-`/starter` "‏לא מוביל לשום מקום"
‏במובייל (‏cross-runtime dead-end: ‏מובייל→/starter ‏נחת על עמוד דסקטופ). ‏ההחלטה: collapse ‏למובייל-כ-ריצה-יחידה,
‏ולארכב את הדסקטופ. ‏באמצעות layout-switcher ‏אפשר UI ‏דסקטופי על ריצת המובייל → ‏הדסקטופ מיותר.

### ‏חסמים שהתגלו (‏למה זה epic ‏ולא מחיקה)
1. **‏Cloudflare ‏מבוסס-דסקטופ**: `build-assets.sh` ‏מעתיק `src/client` + `vendor/obsidian`. ‏ארכוב דסקטופ ‏שובר את CF ‏עד שמסבים אותו למובייל.
2. **‏מובייל טוען קוד מתיקיית דסקטופ**: `src/client-mobile/index.html` ‏טען `/client/local-vault-registry.js`.

### ‏רצף (3 slices, JIT)
1. **relocate-registry** — ‏`local-vault-registry.js` ‏הוא ‏בפועל **‏קוד-מובייל** (‏אומת: ‏הדסקטופ ‏לא צורך `__owLocalVaults` ‏בכלל) ‏שגר בתיקיית דסקטופ בטעות. ‏העברה לעץ המובייל → ‏מנתק את תלות המובייל ב-`/client/`. ‏אביגיל READY (‏סבב 1, 2 ‏findings ‏לא-חוסמים).
2. **cf-mobile** — ‏הסבת פריסת Cloudflare ‏לריצת מובייל.
3. **collapse-desktop** — ‏ארכוב `src/client` + `vendor/obsidian`, ‏הסרת route `/starter` ‏ופיצול `/mobile`, ‏הגשת מובייל ב-`/`.

### ‏ממצאי אביגיל (relocate-registry)
‏אומת: `__owLocalVaults` ‏נצרך רק ב-`src/client-mobile/` (9 ‏שימושים); ‏הדסקטופ נקי. ‏רק 2 ‏הפניות קוד חיות לנתיב הישן.
‏finding: CF `cp -r src/client` ‏מעתיק את הקובץ ‏אך ‏אף עמוד CF ‏לא מפנה אליו → ‏נושר מ-bundle ‏ללא שבירה (‏תועד ב-§7 ‏למניעת false-escalation).

### ‏רעיונות שנדחו
- **‏מחיקת דסקטופ מיידית**: ‏נדחה — ‏שובר CF + ‏תלות registry. ‏חייב רצף.
- **‏extract ל-`src/client-shared/`**: ‏נדחה — ‏אין קוד "‏משותף" ‏אמיתי; ‏ה-registry ‏מובייל-בלבד → ‏relocate ל-`src/client-mobile/` ‏פשוט יותר.

### ‏עדכון (2026-07-16) — slice 2 ‏פוצל, ‏ו-obsidian-mobile ‏עצמאי
- **‏פיצול cf-mobile → 2a-serve + 2b-seed** (JIT, ‏מורכבות): 2a ‏מגיש את ריצת המובייל static (OPFS ‏עובד); 2b ‏מוסיף seeding ‏static ‏של system-plugins + ‏קבצי-דוגמה + LiveSync-disabled. ‏הרצף גדל ל-4.
- **‏cf-mobile-serve ‏סופג+‏מחליף את cloudflare-deploy** (‏אושר ‏ע"י המשתמשת): CF static-only ‏על ריצת המובייל; ‏מוחקים את ה-branch cloudflare-deploy.
- **‏ממצא אביגיל קריטי ל-slice 4**: `vendor/obsidian-mobile` ‏**‏עצמאי לחלוטין** — ‏כולל worker.js (239KB), i18n (44 ‏קבצים), lib, sim.js ‏עותקים משלו. ‏(‏הבלבול: ‏השרת המקומי מגיש /i18n+/worker.js ‏מ-vendor/obsidian ‏— ‏אבל זו רק תצורת-שרת, ‏לא תלות-bundle.) ‏משמעות: **‏collapse-desktop (slice 4) ‏יכול לארכב את `vendor/obsidian` ‏בלי לשבור את המובייל.**

---

## 2026-07-16 — opfs-ux: לחווט את מסך-הפתיחה הנייטיב (‏לא chooser ‏משלנו) + ‏polyfill ‏בחירת-כספת

### ‏רציונל
‏ל-Obsidian mobile ‏יש **‏מסך-פתיחה נייטיב** (`.mobile-vault-chooser-screen`: Setup Sync / Create new vault /
Open folder as vault / ‏רשימת vaults). ‏spike ‏הוכיח שהוא **‏מתרנדר מלא** ‏אצלנו ‏אחרי עקיפת ה-redirect ל-/starter,
‏וכל ה-feature-flags (Dv/Nte) ‏כבר דלוקים. ‏במקום לבנות chooser ‏משלנו — ‏**‏מחווטים את הנייטיב**. ‏המניע: ‏פחות קוד-UI ‏לתחזק,
‏חוויית-משתמש זהה ל-Obsidian ‏אמיתי, ‏וה-storage-options ‏הנייטיביים ("Device storage"/"App storage") ‏ממפים 1:1
‏לשני ה-backends שלנו (folder/OPFS).

### ‏למה polyfill ‏ל-`Filesystem.choose()`
‏ה-"‏native select" ‏של בחירת-כספת (‏ה-folder picker ‏מאחורי "Open folder as vault"/"Device storage") ‏לא עובד בדפדפן —
‏הוא native ‏שאין לנו. ‏ה-polyfill: `HttpFilesystem.choose()` = `showDirectoryPicker()` (Chromium), ‏מחזיר את הצורה
‏שהנייטיב מצפה `{path, isRoot:false}`, ‏עם path ‏סינתטי (`__owfolder__/<id>`) ‏שֶ-`HttpFilesystem.stat` ‏מזהה כתיקייה.
‏reuse ‏מלא של folder-vault (`__owFolderHandles`, ‏registry `type:'folder'`).

### ‏ממצאי אביגיל (3 ‏סבבים, 5→3→0)
- **‏R1**: `injectMobileScripts()` ‏לא קיים — ‏ההזרקה for-loop ‏inline; `/api/vaults/list` ‏מחזיר object-map ‏לא array;
  choose/stat ‏חייבים לשבת ב-HttpFilesystem (‏no-vault → VAULT_TYPE='server').
- **‏R2**: ‏מיקום ההזרקה — ‏חייב guard #2 (:220) ‏**‏אחרי ה-shims** (66-217), ‏לא guard #1 (:55), ‏אחרת app.js ‏נטען ‏בלי `require`;
  ‏gate ‏של sel-fallback ‏עשה loop ‏ל-**server vaults** (‏ה-client registry ‏מחזיק רק local/folder).
- **‏R3**: READY.

### ‏שינויי-כיוון (‏לפי אביגיל)
1. ‏הזרקת המסך הנייטיב הועברה מ-guard #1 ל-**guard #2 (‏אחרי setup ‏ה-shims)** — ‏אחרת un-shimmed app.js.
2. ‏גישור בחירת-vault ‏מאמת מול **‏שני מקורות**: client-registry **‏או** `ow-known-vault-ids` (‏שֶ-seed ‏כותב, ‏כולל server) —
   ‏אחרת server-select ‏עושה loop ‏חזרה ל-chooser.
3. ‏**‏לא** ‏עושים `removeItem('mobile-selected-vault')` — ‏גרם לסתירה (‏הטריגר למסך הפך תמיד-false).

### ‏רעיונות שנדחו
- **‏chooser ‏משלנו** (new-local.html-‏style): ‏נדחה — ‏הנייטיב מתרנדר מלא, ‏אין סיבה לכפילות UI.
- **‏רישום server vaults ‏לתוך `__owLocalVaults`**: ‏נדחה לטובת `ow-known-vault-ids` ‏נפרד — ‏לא לזהם את ‏סמנטיקת ה-local-registry.
- **"Create new vault" intercept ‏מלא ב-v1**: ‏נדחה ל-§9 (‏executor ‏מחליט לפי מורכבות app.js create-flow; v1 ‏מתמקד ב-open-folder + list + selection).

---

## 2026-07-15 — OPFS-first: לנתק local-vaults מ-LiveSync, להוכיח OPFS עצמאית קודם (החלטת המשתמשת)

### רציונל
`local-vaults-implementation.md` סידר את LiveSync **ראשון** בכוונה — טיעון בטיחות-נתונים
("local vault בלי LiveSync = vault שאי-אפשר לברוח ממנו"). המשתמשת בחרה **להפוך** את הסדר:
להוכיח ש-OPFS מתפקד במלואו על המובייל, עם **שרת סטטי בלבד**, **לפני** חיבור LiveSync.
המניע: de-risking — לראות את מנוע האחסון עובד end-to-end לפני שמוסיפים את שכבת הסנכרון.

זה **re-scope, לא rewrite**: ליבת ה-OPFS בתכנון (Phases 1-3: OpfsStore, ניתוב, יצירת vault)
כבר מנותקת טכנית מ-LiveSync. LiveSync מופיע שם רק כ-(א) שער-כניסה ו-(ב) קריטריון-קבלה אחרון.
מסירים את השער; ה-DoD העצמאי = create local vault → write/read notes → תיקיות מקוננות →
binary round-trip → rename/delete/copy → reload persists → אפס רגרסיה ל-server vaults.

### שינויי-כיוון
- **מסירים תלות LiveSync** מ-local-vaults למילסטון הראשון. LiveSync יתחבר רק אחרי ש-OPFS ירוק.
- **נופלת מורכבות pitfall 6** (endpoint `vault=__system__` להגשת system-plugins לתוך OPFS):
  למילסטון הזה local vault רץ בלי system plugins (או שהם static). פחות קוד, פחות סיכון.
- **חלוקה ל-2 slices (JIT)**: `opfs-store` (מודול OPFS עצמאי, self-test בדפדפן) →
  `opfs-wire` (registry + ניתוב vault-type + dispatcher + יצירת vault מינימלית — "רואים את זה עובד").
  Phase 3 מלא (starter UI) + Phase 4 (wizard) + Phase 5 (docs) = slice שלישי אחר-כך.

### פשרה מקובלת (אישור מפורש של המשתמשת)
**עמידות**: local vault בלי LiveSync ובלי export = "Clear browsing data" אחד מאובדן מוחלט.
המשתמשת מקבלת זאת למילסטון-ההדגמה. גיבוי (LiveSync/export) יתווסף אחרי ש-OPFS יוכח.

### רעיונות שנדחו
- **slice אנכי אחד (OpfsStore+wiring יחד)** — נדחה: OpfsStore לבד ניתן לאימות עצמאי
  (self-test בדפדפן) בלי סיכוני האינטגרציה; חלוקה נותנת gate ביניים נקי.
- **פיבוט client-only מלא (בלי שרת)** — כבר נדחה ב-`future-direction-client-only.md`;
  per-vault הוא strictly more general. השרת הסטטי נשאר (bundle + assets).

## 2026-07-15 — OPFS milestone: הושלם **באמת** (UI מרונדר על OPFS) — 4 slices, 2 באגים שה-preview חשף

### מה קרה
בקשת המשתמשת "לראות preview שהכל רץ ב-OPFS" חשפה ש-2 האימותים הראשונים (opfs-store GO,
opfs-wire GO) היו **מוקדמים מדי** — הם אימתו את שכבת-הנתונים אבל **לא את ה-UI בפועל**, כי
`vendor/obsidian-mobile/` (bundle של Obsidian) היה חסר בסביבה. ברגע שהבאנו את ה-bundle
(`scripts/update-obsidian-mobile.js`) והרצנו render אמיתי — התגלו **2 באגים** שחסמו את פתיחת ה-vault:

1. **opfs-geturi-fix**: `OpfsStore.getUri({path:''})` זרק (אין טיפול בשורש); `rethrowAsEnoent` הדליף
   DOMException. Obsidian קורא getUri בשורש ב-vault-open. תוקן ב-OpfsStore (concern vault-relative).
2. **opfs-vault-path**: `OpfsStore` לא הסיר קידומת vaultId (Obsidian מקדים אותה לכל קריאה);
   `HttpFilesystem.fullPath` כן. תוקן ב-**dispatcher** (capacitor-shim, reuse fullPath) — לא ב-OpfsStore,
   כדי לשמור אותו נקי (vault-relative) ל-LiveSync העתידי. שתי חקירות עצמאיות + fix-simulation אישרו.

### תובנת-שיטה (קטגוריה-1, נרשמת ל-reports/patterns)
שני הבאגים = **אותו חור-כיסוי**: צורת הנתיב ש-Obsidian שולחת בפועל (vaultId-prefixed) מעולם לא נבדקה
— לא ב-unit tests, לא ב-self-test של OpfsStore (שבדק vault-relative + getUri-על-קובץ בלבד). "ירוק ≠ נכון".
**מטא-לקח**: אימות שכבת-נתונים בלי render אמיתי = GO מוקדם. visual/E2E render הוא חלק מ-DoD, לא nice-to-have.
ה-preview שהמשתמשת ביקשה הוא שתפס את זה — לפני merge.

### תוצאה סופית — אומת GO בדפדפן אמיתי
local vault נפתח ל-workspace מלא של Obsidian על OPFS: file-explorer מקונן (Notes/sub/hello, Projects/plan),
עורך עם note מקונן פתוח, 0 /api/fs, קבצים ב-vaults/<id>/... נכון. רגרסיה server תקינה.
screenshots: /tmp/verify/opfs-vault-path/calev-*.png.

### השרשרת למיזוג (לינארית, 4 slices)
opfs-store → opfs-wire → opfs-geturi-fix → opfs-vault-path. כולן אומתו READY→GO.

## 2026-07-15 — OPFS milestone (opfs-store + opfs-wire): הושלם ואומת GO, מגבלות ידועות

### רציונל
מילסטון "OPFS מתפקד במלואו על המובייל, עצמאי מ-LiveSync" (ראה החלטת OPFS-first לעיל) מומש
בשני slices משורשרים:
- **opfs-store** — מודול `src/client-mobile/storage/opfs-store.js`, כל 23 מתודות ה-Filesystem על OPFS.
  אביגיל READY (סבב 2), כלב GO (11/11, אימות Firefox אמיתי, כל 5 אסרשני flat-list PASS).
- **opfs-wire** — dispatcher HTTP↔OPFS ב-capacitor-shim (Proxy עם bind), registry ב-localStorage,
  ניתוב vault-type + דילוג bootstrap ב-boot, עמוד יצירה מינימלי. אביגיל READY (סבב 2),
  כלב-heavy GO (9/9, אפס רגרסיות ל-server vaults, Proxy/bind/bootstrap-skip אומתו על OPFS אמיתי).

### מגבלות ידועות (מתועדות, לא-חוסמות — נרשמות ל-slices הבאים)
- **F1 (opfs-ux / attachment story)**: `cap.convertFileSrc` (capacitor-shim.js) מחזיר תמיד HTTP
  `/api/fs/read` URL, לא מסתעף על `__owVaultType`. ל-local vault, attachments בינאריים גדולים
  (תמונות/PDF דרך `<img src>`) יפגעו בשרת במקום OPFS → attachment שבור. **core note editing לא מושפע**
  (הולך דרך ה-Proxy readFile). הסינכרוניות של convertFileSrc מול async getUri הופכת את התיקון
  ללא-טריוויאלי — ולכן נדחה מפורשות ל-opfs-ux/attachments, לא תוקן ב-opfs-wire (מחוץ ל-§2 scope).
- **F2 (מגבלת סביבת-אימות, לא defect)**: `vendor/obsidian-mobile/` לא-מוותר בסביבת כלב → render מלא
  של ה-file-explorer UI דרך אפליקציית Obsidian לא נבדק. **כל מה שהסלייס שינה אומת בדפדפן אמיתי על
  OPFS אמיתי** (dispatcher, wiring, flat-list contract, bootstrap-skip, bind). נדרש אימות ויזואלי
  אחד של ה-DOM כש-`vendor/obsidian-mobile/` נוכח (`scripts/update-obsidian-mobile.js`).

### נדחה במפורש ל-slices הבאים
- **opfs-ux**: starter UI מלא (מיזוג לרשימת Obsidian), setup wizard, guard ל-desktop
  `/?vault=<local-id>`, מחיקת OPFS ב-registry.remove, תיקון F1, **תיקון F3** (new-local.html
  מאפשר שם ריק → "Untitled"; ולידציה), docs.

### אימות ויזואלי חסר (לפני sign-off אנושי)
כלב אימת הכל בדפדפן אמיתי על OPFS אמיתי, אך ה-render של ה-file-explorer דרך אפליקציית Obsidian
לא נבדק כי `vendor/obsidian-mobile/` חסר בסביבה (app.js → 404, בשני הנתיבים). להבאת ה-bundle:
`node scripts/update-obsidian-mobile.js`, ואז פתיחת local vault בדפדפן ואימות ויזואלי של תיקייה מקוננת.
- **system-plugins ב-local vault** (layout switcher) + **LiveSync** — אחרי שה-OPFS מוכח ומאושר.

### פשרת עמידות (ממשיכה מהחלטת OPFS-first)
local vault עדיין בלי גיבוי עד ש-LiveSync יחובר — פשרה מקובלת למילסטון-ההדגמה.

## 2026-06-13 — PR #9 shims: opt-in דרך env var, לא ברירת-מחדל (החלטת המשתמשת)

> החלטה צופה-קדימה. נאכפת בסלייס **client-wiring** העתידי (שם יש לה שיניים), לא ב-server-shims הנוכחי. נכתבה כאן כדי לכוון את ה-brief של client-wiring כשייכתב.

### ‏רציונל
ה-shims של PR #9 שמשרתים את ion-sync על HTTP — keytar צד-שרת (`api/keytar.js`),
localStorage מגובה-שרת (`api/localstorage.js` + client `remote-localstorage.js`),
וה-polyfill של `crypto.subtle` ב-`boot.js` — **חייבים להיות opt-in דרך environment
variable, לא ברירת-מחדל**.

ב-fork הם נדלקים אוטומטית: keytar/localStorage תמיד מחווטים בגרסת web, וה-crypto
polyfill מותקן כש-`crypto.subtle` חסר — כלומר על כל חיבור HTTP לא-מאובטח
(`boot.js:36`: `if (typeof crypto !== 'undefined' && !crypto.subtle)`, בלי gate).
הבעיה: keytar/localStorage שומרים סודות/טוקנים כ-**plaintext JSON** תחת `user-data/`
(`api/keytar.js` כותב `.keychain.json`; `api/localstorage.js` כותב `.localstorage.json`
שמחזיק את טוקני ה-safeStorage שמצביעים לסודות). זו הורדה ממאובטחות keychain של ה-OS
לקובץ-טקסט-בדיסק. המשתמשת לא רוצה שהתנהגות הזו תידלק לכולם בשקט — מי שמפעיל אותה
צריך לבחור בה במודע.

### ‏איפה זה נאכף (לכוון את ה-brief של client-wiring)
- ה-gate שייך לסלייס **client-wiring** העתידי — שם יש לו שיניים: gating של `boot.js`
  מהזרקת ה-shims וה-polyfill. ה-env var הוא server-side, ולכן צריך לחשוף אותו לקליינט
  (למשל דרך תשובת ה-bootstrap) כדי ש-`boot.js` ידע אם להתקין.
- שקול לעטוף גם את **רישום ה-routes בשרת** מאחורי אותו דגל — כך שכשהדגל כבוי,
  ה-endpoints אפילו לא קיימים (defence in depth), לא רק שהקליינט לא קורא להם.
- **בחירת שם הדגל וברירת-המחדל (off)** הם החלטת ה-brief של client-wiring.

### ‏למה לא עכשיו (server-shims)
הסלייס הנוכחי `server-shims` מוסיף **רק** את שלושת ה-endpoints, inert בלי client
wiring — אף קליינט לא קורא להם, ה-polyfill לא מוזרק, שום סוד לא נכתב בפועל בזרימה
אמיתית. לכן **אין צורך ב-gate עדיין**, וזו הסיבה ש-server-shims נשאר נקי ופשוט
(complexity 3). הוספת ה-gate ל-server-shims הייתה מקדימה תלות שאין לה צרכן —
היא שייכת לסלייס שבו ה-shims מתחברים בפועל לקליינט.

### ‏רעיונות שנדחו
- **להדליק ברירת-מחדל ולתעד אזהרה** — נדחה: התנהגות בשקט עם סודות plaintext היא בדיוק
  מה שהמשתמשת לא רוצה. opt-in מפורש.
- **gate ב-server-shims הנוכחי** — נדחה: אין צרכן, מקדים תלות. שייך ל-client-wiring.

## 2026-06-13 — server-shims: ‏חילוץ נקי ראשון מ-PR #9

### ‏רציונל
PR #9 ‏(fork ‏חיצוני s39n, 39 ‏קבצים) ‏לא ניתן למיזוג as-is: ‏`index.js` ‏ו-`config.js` ‏בו **‏חתוכים פיזית** ‏ב-PR head,
‏יש רגרסיה (`warmUpBootstrapCache` ‏יובא אך לא נקרא, ‏ארגומנט `bootstrap` ‏הוסר מ-`createBootstrapRouter`),
‏וקונפליקט מול main ‏ב-electron.js (‏חופף לתיקון clipboard-recursion ‏של #8). ‏ההחלטה: ‏לפצל ל-slices ‏דרך הזרימה הרגילה.
‏הסלייס הראשון הוא **‏החילוץ הנקי**: ‏שלושת ה-routers ‏העצמאיים שאין להם תלות בשום רכיב אחר ב-PR —
keytar (keychain ‏צד-שרת), localstorage (server-backed), pbkdf2 (‏key derivation native). ‏כל אחד מקבל רק `userDataPath`.
‏בחרנו אותם ראשונים כי הם greenfield, ‏בלי call sites, ‏בלי תלויות חדשות, ‏ובלי קונפליקט מול main.

### ‏ממצאי אביגיל
verdict=READY (‏חריג — track record ‏של "תמיד יש בעיה" ‏לא התממש, ‏כי זה חילוץ as-is ‏של קוד שעבר ב-PR ‏אמיתי).
‏כל 8 ה-spot-checks ‏עברו: ‏anchors ‏ב-index.js/config.js ‏תואמים main ‏מילה-במילה, ‏הקבצים ב-pr9-ref ‏שלמים,
‏הטענה ש-index.js/config.js ‏חתוכים — ‏אומתה, baseline 15/15. ‏שני minor ‏ירוקים בלבד (‏ניסוח §6 ‏תוקן).

### ‏שינויי-כיוון
‏וקטור הבדיקה ל-pbkdf2 ‏שכתבתי בתחילה (`0c60c80f...`) ‏היה שגוי — ‏זה וקטור RFC-6070 ‏ל-SHA**1**.
‏הערך הנכון ל-HMAC-SHA256 ‏הוא `65acafe9655d154ebe7ca04e8b7ebdbc2bfd1684` (‏אומת מקומית עם `crypto.pbkdf2`). ‏תוקן ב-brief.

### ‏רעיונות שנדחו
- **‏מיזוג ה-PR כמו שהוא** — ‏נדחה: ‏קבצים חתוכים + ‏רגרסיה + ‏קונפליקט. ‏לא בר-מיזוג.
- **‏לכלול auth (TOTP) ‏בחילוץ הראשון** — ‏נדחה: auth ‏דורש תלויות חדשות (otplib, qrcode), ‏rate-limiting, sessions, ‏ווקטור אבטחה. ‏לא "נקי". ‏slice ‏נפרד.
- **‏לכלול vault-registry path-guard ‏או MIME/mkdirRepair** — ‏נדחה: ‏הם נוגעים בקוד קיים (‏לא greenfield). ‏slice ‏נפרד.
- **‏לחלץ index.js/config.js ‏מ-pr9-ref** — ‏נדחה מפורשות: ‏חתוכים פיזית. ה-wiring ‏ידני על גבי main.

## 2026-06-13 — server-bootstrap-perf: ‏invalidation ‏כירורגי + threadpool ‏רחב

### ‏רציונל
‏ה-bootstrap cache ‏היה ‏"לפעמים ‏איטי ‏מאוד". ‏מדידה ‏אמפירית ‏על ‏ה-vault ‏הגדול
(vault גדול על מאונט **rclone/FUSE איטי**, ~104 תיקיות + 450 ‏קבצי
‏טקסט) ‏הראתה: ‏cold full build ‏לוקח **~37s @ threadpool=4** ‏(latency-bound),
‏ו-compression/stringify ‏זניחים (~0.5s ‏יחד). ‏שני ‏שורשים:
1. **‏כל ‏mutation ‏מוחק ‏את ‏כל ‏ה-cache** (`serverCache.delete(vaultId)`) → ‏ה-bootstrap
   ‏הבא ‏הוא ‏full re-scan. ‏Obsidian ‏שומר ‏בתכיפות (workspace.json, notes) → ‏misses ‏תכופים.
2. **‏ה-"incremental" ‏שמובטח ‏בהערות ‏לא ‏ממומש** — `changedDirs` ‏מחושב ‏ונזרק.
‏בנוסף, ‏ה-libuv threadpool ‏נשאר 4, ‏מה ‏שמסדר ‏מאות ‏פעולות-Drive ‏4-בכל-רגע.

‏הגישה: (Phase 1) ‏להגדיל `UV_THREADPOOL_SIZE` ‏כדי ‏להסתיר ‏latency; (Phase 2)
‏invalidation ‏כירורגי ‏ברמת-רשומה ‏במקום ‏nuke-all; (Phase 3) ‏incremental rebuild
‏ל-`changedDirs` ‏כרשת-ביטחון ‏ל-restart / ‏שינוי-חיצוני. ‏הצרכן (shims) ‏מקבל ‏אותו
‏payload ‏בדיוק — slice ‏ביצועי, ‏לא ‏שינוי-contract.

### ‏ממצאי אביגיל
‏סבב 1: **USABLE-AFTER-FIX, 7 ‏ממצאים** (2 🔴). ‏הקריטי: ‏ההנחה ‏"כל ‏הכתיבות
‏עוברות ‏דרך `/api/fs`" ‏שגויה — `api/electron.js:/trash` ‏הוא ‏נתיב-מחיקה ‏שני ‏עם
‏עותק invalidation ‏משלו. ‏שאר ‏הממצאים: ‏אין helper abs→rel (‏ולא ‏צריך, relPath ‏מ-req),
‏אי-עקביות ‏שמות, ‏ניסוח ‏line-numbers ‏של Commit 2, race-key ‏של pendingBuilds, ‏write-coalesce.
‏סבב 2: ‏אחרי ‏תיקון — **READY, 0 ‏ממצאים**.

### ‏שינויי-כיוון
‏Phase 2 ‏שונה ‏מ"להוסיף invalidation" ‏ל"להפוך ‏את ‏ה-invalidation ‏הקיים ‏(בשני ‏הקבצים,
‏fs.js + electron.js) ‏מ-nuke ‏ל-surgical". ‏באג ‏ה-stale-on-edit ‏שחשדנו ‏בו ‏התברר ‏כלא-קיים
‏לכתיבות-אפליקציה (‏כי ‏ה-delete-all ‏מנקה ‏הכל) — ‏רלוונטי ‏רק ‏לשינוי ‏חיצוני, ‏שמכוסה ‏ב-Phase 3.

### ‏רעיונות שנדחו
- **watcher-driven invalidation** (chokidar → cache): ‏נדחה — ‏כל ‏הכתיבות ‏עוברות ‏דרך ‏השרת
  (fs.js + electron.js), ‏אז ‏write-path ‏invalidation ‏מדויק ‏וזול ‏יותר; ‏polling ‏על rclone ‏יקר.
- **rclone VFS tuning** (`--vfs-cache-mode`): ‏host-managed (Proxmox), ‏מחוץ ‏לריפו — ‏לא ‏בקוד.

## 2026-06-13 — livesync-requesturl (Slice A): App.requestUrl

### ‏רציונל
‏אינטגרציית LiveSync (vrtmrz/obsidian-livesync) ‏מתחילה ‏מ-`App.requestUrl` — ‏היום stub.
‏פוצל ל-3 slices: A (requestUrl, `[]`), B (install-livesync.js, `[]`, מקבילי), C (E2E+docs, `[A,B]`).
‏A ‏ראשון ‏כי ‏הוא ‏הבסיס ‏לכל ‏השאר ‏וה-מסוכן ‏ביותר (base64 round-trip ‏לבינארי).
‏אסטרטגיה: fetch ‏ישיר + CORS (‏proxy ‏נדחה ‏מפורשות ב-PLAN.md). ‏מבוסס ‏על ‏תוכנית
`livesync-implementation.md` (11/5) ‏שמעודכנת ‏ל-layout ‏אחרי ה-reorg.

### ‏ממצאי אביגיל
READY ‏ישר (0 ‏חוסמים). 2 ‏nits: (1) Content-Type guard ‏לא ‏case-insensitive — ‏הוטמע;
(2) ה-offsets ‏ב-livesync-implementation.md ‏מצביעים ‏על ‏menu defs ‏לא ‏requestUrl (‏הקוד ‏האמיתי
‏ב-byte 1089452) — ‏אבל ‏החוזה ‏עצמו (body ‏עובר atob ‏ללא-תנאי) ‏אומת.

### ‏שינויי-כיוון
‏reuse ‏של ‏דפוס ה-base64 ‏המקוטע ‏הקיים ‏ב-Filesystem (‏שורות 188-213) ‏במקום ‏מימוש ‏חדש —
‏מונע ‏את ‏מלכודת btoa-on-large ‏ושומר ‏עקביות.

### ‏רעיונות שנדחו
- ‏מימוש `CapacitorHttp.request` ‏ספקולטיבי — ‏רק ‏אם ‏פלאגין ‏באמת ‏קורא ‏לו.
- ‏טיפול ב-`_changes?feed=continuous` ‏(stream ‏אינסופי) — ‏מחוץ ל-scope; ‏אם ‏עולה ‏ב-Slice C → ‏plan ‏נפרד.

## 2026-06-13 — livesync-install (Slice B): vendor/plugins overlay + install script

### ‏רציונל
‏פלאגיני ‏צד-שלישי (LiveSync) ‏לא ‏שייכים ‏לא ‏לגיט (‏הם ‏הורדות) ‏ולא ‏לכספת (‏הם ‏client-side).
‏החלטה: ‏תיקיית ‏ייעודית `vendor/plugins/` (‏gitignored ‏תחת `vendor/` ‏הקיים, regenerated ‏ע"י סקריפט),
‏לצד `src/plugins/` (‏הקוד ‏שלנו, tracked). ‏ה-overlay ‏סורק ‏את ‏שתיהן. `install-livesync.js` ‏מודל ‏על
`update-obsidian-mobile.js`.

### ‏ממצאי אביגיל
‏סבב 1: USABLE-AFTER-FIX, 3 ‏ממצאים. ‏הקריטי (🔴): `Map.set` ‏נאיבי ‏בסדר ‏src→vendor ‏נותן ‏ל-vendor
‏לדרוס ‏את ‏src — ‏הפוך ‏מה"src ‏מנצח" ‏שהוצהר. ‏תוקן ל-first-wins ‏מפורש (`has` ‏guard).
‏עוד: (א) `fs.js:253` ‏משתמש ‏ב-`SYSTEM_PLUGINS_DIR` ‏הקבוע — ‏חייב resolver ‏פר-id (‏getSystemPluginDir);
(ב) ‏ייבוא ‏מת ‏פוטנציאלי ‏ב-fs.js; (ג) ‏טסט ‏overlay ‏חדש ‏(לא ‏קיים). ‏סבב 2: READY, 0 ‏ממצאים.

### ‏שינויי-כיוון
`SYSTEM_PLUGIN_IDS` (Set) → `Map<id, rootDir>` ‏כדי ‏לדעת ‏מאיזו ‏תיקייה ‏בא ‏כל id (‏נדרש ‏לפתרון ‏נתיב ‏נכון
‏אחרי ‏הוספת ‏התיקייה ‏השנייה).

### ‏רעיונות שנדחו
- ‏לקמט ‏את ‏הפלאגין ‏לגיט (vendor-in-repo) — ‏נדחה ‏לטובת gitignored+regenerate, ‏עקבי ‏עם `vendor/`.
- `SYSTEM_PLUGINS` env-var gating — future (PLAN.md), ‏לא ‏חוסם.

## 2026-07-17 — cf-mobile-seed: static seed (system-plugins + קבצי-דוגמה) ללא שרת

### רציונל
serverless שלב 1/4. על CF static אין /api/system-plugins → layout-switcher לא seeded וה-demo ריק. הסלייס סוגר זאת ללא שרת: build-time bundle של system-plugins + example-vault.json, ו-client fallback static.

### הכרעות + ממצאי אביגיל (2 סבבים, 5→0)
- **finding 1 (🔴)**: template.js TEMPLATE_FILES כולל .obsidian/community-plugins.json (dataview/templater) שדורס את ה-system-plugin seed (layout-switcher) ומפעיל plugins לא-bundled. → **seedExampleVault מדלג על כל `.obsidian/`** (רק תוכן Welcome/Features); ה-config בבלעדיות seedSystemPlugins.
- **orphan import (cf-mobile finding 2)**: template.js מייבא plugins-generated.js שנזרק → stub Map ריק ב-build. עובד תחת Bun; Node אמיתי צריך json-fallback (מתועד).
- static fallback ב-seed-system-plugins.js: רק כש-/api מחזיר null → מקומי ללא רגרסיה.

### רעיונות שנדחו
- **merge ל-community-plugins.json** (במקום skip): נדחה — עדיין מביא dataview/templater הלא-bundled → load-errors.
- **preview mode ל-Welcome** (זריעת app.json): follow-up — v1 נפתח ב-edit.

## 2026-07-17 — cf-worker-proxy: פורט ה-proxy ל-Cloudflare Worker route (serverless שלב 2/4)

### רציונל
serverless שלב 2/4. על CF static /api/proxy-request מחזיר 501 → community-plugins לא נטענים (GitHub/obsidian ללא CORS). הסלייס מפעיל את הפרוקסי כ-Worker route (edge — serverless אמיתי) עם Cache API.

### הכרעות + ממצאי אביגיל (2 סבבים, 6→0)
- **base64 (🔴)**: אין Buffer ב-Worker, ו-btoa מקבל binary-string בלבד → bytesToB64 chunked (String.fromCharCode על subarray) במקום btoa על ArrayBuffer.
- **error (🔴)**: try/catch→502 סביב fetch (שומר חוזה-שגיאה של proxy.js; ה-shim עושה if(!ok) throw).
- **SSRF**: redirect:'manual' + isAllowed כל hop (זהה proxy.js), לא redirect:'follow'.
- **Cache workers.dev**: caches.default no-op על *.workers.dev → cache דורש route/custom-domain (מתועד). על workers.dev הפרוקסי עובד ללא cache (פונקציונלי; cache=אופטימיזציה).
- החוזה client↔worker↔proxy אומת מדויק (capacitor-shim.js:732-740).

### רעיונות שנדחו
- **rate-limit עכשיו**: follow-up — דורש KV binding; Cache כבר מוריד ~90% מהעומס.
- **cache ל-api.github lists**: לא — רק תוכן-קבצים immutable (raw.githubusercontent/release-assets).

## 2026-07-17 — cf-preinstall-livesync: LiveSync מותקן-מכובה + סיווג slice 3 (direct-sync כבר קיים)

### רציונל
serverless שלב 4/4 (הגמר). LiveSync מגיע בפריסת CF מותקן-מראש אבל מכובה — המשתמש מפעיל בעצמו (ואז מגדיר CouchDB). דרישת המשתמשת המפורשת.

### slice 3 (livesync-cors-direct) — לא נדרש קוד
חקירה: capacitor-shim.js:721-726 selective-proxy מנתב **רק** github/githubusercontent/obsidian.md לפרוקסי; **כל השאר — כולל CouchDB/LiveSync — direct fetch**. ההערה בקוד: "the server is never in the sync data path". כלומר LiveSync כבר מסנכרן ישירות ל-CouchDB ללא שרת. הדרישה היחידה: CORS מופעל ב-CouchDB (קונפיג צד-CouchDB, לא קוד).

### מנגנון (0 שינוי client)
seed-system-plugins.js:39-58 כבר תומך ב-enabled:false — seeds את הקבצים ל-.obsidian/plugins/<id>/ (מותקן) אבל לא מוסיף ל-community-plugins.json (מכובה). slice 4 = רק build-assets: הורדת LiveSync (scripts/install-livesync.js מ-vrtmrz/obsidian-livesync) + manifest עם 2 plugins (layout enabled, livesync disabled).

### ממצאי אביגיל (2 סבבים, 5→0)
5 באגי-bash: set -e מפיל build על offline (→ if/then בולע exit), env לא מיוצא ל-node -e (→ inline), set -u init, cp מפורש (מדלג data.json), שמות-משתנים.

### follow-ups מתועדים (החלטת המשתמשת)
- Service Worker ל-offline + asset-cache (טעינה מהירה) — slice 5.
- פריסת CF ניסיונית (לא ראשית) — אחרי slice 5.
- rate-limit לפרוקסי נגד abuse — plan-להמשך, לא עכשיו.

## 2026-07-17 — service-worker-offline: Service Worker ל-offline + cache (בקשת המשתמשת)

### רציונל
SW ל-(א) offline ו-(ב) cache של assets → טעינה מהירה (לא מוריד הכול כל פעם). שימושי מקומי + CF.

### הכרעה: cache ממוספר-build (לא SWR)
ממצא אביגיל 🔴: `?v=` bust קיים רק על /client-mobile/*; /obsidian-mobile/* + worker.js + i18n **ללא bust** → SWR היה מקבע אותם. ובעיה חמורה: worker.js ישן מול app.js טרי → metadata-indexer נתקע לנצח.
פתרון: **CACHE='ow-sw-'+BUILD_ID** (מוזרק: CF sed מ-BUST, מקומי server מ-clientCacheBust). deploy חדש = cache חדש = כל ה-assets (מבוסטים או לא) טרי. worker.js/sim.js → network-first (insurance ל-indexer). cache-first לשאר (מהיר). /api/ network-only, cross-origin pass-through.

### רעיונות שנדחו
- **SWR**: נדחה — מקבע assets לא-מבוסטים.
- **precache מלא של ה-bundle**: נדחה — first-load איטי; cache-first ממלא לפי צריכה.

## 2026-07-18 — url-routing: ניתוב path-based (/starter + /vault/<id>) במקום ?vault=

### רציונל
המשתמשת בחרה מפורשות ניתוב URL מלא מבוסס-path, אחרי שקילת שתי חלופות:
`/starter` = מסך-בחירה אמיתי; `/vault/<id>` = כספת פתוחה (URL גלוי, ניתן-לשיתוף/סימניה);
`/` = entry עם הפניה חכמה (כספת-אחרונה → /vault/<id>, אחרת → /starter).
זה מחליף את שכבת ה-?vault= שהיתה נמחקת מיד מה-URL, ומשקם את /starter (שהיה 302→/ שבור-בפועל
כי boot עשה auto-resume מ-mobile-selected-vault). התוצאה קוהרנטית ומפשטת מעקפים קיימים.

### חלופה שנשקלה ונדחתה: "נייטיבי-מלא" (localStorage כמקור-אמת, בלי URL)
נשקל כי הוא הכי-קרוב-למקור והכי-מעט-קוד (הנייטיב אין לו URL כלל; mobile-selected-vault
מקור-האמת; close/switch עובדים נייטיבית). נדחה ע"י המשתמשת — היא מעדיפה URL שמיש-לשיתוף
על-פני מינימום-קוד, גם במחיר יותר interception.

### ממצאי אביגיל (3 סבבים, 5→2→0 → READY)
- 🟡 sub-path קלאסי (אומת): הבאנדל טוען `new Worker("worker.js")` **יחסי** → תחת /vault/<id>
  זה /vault/worker.js (404 → אינדקסר מת). פתרון: `<base href="/">` ב-index.html.
- 🟡 CF SPA-fallback: `env.ASSETS.fetch('/index.html')` עלול 307→/ (html_handling) ולאבד את
  ה-id. תוקן ל-`new URL('/', url)` (מחזיר shell 200, URL נשאר). אביגיל אימתה: 200 לא 307.
- 🟡 סתירת מודל-deploy: תיקון-CF ראשוני הצהיר Pages בעוד repo אומר Workers. פוצח ע"י הבחנה
  ארכיטקטונית — עריכת index.js **model-agnostic** (עובדת בשני המודלים); deploy לחי = פעולת-ops
  של מרדכי (כמו merge), לא של אליעזר. פיוס הקונפיג repo↔live = חוב-ידוע, slice עתידי נפרד.
- אביגיל אימתה מפורשות: היירוט על localStorage.setItem מותקן היום רק בענף no-vault → חובה
  להרחיבו למעבר-מיד-סשן (אחרת switch רץ נייטיבית → reload ל-/ במקום /vault/<newid>).

### שינויי-כיוון
תחילה כמעט בנינו את ההפך (slice "?vault= גלוי" שמרחיב את השכבה); אחרי דיון על קרוב-למקור
המשתמשת בחרה דווקא את הכיוון המלא (path-routing), ולא את הצמצום-לנייטיב.

## 2026-07-18 — vault-note-deeplink: deep-link דו-כיווני לרמת-מסמך /vault/<id>/<note>

### רציונל
המשך ישיר ל-url-routing. אחרי ש-/vault/<id> פותח כספת, המשתמשת רוצה URL אמיתי למסמך
(דוגמה: /vault/dada5a07f3ba500f/Features/Tags). דו-כיווני: URL→פותח מסמך, וניווט בין
מסמכים→ה-URL מתעדכן ("העתק כתובת = שתף מסמך"). עקבי עם מודל ה-URL-כמקור-אמת של הכספות.

### החלטות-עיצוב (נעולות ע"י המשתמשת)
- דו-כיווני (לא נכנס-בלבד).
- md בלי סיומת, כל שאר הקבצים עם סיומת — אידיומטי ל-Obsidian; getFirstLinkpathDest(md)
  + fallback getAbstractFileByPath(עם-סיומת) מטפלים בשניהם. קבצים לא-md (תמונה/PDF) בתוך scope.
- נבנה מ-dev אחרי מיזוג url-routing (המשתמשת: "קודם מיזוג").

### למה קטן
שתי השכבות הקשות כבר עשויות ב-url-routing: CF Worker (startsWith('/vault/') תופס נתיב עמוק)
ו-<base href="/"> (assets אבסולוטיים תחת נתיב עמוק). נשאר boot.js + wildcard /vault/:id/* בשרת.

### ממצאי אביגיל (2 סבבים, 4→0 מהותיים → READY)
- 🟡 DoD#5 (URL חוזר ל-/vault/<id> בסגירת מסמך): file-open(null) לא מובטח בסגירה. תוקן —
  הכיוון-יוצא קורא getActiveFile() כמקור-אמת ורושם גם על active-leaf-change (יורה במעבר
  ל-leaf ריק → getActiveFile()=null → URL חוזר). שני האירועים קיימים בבאנדל.
- 🟡 מיקום ה-hook היוצא: אם גלובלי → /vault/ ריק ב-flow no-vault. תוקן — בבלוק vault-open
  בלבד + if(!VAULT_ID)return.
- אביגיל אישרה: regex ([^/]+)(?:/(.*))? מפריד id מ-note-path נכון ולא שובר /vault/<id> הקיים;
  Express-4 /vault/:id/* תופס רב-סגמנטי; אין לולאה מבנית (replaceState בלי reload).

### סטטוס
brief READY ו-committed ל-dev. ביצוע מושהה לבקשת המשתמשת ("רוץ, אבל לא לבצע") — ממתין לאור-ירוק ל-dispatch.

---

## 2026-07-18 — sync-direction: לא לרדוף אחרי Obsidian Sync הרשמי — CouchDB/LiveSync הוא המסלול (מחקר)

> **סוג**: החלטת-כיוון ממחקר (לא slice). ‏שאלת המשתמשת: "לחקור את ה-API של סנכרון אובסידיאן, אולי נשתמש בו?"

### רציונל
‏בדקנו האם ה-**Obsidian Sync הרשמי** (השירות בתשלום) חושף API שאפשר לחבר אליו את obsidian-web. ‏המסקנה: **לא**. ‏להישאר על **CouchDB/LiveSync** — ‏הכיוון שכבר בבנייה (`livesync-*`, `cf-preinstall-livesync`).

### ממצאים
- **אין API ציבורי/מתועד** ל-Obsidian Sync. ‏השירות פנימי לאפליקציות הרשמיות בלבד. (Local REST API ‏הקהילתי מדבר עם אפליקציה מקומית, ‏לא עם ה-backend של Sync.)
- **הפרוטוקול הונדס-לאחור בלבד**: ‏קליינט מדבר מול `api.obsidian.md` ‏מעל WebSockets, ‏E2E, ‏auth ‏מבוסס-חשבון. ‏מימושים: `acheong08/obi-sync`, `zyrouge/rev-obsidian-sync`, ‏ועוד — ‏כולם **שבירים ונטושים**. Obsidian **שברה בכוונה** קליינטים כאלה מגרסה **1.4.11**.
- **ToS אוסר** disassemble/reverse-engineer (‏חריג צר רק לתוספים לא-מסחריים — ‏מימוש-חוזר של האפליקציה נופל מחוץ לו). Sync ‏**מגודר-בחשבון ובתשלום** — ‏כל משתמש היה צריך מנוי משלו.
- **דפדפן = הקליינט הכי גרוע להתחזות** לדסקטופ (CORS/TLS/app-identity).
- **האלטרנטיבה (LiveSync/CouchDB)** מתועדת, CORS-native (PouchDB), ‏מוכחת באקוסיסטם — ‏המסלול הריאלי, ‏וכבר אצלנו (Slice A `App.requestUrl` + ‏Slice B ‏install ‏מוזגו; `cf-preinstall-livesync` ‏הושלם, ‏ממתין למיזוג בשרשרת serverless).

### רעיונות שנדחו
- **Sync רשמי דרך shim ל-`api.obsidian.md`** — ‏נדחה: ‏עוין, ‏שביר (‏נשבר יזום ע"י הספק), ‏ToS, ‏מנוי-לכל-משתמש.
- **שרתי Sync מהונדסים-לאחור בשרת-עצמי** — ‏רק כחומר-עיון, ‏לא בסיס (‏נטושים, ‏מאורכבים, ‏ToS-adjacent).

### מקורות
obsidian.md/terms · forum.obsidian.md/t/25371 · github.com/acheong08/obi-sync · news.ycombinator.com/item?id=44768641 · github.com/vrtmrz/obsidian-livesync

---

## 2026-07-18 — layout-plugin-taxonomy: להשאיר את obsidian-web-layout כ-community (seeded+self-heal), לא core-plugin

> **סוג**: החלטת-היתכנות (לא slice). ‏שאלת המשתמשת: "האם אפשר להפוך את התוסף שלנו לתוסף מערכת?" ‏המשתמשת הבחינה נכון שהיום הוא **תוסף קהילתי** (‏ברשימת המותקנים, ‏עם כפתור מחיקה/טוגל), ‏לא מערכת.

### רציונל
‏הכרעה: **לא** ‏להפוך את `obsidian-web-layout` ‏ל-core plugin אמיתי. ‏העלות/סיכון לא מצדיקים; ‏התוצאה הרצויה ("‏לא ניתן למחיקה בטעות") ‏מושגת זול יותר. ‏המשתמשת: "‏אז לא חשוב — ‏נמשיך עם מה שיש".

### ממצאים (מבנה הבנדל)
- **הקוד של core plugins צרוב ב-vendor bundle** (‏`canvas` 343x, ‏`backlink` 124x, ‏`file-explorer` 31x — ‏מחלקות inline ב-`app.js`). ‏הקוד שלנו **חיצוני** (`.obsidian/plugins/obsidian-web-layout/main.js`).
- ‏יש registry ריצה `app.internalPlugins.plugins` (+`getPluginById`, `enablePluginAndSave`) ‏ומניפסט-רישום מרוכז (~byte 1080625) — ‏אבל core plugins **‏לא נטענים מדיסק**, ‏אלא נבנים מהבנדל.
- ‏לכן core אמיתי ‏= ‏(1) patch-בנדל ‏להזרקת רישום (‏minified → ‏שביר, ‏נשבר בעדכונים) ‏או ‏(2) ‏הזרקת-ריצה ל-`internalPlugins.plugins` (‏hacky, ‏ה-UI ‏של Core-plugins ‏נבנה מהמניפסט הצרוב → ‏אולי לא יופיע/יישמר). **‏Complexity 7-8, ‏נוגד "‏לא לגעת ב-vendor".**

### מה שכבר קיים (‏self-heal — ‏תכונה "‏מערכתית" ‏שכבר יש)
- ‏ה-marker `.ow-seeded-version` ‏יושב **‏בתוך תיקיית התוסף** (`seed-system-plugins.js:35`). ‏מחיקת התוסף ‏מוחקת גם את ה-marker → ‏ה-boot ‏הבא **‏מזריע מחדש**; ‏ו-`community-plugins.json` ‏ממוזג-union → **‏מופעל מחדש**. ‏כלומר **‏מחיקה/כיבוי מתבטלים ב-reload**.

### רעיונות שנדחו / ‏נדחו-לעת-עתה
- **(ב) core-plugin אמיתי** (patch-בנדל) — ‏נדחה: ‏7-8, ‏שביר, ‏תחזוקה כבדה, ‏תמורה לא-ודאית.
- **(א) ‏הסתרת כפתורי מחיקה/כיבוי** ‏לתוסף שלנו ‏(‏CSS/patch קטן על ה-list-item) — ‏slice קטן (3-4) ‏שמשלים את ה-self-heal ‏ל-"‏מרגיש מערכת". ‏**‏נשמר כ-follow-up אפשרי**, ‏לא נבחר עכשיו ("‏לא חשוב").

### קשר צדדי
‏בירור זה עלה מדיון על **‏החזרת תפריט-הכספות של הדסקטופ** (native `obsidian.Menu`): ‏מכיוון ש-`require('obsidian')` ‏זמין רק לקוד-plugin, ‏תפריט נייטיב כזה **‏חייב לחיות בתוך system plugin** — ‏מה שמחזק שהתשתית הקהילתית-seeded ‏מספיקה; ‏אין צורך ב-core ‏בשביל זה. (‏ה-vault-switcher-menu ‏עצמו לא נבחר לביצוע בשלב זה.)

## 2026-07-19 — ארכיטקטורה: runtimes שכבתיים (serverless ראשי) + ארגון-docs

### רציונל
אחרי ה-mobile-first collapse יש core אחד (client-mobile) עם backend מתחלף
(OPFS / HTTP-server), לא שני ראנטיימים. זה מאפשר לתחזק את שתי הפריסות בזול.
מבנה היעד (Option A): להשאיר serverless כברירת-מחדל, ולבודד את קוד-הצד-שרת.

### ההחלטות
- **שכבות (לא frozen)**: serverless (client-mobile + OPFS + CF) = **ראשי**;
  server (Docker/non-Docker) = **חי ומתוחזק**, אופציה שנייה; desktop = **נשמר**
  (עתידו פתוח — כרגע אין בו משהו שאין ב-mobile, אבל לא מוחקים).
- **מבנה**: `core/` (R3 עתידי) · `client-mobile/` (שומרים "Mobile") ·
  `runtime-server/{server,client-shims}` · `deployments/{cloudflare,server}`.
  `deployments/server/` = פריסת-שרת שיכולה Docker או node רגיל.
- **טריגר server** = קיום השרת (auto-detect דרך `/api/fs` שמחזיר 404 ב-static).
- **HTTPS+auth מבחוץ**: השרת מגיש HTTP רגיל; המפעיל שם reverse-proxy (Caddy
  מומלץ, auto-TLS). לכן **לא מאמצים** את crypto-polyfills של PR #9 — HTTPS →
  `crypto.subtle` נייטיבי → מייתר גם SHA/AES polyfills וגם `/api/pbkdf2`.
- **PR #9 (Sean)**: מבוסס על ארכיטקטורה-שהוסרה (src/client desktop) + base
  משוכתב. **מחלצים ממנו את ה-Docker בעצמנו + קרדיט ל-Sean**; TOTP/crypto/image
  — בחוץ (out-of-scope / באחריות המפעיל).
- **desktop-scripts**: לא למחוק. לשמות מפורשים: `update-obsidian-desktop.js` +
  `vendor/obsidian-desktop` (מקביל ל-mobile). desktop = אופציה שנייה, אולי מקור-מחקר.

### רעיון שנדחה: shims כפלאגין Obsidian
נשקל להעביר shims לפלאגין. **נדחה** בגלל boot-order: ה-FS adapter נחוץ pre-boot
כדי לפתוח את הכספת, ופלאגין נטען post-boot (ביצה-ותרנגולת). "צד-שרת בפלאגין"
כן אפשרי אבל רק במודל OPFS+sync-plugin (LiveSync) — לא במודל /api/fs.

### ארגון docs (החלטת המשתמשת)
- **briefs + reports** → docs-repo חיצוני (github.com/MusiCode1/docs-repo).
- **decisions + architecture** → כאן ב-`agent-context/` (ליד הקוד, ל"מי-שמשנה-קוד").
- **`docs/`** → אנושי בלבד (dev-setup, guides).
- **`AGENTS.md`** (שורש) = מקור-אמת לסוכנים; **`CLAUDE.md`** = `@AGENTS.md` (DRY).

## 2026-07-19 — sw-vault-resources: הגשת משאבים בינאריים דרך Service Worker

### רציונל
PDF/תמונות בכספת לא נטענים ב-serverless: getResourcePath מייצר `ow-vault:/<id>/<id>/file`
(סכמה מומצאת שהדפדפן חוסם). spike (folder-vault-blob-uri) הוכיח שהבאג ארכיטקטוני — Obsidian
מטמין את uri-השורש (getUri נקרא רק path:'') ומשרשר פר-קובץ בצד-לקוח, לא עובר דרכנו.

### ההבחנה MD מול בינארי (הליבה)
- **MD/טקסט**: Obsidian קורא דרך readFile → ה-shim שלנו → בייטים ל-JS. עובד.
- **בינארי (PDF/img/video/audio)**: Obsidian בונה <img src>/viewer ונותן ל**דפדפן** לטעון מ-URL.
  ה-URL חייב סכמה fetchable — ow-vault: לא כזו.

### ההחלטה: פתרון אחיד — SW-served http URL (לא hybrid)
uri-שורש = `location.origin + '/_owres/' + vaultId + '/'`; Service Worker מיירט `/_owres/*`,
מנרמל double-id, וקורא מ-OPFS (או folder-handle), מגיש עם MIME + Range→206.

**זו המקבילה ה-web למנגנון הנייטיב של Obsidian**: Electron רושם `app://` (protocol handler);
Capacitor `convertFileSrc`→`https://localhost/_capacitor_file_/`→native intercept. בדפדפן אין
שכבת-נייטיב שתיירט סכמה מומצאת — ה-SW הוא הכלי היחיד שמיירט fetch ומגיש תוכן. לא hack — שחזור.

### רעיונות שנשקלו ונדחו
- **strip ב-getUri** (התוכנית המקורית): dead code — getUri לא נקרא פר-קובץ (spike הוכיח).
- **blob: URL**: אטום, לא-משתרשר — נשבר עם המודל cache+concat של Obsidian.
- **MutationObserver+blob (page-only)**: אלגנטי לתמונות/מדיה (DOM elements), אבל PDF עושה fetch
  תכנותי (לא element) → לא-אחיד. המשתמשת בחרה פתרון-אחיד על-פני page-only-חלקי.

### החלטות המשתמשת
- folder-vault (המחשב המקומי): אם SW יכול לקרוא handle מ-IDB (הרשאה) → SW-ישיר; אחרת RPC
  ל-page (hop אחד, ה-page מחזיק __owFolderRoot מורשה). spike #2 מכריע.
- ה-serverless ראשי; זו שכבת-ההגשה החסרה שהופכת אותו למלא (משאבים בינאריים).

### ממצאי אביגיל (2 סבבים)
- 🔴 Range: video/audio/PDF.js דורשים 206+Content-Range ל-seek/stream — נוסף (file.slice).
- placement: /_owres/ ראשון (לפני navigate), אחרת ייבלע.
