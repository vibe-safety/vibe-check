#!/usr/bin/env node
'use strict';
// SessionStart hook: if the project has accounts/payments/AI/an app/a bot and there hasn't been a full check lately,
// asks Claude to suggest /vibe-check:scan once, briefly.
const fs = require('fs');
const path = require('path');
const { readInput, safeMain } = require('./lib/hook-io');
const { detectStack } = require('./lib/project');
const { loadConfig } = require('./lib/config');
const { setLang } = require('./lib/i18n');

const RISKY = new Set(['accounts', 'payments', 'ai', 'mobile', 'bot', 'uploads']);

safeMain(async () => {
  const input = await readInput();
  const cwd = input.cwd || process.cwd();
  const cfg = loadConfig(cwd);
  setLang('en'); // this text is for Claude; Claude talks to the user in the user's language
  if (cfg.mode === 'off' || cfg.sessionHint === false) return;

  const stack = detectStack(cwd, { withRussia: false });
  if (!stack.isProject) return;
  const risky = stack.modules.filter((m) => RISKY.has(m.id));
  if (!risky.length) return;

  let days = null;
  try {
    const last = JSON.parse(fs.readFileSync(path.join(cwd, '.vibe-check', 'last-run.json'), 'utf8'));
    days = Math.floor((Date.now() - Date.parse(last.date)) / 86400000);
  } catch {}
  if (days !== null && days < 14) return;

  const what = risky.map((m) => m.title.toLowerCase()).join(', ');
  const when = days === null ? 'There has been no security check in this project yet' : `The last security check was ${days} days ago`;
  const context =
    `[vibe-check] This project has: ${what}. ${when}. ` +
    'Once per session, at a convenient moment and without interrupting the current task, suggest in one line (in the user\'s language) running /vibe-check:scan. ' +
    'If the user declines, do not remind again.';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
});
