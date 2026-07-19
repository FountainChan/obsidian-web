# obsidian-web — יומן ביצוע (execution log)

> יומן-ביצוע של המבצע (אליעזר) — מה בוצע, חריגות, בדיקות. לא רציונל
> ארכיטקטוני (זה ב-`agent-context/decisions/obsidian-web.md`, ריפו
> brief-driven-slices). כרונולוגי, רשומה חדשה בראש הקובץ.

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
