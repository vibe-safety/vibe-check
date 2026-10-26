#!/usr/bin/env node
'use strict';
// Хук SessionStart: если в проекте есть аккаунты/оплата/ИИ/приложение/бот, а полной проверки давно не было,
// просит Claude один раз коротко предложить /vibe-check:scan.
const fs = require('fs');
const path = require('path');
const { readInput, safeMain } = require('./lib/hook-io');
const { detectStack } = require('./lib/project');
const { loadConfig } = require('./lib/config');

const RISKY = new Set(['accounts', 'payments', 'ai', 'mobile', 'bot', 'uploads']);

safeMain(async () => {
  const input = await readInput();
  const cwd = input.cwd || process.cwd();
  const cfg = loadConfig(cwd);
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
  const when = days === null ? 'Проверки безопасности в этом проекте ещё не было' : `Последняя проверка безопасности была ${days} дн. назад`;
  const context =
    `[vibe-check] В проекте есть: ${what}. ${when}. ` +
    'Один раз за сессию, в удобный момент и не перебивая текущую задачу, предложи пользователю одной строкой запустить /vibe-check:scan. ' +
    'Если пользователь откажется, больше не напоминай.';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
});
