# obsidian-web — יומן ביצוע (execution log)

> יומן-ביצוע של המבצע (אליעזר) — מה בוצע, חריגות, בדיקות. לא רציונל
> ארכיטקטוני (זה ב-`agent-context/decisions/obsidian-web.md`, ריפו
> brief-driven-slices). כרונולוגי, רשומה חדשה בראש הקובץ.

---

## 2026-07-19 — slice seed-demo (Commit 3/3, סיום)

### כפתור "כספת דמו" על `.mobile-onboarding`

Brief: `docs/plans/seed-demo.md` §3(ד), DoD #4.

#### מה בוצע?

**`src/client-mobile/boot.js`**

- `installDemoVaultButton()` — מזריק כפתור `.ow-demo-vault-btn` (fixed
  bottom-left, `mod-cta`) לתוך `.mobile-onboarding` (**לא** `.mobile-
  onboarding-screen` — תיקון-סבב-2 אביגיל; אומת גרפית מול
  `vendor/obsidian-mobile/app.js`: שני הclass-ים קיימים כ-DOM-ים נפרדים,
  `.mobile-onboarding` הוא ה-root של אשף ה-first-run
  `document.body.createDiv("mobile-onboarding")`).
- `MutationObserver` על `document.body` (במקום הזרקה חד-פעמית) — שלבי-האשף
  (welcome→sync-intro→configure-vault) עשויים לרנדר-מחדש; ה-observer מזריק
  מחדש בכל מוטציה, idempotent (guard `root.querySelector('.ow-demo-vault-
  btn')`).
- guard `demoVault.enabled===false` (ES5, אותו pattern כמו `ensureDemo`) —
  לא מציגים כפתור למשהו שלא יעשה כלום כשה-feature כבוי.
- onClick: `ensureDemo()` (Commit 2, create-if-missing עם id קבוע) →
  `navigateToVault(id)` (פונקציה קיימת, path-based `/vault/<id>`).
- נקרא מתוך ענף ה-no-vault הקיים (`installDemoVaultButton();` לצד
  `installCreateVaultInterceptor();`) — לא רץ כשיש vault פתוח/רשימת-vaults
  (chooser).

#### בדיקות

- `bun build boot.js` → syntax תקין; `bun test test/` — 46/46 ירוקים (ללא
  שינוי, ראה "חריגות").
- **תיקון תשתית שאִפשר בדיקת-דפדפן חלקית**: מפתח `~/.ssh/pico` היה פגום
  (שורות CRLF — `error in libcrypto` בניסיון Commit 2). המרתי ל-LF
  (`tr -d '\r'`, גיבוי ב-`~/.ssh/pico.bak-crlf`) — תוקן, `ssh-keygen -l`
  עובד. פתחתי מנהרת `tuns.sh` (`https://musicode-localhost.nue.tuns.sh`) אל
  שרת מקומי (`PORT=4080`, `src/runtime-server/server`) — **הגיע**
  (`curl .../starter` → 200) אבל **אין דפדפן זמין בסביבת-הביצוע הזו** לפתוח
  אותה בפועל (`chromium`/`firefox` לא מותקנים; alias SSH `linux-gui`
  [ה-remote-GUI container הרגיל] לא מוגדר ב-`~/.ssh/config` של הסביבה
  הנוכחית — `Could not resolve hostname linux-gui`). המנהרה נסגרה בסוף
  הבדיקה.
- **סטטי**: `grep` על `vendor/obsidian-mobile/app.js` אימת ששני ה-class-ים
  (`mobile-onboarding` root ו-`mobile-onboarding-screen`) קיימים כ-strings
  נפרדים בבאנדל, ושה-selector `.mobile-onboarding` (בלי `-screen`) שהבריף
  דורש (תיקון סבב-2) אכן תואם ל-DOM אמיתי (`document.body.createDiv
  ("mobile-onboarding")`), לא רק לניחוש.

#### חריגות

- **verification interactive מלא (כפתור→Demo זרוע, onboarding למשתמש-חדש,
  deep-link) לא בוצע ע"י אליעזר** — אין דפדפן/linux-gui זמין בסביבה. זה
  בדיוק התפקיד המיועד ל-**calev-heavy** לפי §8 בבריף ("E2E: תיקייה-עם-תוכן
  (אין seed), ריקה (seed), onboarding למשתמש-חדש, כפתור→Demo, deep-link,
  regression") — מופעל מיד אחרי commit זה, לפני מסירת ה-slice.
- מיקום הכפתור (bottom-left, fixed) הוא spike-החלטת-executor (הבריף לא
  קבע מיקום מדויק, §3ד: "spike מקום") — לא נבדק ויזואלית מול mockup (אין
  mockup לפריט הזה בבריף).

---

## 2026-07-19 — slice seed-demo (Commit 2/3)

### ensureDemo() + /vault/<demoId>

Brief: `docs/plans/seed-demo.md` §3(ג), DoD #5 (deep-link).

#### מה בוצע?

**`src/client-mobile/boot.js`**

- `DEMO_ID` — מחושב פעם אחת מ-`window.__owConfig.demoVault.id`, נופל
  ל-`'0000demo0000demo'` (ES5: `(window.__owConfig && window.__owConfig.demoVault
  && window.__owConfig.demoVault.id) || '0000demo0000demo'`).
- `ensureDemo()` — create-if-missing: אם `window.__owLocalVaults.get(DEMO_ID)`
  ריק → `create('Demo', { id: DEMO_ID })` (מזהה קבוע, מ-Commit 1). guard
  `demoVault.enabled===false` (תיקון-precedence סבב-2 אביגיל: `d && d.enabled
  === false`, לא `!d.enabled ?? true` שאינו תקף בלי `??`). ברירת-מחדל: ON.
- **לא** נקרא באופן גורף — רק כש-`VAULT_ID === DEMO_ID` (כניסה דרך
  `/vault/<demoId>`, קישור-שיתוף). משתמש-חדש שמגיע ל-`/` בלי vault לא
  יוצר Demo — הרשימה נשארת ריקה → onboarding נייטיבי (DoD#3, נבדק ב-Commit
  1 האחר לא נפגע).
- אחרי `ensureDemo()`, `VAULT_TYPE` (מחושב מיד אחרי) נופל ל-`'local'`
  (registry lookup מוצא את הרשומה) — הכספת נפתחת דרך זרימת ה-OPFS הרגילה,
  כולל seed guard מ-Commit 1 (כספת חדשה=ריקה → נזרעת).

#### בדיקות

- `bun build boot.js` → syntax תקין.
- `bun test test/` בתוך `src/client-mobile/`: 46/46 ירוקים (ללא שינוי —
  ensureDemo תלוי-DOM, אין הרחבת unit-test; ראה "חריגות" למטה).
- curl ידני מול שרת מקומי (`PORT=4080 bun index.js` תחת
  `src/runtime-server/server/`):
  - `GET /` → 200, `window.__owConfigInjected` כולל
    `"demoVault":{"enabled":true,"id":"0000demo0000demo"}` — מאמת שה-config
    שממנו `DEMO_ID`/ה-guard קוראים בפועל מוזרק.
  - `GET /vault/0000demo0000demo` → 200 (routing תקין; יצירת ה-vault בפועל
    היא לוגיקת-דפדפן, OPFS/localStorage — לא נבדקת ב-curl).
  - `GET /vault/somerandomid`, `GET /`, `GET /starter` → 200 (regression:
    routing קיים לא נשבר).

#### חריגות

- **בדיקת דפדפן-אמיתי לא בוצעה ע"י אליעזר** — ניסיון לפתוח מנהרת tuns.sh
  (`ssh -i ~/.ssh/pico ... tuns.sh http`) נכשל: `Load key
  "/home/user/.ssh/pico": error in libcrypto` / `Permission denied
  (publickey)` — תשתית (מפתח SSH), לא קשור ל-slice. `ensureDemo()`/deep-link
  אינם ניתנים ל-unit-test (תלויים ב-`window`/`localStorage`/OPFS אמיתיים,
  כמו שאר boot.js). הבריף עצמו מייעד את ה-commit הזה לאימות calev (`§4:
  "(calev: deep-link פותח Demo זרוע)"`) ואת ה-slice כולו ל-calev-heavy (§8) —
  **מתבצע בסוף ה-slice**, לא כאן.

---

## 2026-07-19 — slice seed-demo (Commit 1/3)

### seed רק בכספת ריקה + create() עם id קבוע

Brief: `docs/plans/seed-demo.md` (docs-repo, worktree `worktrees/seed-demo/`,
branch `slice/seed-demo`, base `slice/deploy-config`@39bd533).

#### מה בוצע?

**1. `src/client-mobile/local-vault-registry.js`**

- `create(name, opts)` מקבל עכשיו `opts.id` (מזהה קבוע) — `var id = (opts &&
  opts.id) || uuid();` במקום `uuid()` תמיד. קוראים קיימים (create-vault
  interceptor, folder-vault flow) לא מושפעים — ברירת-מחדל עדיין uuid.
- הוסף `module.exports` (מותנה, אותו pattern כמו `bootstrap-lookup.js`) —
  מאפשר unit test ב-Node/bun בלי דפדפן אמיתי.

**2. `src/client-mobile/boot.js` — seed guard (data-safety, ליבה)**

- לפני seedSystemPlugins/seedExampleVault: `readdir({path:''})` על שורש
  הכספת, סינון `.obsidian`/`.trash`. אם נשאר ≥1 קובץ-משתמש → **דילוג מוחלט**
  על שני בלוקי ה-seed (system-plugins **וגם** example-content — לא רק
  example-content כפי שהיה נראה מהקוד הישן).
- readdir נכשל (edge-case הרשאות) → ברירת-מחדל data-safety-first: מדלגים על
  seed (לא מניחים "ריק" כשלא ידוע).
- `seedStore` אחד מחושב פעם אחת ומשותף לשני הבלוקים (במקום שני `makeStore()`
  נפרדים כמו קודם).
- קריאת קונפיג ES5 בלבד (ללא `?.`/`??`): `(window.__owConfig &&
  window.__owConfig.seedExampleContent)` — כבר היה כך, לא שונה.

#### בדיקות

- `src/client-mobile/test/local-vault-registry.test.js` (חדש, 5 בדיקות): id
  מפורש, ברירת-מחדל uuid, idempotent על אותו id, type ברירת-מחדל/מפורש,
  has()/get().
- `bun test test/` בתוך `src/client-mobile/`: **46 ירוקים** (41 קיימים + 5
  חדשים), 0 נכשלים.
- `bun build boot.js`/`local-vault-registry.js` ל-`/tmp` — syntax-check תקין
  (אין DOM זמין ב-bun test כדי להריץ את boot.js עצמו — הרצה בדפדפן אמיתי
  מכוסה ע"י calev-heavy בסוף ה-slice, DoD §5 #1/#2/#6).

#### חריגות

- אין. הרחבת `create()` בדיוק לפי הבריף §3(א). ה-seed guard מכסה גם
  system-plugins (לא רק example-content) — עקבי עם §0/§3ב ("דילוג מוחלט")
  ולא רק עם הדוגמה המצומצמת ב-§3ב.
