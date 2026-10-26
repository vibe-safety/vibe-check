---
name: fix
description: Fixes a security problem from the vibe-check report by check number (e.g. "/vibe-check:fix 11" or "fix all the red ones"). Explains in plain words what it will change, fixes it and verifies the result. Use when the user asks to fix an item from the vibe-check report or says "fix it" (почини, чини).
argument-hint: "<check number | all red>"
---

# vibe-check: fixing

Arguments: `$ARGUMENTS` — a check number (`11`), several numbers (`6 7 11`) or "all red".

The plugin root is two levels up from this skill's folder (the "Base directory for this skill" line). Check descriptions: `<root>/catalog/checklist.en.md` (Russian: `checklist.ru.md`). Talk to the user **in their language**.

## Order

1. Find the latest report `.vibe-check/report-*.md` in the project. If there is none, say that `/vibe-check:scan` is needed first and stop. Take the findings for the requested checks (files and lines) from the report.
2. **Before editing**, explain in 2–3 plain sentences what is wrong now, what you'll change and what it affects. If the fix changes behaviour for users (for example, after turning on RLS some data may stop showing), warn and wait for a "yes".
3. Fix minimally and precisely, in the style of the existing code. Don't rewrite what doesn't belong to the check.
4. Verify: rerun the relevant scanner (`scan-secrets.js`, `check-deps.js`) or re-read the code; run tests if there are any.
5. Update the item's status in the report (❌ → ✅ with "fixed <date>").
6. Say what changed and, if needed, what the user must do themselves.

## Special cases

**A leaked key (checks 6–10).** Removing the key from code isn't enough: it may already have been copied, and it stays in git history.
- Move the value to `.env` (make sure `.env` is in `.gitignore`) and read it only on the server.
- If the key was in browser code, move the API call to server code (API route, server action, edge function).
- Tell the user to **issue a new key** in the service dashboard (OpenAI → API keys, Stripe → Developers → API keys, Supabase → Settings → API) and put it in `.env` and in the hosting settings. Never create or paste keys yourself.
- Cleaning git history (`git filter-repo`) only if the user explicitly asks, and only after the key has been replaced; it rewrites history.

**RLS in Supabase (check 11).** Write a migration: `alter table ... enable row level security;` + policies by `auth.uid()` for select/insert/update/delete. Apply the migration to the live database only after the user confirms.

**Payments (32–39).** After the changes, suggest testing in the payment provider's test mode: double click, repeated webhook, cancellation.

**Laws (107–114).** You are not a lawyer: prepare drafts (policy, consent, checkbox next to the form) and say directly that a lawyer should review them.

**Dangerous actions.** Deleting data, migrations on the live database, deploys, rewriting git history: only after an explicit "yes".
