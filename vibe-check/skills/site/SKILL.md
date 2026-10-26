---
name: site
description: Checks the user's live website by its address, read-only, about 20 requests: HTTPS, security headers, cookies, CORS, exposed .env and .git files, source maps, domain email records. Use when the user asks to check their published site or types /vibe-check:site <address> (проверить живой сайт).
argument-hint: "<https://site-address>"
---

# vibe-check: live site check

Arguments: `$ARGUMENTS` — the site address.

Script: `<plugin root>/scripts/probe-url.js`; the root is two levels up from this skill's folder (the "Base directory for this skill" line). Its output is in English; retell the results **in the user's language**, using `catalog/checklist.en.md` or `checklist.ru.md` for the check descriptions.

## Rules

- Check **only the user's own site**. If the address isn't in the project (README, `package.json`, `vercel.json`, site URL variables) and the user didn't say it's theirs, ask: "Is this your site?" Don't check other people's sites.
- The script only reads (GET/HEAD) and makes about 20 requests. Don't submit forms or try to log in.
- If an open `.env` or a key in the page code turns up, don't open or print its contents: only the fact and what to do.

## Order

1. If there's no address in the arguments, ask for it.
2. Run:
   ```bash
   node "<root>/scripts/probe-url.js" "<address>"
   ```
3. Retell the results in plain words by checklist item (`check` is the item number): first ❌, then ⚠️, then briefly what's fine. For each problem: what it means for visitors and the business, and how to fix it on their hosting (Vercel: `vercel.json` → `headers`; Netlify: `_headers` / `netlify.toml`; Next.js: `headers()` in `next.config`; Cloudflare: Transform Rules).
4. If the project has a `.vibe-check/report-*.md` from today, add a "Live site" section to it; otherwise create `.vibe-check/site-YYYY-MM-DD.md`.
5. An open `.env`, `.git` or a key in the page is 🔴: tell them to close access and **issue new keys** for everything that might have been there.
