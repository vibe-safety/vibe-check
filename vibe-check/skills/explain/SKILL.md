---
name: explain
description: Explains any vibe-check security checklist item in plain words, by number or keyword (RLS, IDOR, XSS, webhook, prompt injection, GDPR, 152-FZ). Can turn an item or a section into a social media post. Use when the user asks what a check or a security term means, or asks for a post about security (объясни пункт, текст для поста).
argument-hint: "<number | word> [post]"
---

# vibe-check: explaining a check

Arguments: `$ARGUMENTS`. A number (`11`), a range or section (`section 3`), a word (`RLS`, `webhook`). The word "post" (or «пост») in the arguments turns on social media mode.

Catalog: `<plugin root>/catalog/checklist.en.md` (Russian: `checklist.ru.md`); the root is two levels up from this skill's folder (the "Base directory for this skill" line). Answer **in the user's language** and use the matching checklist.

## Normal mode

1. Find the item in the catalog by number or word (in the title, "What it is", or the English term).
2. Explain briefly:
   - **What it is**: one sentence with an everyday analogy;
   - **What can happen**: a concrete story of how it breaks;
   - **How to check yours**: what to open or what to ask Claude;
   - priority (🔴🟡🟢) and who needs it.
3. If you're in a project folder and it's quick, say in a line or two how this project is doing on that check, and suggest `/vibe-check:fix N` if there's a problem.

## Post mode

Write a post for Instagram / Telegram / X / LinkedIn:
- A hook in the first line: a question or a short story, no clickbait or scaremongering.
- 3–7 points in plain words, one sentence each, with emoji from the catalog.
- One line of "what to do today".
- Facts or numbers only from the "Hook facts" section of the catalog, with the source; numbers marked "check" there must be marked the same way.
- No untranslated jargon. Up to 1,500 characters unless asked otherwise.
- For a carousel: one section per slide, a title up to 6 words, 3–6 lines.
