# AGENTS.md — obsidian-web

> נקודת-כניסה לסוכני-קוד (Claude Code / Cursor / Copilot / …). ניטרלי-כלי.
> `CLAUDE.md` מפנה לכאן עם `@AGENTS.md`. בני-אדם: התחילו מ-`README.md`.

## מה זה הפרויקט
מריצים את ה-renderer של Obsidian בדפדפן רגיל (בלי Electron), ע"י shims שמזייפים
Electron/Capacitor. **serverless (OPFS) הוא הראשי**; server (`/api/fs`) ו-desktop
הם אופציות משניות חיות. פרטים: `agent-context/architecture.md`.

## קונבנציות — חובה
- **bun, לא node**: אין node אמיתי בסביבה בכוונה (מסומלנק ל-bun), כדי לאלץ סוכנים
  להשתמש ב-bun. הרץ שרת/בדיקות עם bun. אל תחפש node חלופי. (חריג: פעולות-ops של
  מרדכי כמו wrangler-deploy משתמשות ב-node אמיתי — לא רלוונטי לביצוע slice.)
- **bare repo + worktrees**: השורש מכיל `.bare` + worktrees `main`/`dev` +
  `worktrees/<slice>`. ה-base לכל slice הוא **dev**. merge → dev, ואז dev → main.
- **merge = מרדכי בלבד, באישור המשתמשת המפורש.** אף סוכן אחר לא ממזג.
- **vendor/ gitignored** — מיוצר ע"י `scripts/update-obsidian-*.js`; לא ב-repo.
- **הבַּאנדל minified** — עגן patches/עריכות לפי **pattern/שם-symbol**, לא לפי
  מספר-שורה (נודד). ראה `scripts/patch-obsidian-mobile.js` (תיעוד-בגוף).
- **אין PII בריפו-הקוד** — שמות-כספת אישיים, נתיבי-מכונה, לוגי-ביצוע → **לא כאן**.

## איפה כל דבר
| מה | איפה |
|----|------|
| החלטות + רציונל ("למה") | `agent-context/decisions/obsidian-web.md` |
| ארכיטקטורה | `agent-context/architecture.md` |
| docs אנושיים (dev-setup, guides) | `docs/` |
| **briefs (תוכניות-ביצוע) + reports** | ריפו חיצוני: `github.com/MusiCode1/docs-repo` → `obsidian-web/` |
| dispatch לסוכן-ביצוע | ה-brief מפנה ל-boilerplate פר-פרויקט (ב-docs-repo) |

## מתודולוגיה (brief-driven-slices)
מרדכי מתכנן+ממזג · אביגיל מאמתת brief (gate: READY) · אליעזר מבצע · כלב/כלב-heavy
מאמתים runtime (gate: GO). כל שינוי עובר brief → אביגיל → ביצוע → כלב → merge.

## לפני שנוגעים
1. קרא את entry ה-ארכיטקטורה האחרון ב-`agent-context/decisions/`.
2. שינוי code → brief (docs-repo) → אביגיל. אל תבצע לפני READY.
3. אל תמזג, אל תפרוס לחי (ops של מרדכי).
