# vibe-check — security check for vibe coders

**English** · [Русский](README.ru.md)

A Claude Code plugin. It checks your website, web service, mobile app or Telegram bot before launch and explains what it finds in plain words. Made for people who build with AI and aren't programmers.

- **115 checks** based on the OWASP Top 10, the OWASP Top 10 for LLM Applications, the OWASP Mobile Top 10, real breaches of projects built on Lovable/Supabase, and privacy laws (GDPR, Russia's 152-FZ).
- **Figures out what you built** and checks only what matters: a landing page doesn't need payment checks.
- **A report** with file and line, "what can happen" in everyday words, and a command to fix it.
- **Guards you as you go**, no commands needed: it stops a secret key from being written into code, a made-up library from being installed, `.env` from going to GitHub, and the live database from being deleted without your confirmation.
- **English and Russian**: commands answer in the language you write in.

## Install

In Claude Code (terminal or desktop app):

```
/plugin marketplace add https://github.com/vibe-safety/vibe-check.git
/plugin install vibe-check@vibe-safety
```

Or from a regular terminal:

```bash
claude plugin marketplace add https://github.com/vibe-safety/vibe-check.git
claude plugin install vibe-check@vibe-safety
```

Restart Claude Code after installing. Requires Node.js 18+ (you almost certainly have it if you've built a website).

## Commands

| Command | What it does |
|---|---|
| `/vibe-check:scan` | Full project check, report saved to `.vibe-check/` |
| `/vibe-check:site https://my-site.com` | Checks your published site (read-only, your own site only) |
| `/vibe-check:fix 11` | Fixes check 11 from the report (explains what it will change and asks first) |
| `/vibe-check:explain RLS` | Explains any check in plain words; add `post` to get a social media post |

You can also just ask: "check my project before launch", "what is IDOR?".

## What happens automatically

| When | What is checked |
|---|---|
| AI writes or edits a file | No secret key in it (OpenAI, Anthropic, Stripe, Supabase service_role, Telegram, AWS, GitHub…) and no secret in a "public" variable `NEXT_PUBLIC_` / `VITE_` / `EXPO_PUBLIC_` |
| AI installs a library | It exists, didn't appear yesterday, and isn't a typo of a popular name |
| `git commit` / `git push` | No keys or `.env` files going to GitHub |
| A dangerous command | Dropping tables or the database, database resets, `rm -rf`, force-push, deploying to live: asks first |
| Session start | If the project has payments, AI or user accounts and hasn't been checked lately, reminds you once |

## Settings

Optional `.vibe-check/config.json` in your project folder:

```json
{
  "mode": "block",
  "allowPackages": ["my-internal-package"],
  "ignorePaths": ["fixtures/"],
  "sessionHint": true,
  "lang": "en"
}
```

`mode`: `block` stops dangerous actions (default), `warn` asks, `off` turns automatic checks off.
`lang`: `en` or `ru`, the language of automatic guard messages (defaults to your system language). Commands answer in the language you write in.

## Checklist

All 115 checks with explanations: [vibe-check/catalog/checklist.en.md](vibe-check/catalog/checklist.en.md) (Russian: [checklist.ru.md](vibe-check/catalog/checklist.ru.md)). Use it on its own too: as a reminder, for posts, for teaching.

## Limitations

- The plugin finds common mistakes but doesn't replace a professional audit. If your project handles money or sensitive data of many people, have an expert look at it.
- The legal section is guidance, not legal advice.
- The live site check is for your own sites only.

## License

MIT
