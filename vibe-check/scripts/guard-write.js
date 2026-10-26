#!/usr/bin/env node
'use strict';
// PreToolUse hook for Write/Edit/MultiEdit/NotebookEdit: stops a secret key from being written into a regular file
// or into a "public" variable (checks 6, 7, 10).
const path = require('path');
const { readInput, preToolDecision, warnOnly, safeMain } = require('./lib/hook-io');
const { scanText, isSecretsFile, isExampleEnvFile } = require('./lib/patterns');
const { loadConfig } = require('./lib/config');
const { t, setLang } = require('./lib/i18n');

function newContent(input) {
  const ti = input.tool_input || {};
  if (typeof ti.content === 'string') return ti.content;
  if (typeof ti.new_string === 'string') return ti.new_string;
  if (Array.isArray(ti.edits)) return ti.edits.map((e) => e.new_string || '').join('\n');
  if (typeof ti.new_source === 'string') return ti.new_source;
  return '';
}

safeMain(async () => {
  const input = await readInput();
  const cfg = loadConfig(input.cwd);
  setLang(cfg.lang);
  if (cfg.mode === 'off') return;
  const filePath = (input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path)) || '';
  if (!filePath) return;
  const rel = input.cwd ? path.relative(input.cwd, filePath) : filePath;
  if (cfg.ignorePaths.some((p) => rel.replace(/\\/g, '/').includes(p))) return;

  const text = newContent(input);
  if (!text) return;

  const secretsFile = isSecretsFile(filePath);
  const findings = scanText(text, { secretsFile });
  if (isExampleEnvFile(filePath)) {
    // An example .env must contain placeholders only
    for (const f of scanText(text)) {
      if (f.rule !== 'public-env' && f.severity === 'high') findings.push({ ...f, name: f.name + t({ en: ' in an example file (it goes to GitHub)', ru: ' в файле-примере (он попадает на GitHub)' }) });
    }
  }
  if (!findings.length) return;

  const high = findings.filter((f) => f.severity === 'high');
  const lineWord = t({ en: 'line', ru: 'строка' });
  const list = findings.slice(0, 5).map((f) => `• ${lineWord} ${f.line}: ${f.name} (${f.preview})${f.note ? ' — ' + f.note : ''}`).join('\n');

  if (high.length) {
    const publicEnv = high.some((f) => f.rule === 'public-env');
    const reason =
      t({ en: `[vibe-check] A secret was found in ${rel}:`, ru: `[vibe-check] В ${rel} найден секрет:` }) + `\n${list}\n\n` +
      (publicEnv
        ? t({
            en: 'Variables starting with NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_, REACT_APP_ are sent to the browser or the app, so every visitor can see them. Keep the secret in a variable without the prefix and use it only in server code (API route, server function, edge function).\n',
            ru: 'Переменные с приставками NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_, REACT_APP_ попадают в браузер или в приложение — их видит любой посетитель. Секрет нужно хранить в переменной без приставки и использовать только в серверном коде (API-роут, серверная функция, edge function).\n',
          })
        : t({
            en: 'Secret keys must not live in code: they are visible in the browser and on GitHub. Put the value in .env (which must be in .gitignore) and read it via process.env / os.environ on the server only.\n',
            ru: 'Секретные ключи нельзя хранить в коде: их видно в браузере и на GitHub. Положи значение в .env (он должен быть в .gitignore), а в коде читай через process.env / os.environ только на сервере.\n',
          })) +
      t({
        en: 'Explain to the user in plain words, in their language, what happened, and rewrite it without the secret in code. If this is a false positive (for example, a test sample), the user can relax the check in .vibe-check/config.json ("mode": "warn").',
        ru: 'Объясни пользователю простыми словами, что случилось, и перепиши без секрета в коде. Если это ложное срабатывание (например, тестовый пример), пользователь может отключить проверку в .vibe-check/config.json ("mode": "warn").',
      });
    return preToolDecision(cfg.mode === 'warn' ? 'ask' : 'deny', reason);
  }

  return warnOnly(
    t({ en: `[vibe-check] Possible secret in ${rel}:`, ru: `[vibe-check] Возможный секрет в ${rel}:` }) + `\n${list}\n` +
      t({ en: 'If it is a real key, move it to .env.', ru: 'Если это настоящий ключ — перенеси его в .env.' })
  );
});
