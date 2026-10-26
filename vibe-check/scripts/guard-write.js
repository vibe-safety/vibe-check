#!/usr/bin/env node
'use strict';
// Хук PreToolUse для Write/Edit/MultiEdit/NotebookEdit: не даёт записать секретный ключ в обычный файл
// и положить секрет в «публичную» переменную (пункты 6, 7, 10 чек-листа).
const path = require('path');
const { readInput, preToolDecision, warnOnly, safeMain } = require('./lib/hook-io');
const { scanText, isSecretsFile, isExampleEnvFile } = require('./lib/patterns');
const { loadConfig } = require('./lib/config');

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
    // В .env.example должны быть только заглушки
    for (const f of scanText(text)) if (f.rule !== 'public-env' && f.severity === 'high') findings.push({ ...f, name: f.name + ' в файле-примере (он попадает на GitHub)' });
  }
  if (!findings.length) return;

  const high = findings.filter((f) => f.severity === 'high');
  const list = findings.slice(0, 5).map((f) => `• строка ${f.line}: ${f.name} (${f.preview})${f.note ? ' — ' + f.note : ''}`).join('\n');

  if (high.length) {
    const publicEnv = high.some((f) => f.rule === 'public-env');
    const reason =
      `[vibe-check] В ${rel} найден секрет:\n${list}\n\n` +
      (publicEnv
        ? 'Переменные с приставками NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_, REACT_APP_ попадают в браузер или в приложение — их видит любой посетитель. ' +
          'Секрет нужно хранить в переменной без приставки и использовать только в серверном коде (API-роут, серверная функция, edge function).\n'
        : 'Секретные ключи нельзя хранить в коде: их видно в браузере и на GitHub. ' +
          'Положи значение в .env (он должен быть в .gitignore), а в коде читай через process.env / os.environ только на сервере.\n') +
      'Объясни пользователю простыми словами, что случилось, и перепиши без секрета в коде. ' +
      'Если это ложное срабатывание (например, тестовый пример), пользователь может отключить проверку в .vibe-check/config.json ("mode": "warn").';
    return preToolDecision(cfg.mode === 'warn' ? 'ask' : 'deny', reason);
  }

  return warnOnly(`[vibe-check] Возможный секрет в ${rel}:\n${list}\nЕсли это настоящий ключ — перенеси его в .env.`);
});
