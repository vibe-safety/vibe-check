#!/usr/bin/env node
'use strict';
// Хук PreToolUse для Bash/PowerShell:
//  1) установка пакетов — проверка, что пакет существует и не подозрительный (пункт 57);
//  2) опасные команды — удаление базы, force-push, деплой на боевой — спросить подтверждение (пункты 51, 59);
//  3) git commit / push — не уходят ли секреты и .env на GitHub (пункты 8, 9).
const { execFileSync } = require('child_process');
const { readInput, preToolDecision, safeMain } = require('./lib/hook-io');
const { scanText, isSecretsFile } = require('./lib/patterns');
const { checkPackage, parseInstallCommand } = require('./lib/packages');
const { loadConfig } = require('./lib/config');

const SAFE_RM_TARGETS = /^(\.\/)?(node_modules|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.turbo|\.cache|coverage|tmp|temp|\.expo|__pycache__|\.pytest_cache|\.vibe-check)\/?$/;

const DANGEROUS = [
  { re: /\bdrop\s+(table|database|schema)\b/i, why: 'удаление таблицы или базы данных' },
  { re: /\btruncate\s+(table\s+)?["\w]/i, why: 'полная очистка таблицы' },
  { re: /\bdelete\s+from\s+[\w."]+\s*(;|"|'|$)/i, why: 'удаление всех строк таблицы (DELETE без WHERE)' },
  { re: /\bsupabase\s+db\s+reset\b/, why: 'сброс базы Supabase' },
  { re: /\bsupabase\s+db\s+push\b/, why: 'изменение структуры удалённой (возможно, боевой) базы Supabase' },
  { re: /\bprisma\s+migrate\s+reset\b/, why: 'сброс базы через Prisma (все данные удалятся)' },
  { re: /\bprisma\s+db\s+push\b.*--(force-reset|accept-data-loss)/, why: 'изменение базы с потерей данных' },
  { re: /\bdrizzle-kit\s+(push|drop)\b/, why: 'изменение структуры базы через drizzle-kit' },
  { re: /\bdropdb\b/, why: 'удаление базы данных' },
  { re: /\bheroku\s+pg:reset\b/, why: 'сброс базы Heroku' },
  { re: /\brailway\s+(down|delete)\b/, why: 'удаление сервиса Railway' },
  { re: /\bfly(ctl)?\s+(apps|volumes)\s+destroy\b/, why: 'удаление приложения или диска Fly.io' },
  { re: /\bfirebase\s+(firestore:delete|database:remove)\b/, why: 'удаление данных Firebase' },
  { re: /\bgit\s+push\b.*\s(--force|-f|--force-with-lease)\b/, why: 'принудительная перезапись истории на GitHub' },
  { re: /\bgit\s+reset\s+--hard\b/, why: 'откат с потерей несохранённых изменений' },
  { re: /\bgit\s+clean\s+-[a-z]*f/, why: 'удаление неотслеживаемых файлов' },
  { re: /\bvercel\b.*\s--prod\b/, why: 'деплой на боевой сайт (Vercel)' },
  { re: /\bnetlify\s+deploy\b.*\s--prod\b/, why: 'деплой на боевой сайт (Netlify)' },
  { re: /\bfirebase\s+deploy\b/, why: 'деплой в Firebase' },
  { re: /\beas\s+(submit|update\b.*--(branch|channel)\s+production)\b/, why: 'публикация мобильного приложения' },
  { re: /\bwrangler\s+(deploy|publish)\b/, why: 'деплой в Cloudflare' },
];

function rmTargetsUnsafe(command) {
  const reasons = [];
  // bash: rm -rf a b
  for (const m of command.matchAll(/\brm\s+((?:-[a-zA-Z]+\s+)+)([^;&|\n]+)/g)) {
    const flags = m[1];
    if (!/r/i.test(flags) || !/f/.test(flags)) continue;
    const targets = m[2].trim().split(/\s+/).map((x) => x.replace(/^["']|["']$/g, ''));
    if (targets.some((t) => !SAFE_RM_TARGETS.test(t))) reasons.push(`безвозвратное удаление файлов: ${targets.join(' ')}`);
  }
  // PowerShell: Remove-Item ... -Recurse -Force
  for (const m of command.matchAll(/\bRemove-Item\b([^;\n|]*)/gi)) {
    const rest = m[1];
    if (!/-Recurse/i.test(rest)) continue;
    const targets = rest.replace(/-\w+(\s+\$\w+)?/g, ' ').trim().split(/[\s,]+/).filter(Boolean).map((x) => x.replace(/^["']|["']$/g, ''));
    if (!targets.length || targets.some((t) => !SAFE_RM_TARGETS.test(t))) reasons.push(`безвозвратное удаление папки: ${targets.join(' ') || '(путь не распознан)'}`);
  }
  return reasons;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 });
}

// Разбор diff: добавленные строки по файлам.
function scanDiff(diff) {
  const findings = [];
  let file = null;
  let buf = [];
  const flush = () => {
    if (file && buf.length) {
      for (const f of scanText(buf.join('\n'), { secretsFile: isSecretsFile(file) })) if (f.severity === 'high') findings.push({ ...f, file });
    }
    buf = [];
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      flush();
      file = line.slice(4).replace(/^b\//, '');
    } else if (line.startsWith('+') && !line.startsWith('+++')) buf.push(line.slice(1));
  }
  flush();
  return findings;
}

function gitChecks(command, cwd) {
  const deny = [];
  const isCommit = /\bgit\s+commit\b/.test(command);
  const isPush = /\bgit\s+push\b/.test(command);
  if (!isCommit && !isPush) return deny;
  try {
    git(cwd, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return deny;
  }
  let envFiles = [];
  try {
    const files = isCommit
      ? git(cwd, ['diff', '--cached', '--name-only']) + (/\s-[a-zA-Z]*a/.test(command) ? git(cwd, ['diff', '--name-only']) : '')
      : git(cwd, ['ls-files']);
    envFiles = files.split('\n').filter((f) => f && isSecretsFile(f));
  } catch {}
  if (envFiles.length) deny.push(`в репозиторий попадает файл с секретами: ${envFiles.join(', ')}. Его нужно убрать из git (git rm --cached) и добавить в .gitignore (пункт 8)`);

  let diff = '';
  try {
    if (isCommit) diff = git(cwd, ['diff', '--cached', '-U0', '--no-color']) + (/\s-[a-zA-Z]*a/.test(command) ? git(cwd, ['diff', '-U0', '--no-color']) : '');
    else diff = git(cwd, ['log', '-p', '-U0', '--no-color', '@{u}..HEAD']);
  } catch {}
  const found = scanDiff(diff).slice(0, 5);
  for (const f of found) deny.push(`${f.file}: ${f.name} (${f.preview})`);
  if (found.length && isPush) deny.push('секрет уже в коммите: просто удалить его из кода мало — он останется в истории. Нужно перевыпустить ключ в сервисе и убрать его из истории до push (пункт 9)');
  return deny;
}

safeMain(async () => {
  const input = await readInput();
  const cfg = loadConfig(input.cwd);
  if (cfg.mode === 'off') return;
  const command = (input.tool_input && input.tool_input.command) || '';
  if (!command) return;
  const cwd = input.cwd || process.cwd();

  const deny = [];
  const ask = [];

  // 1. Пакеты
  const pkgs = parseInstallCommand(command).filter((p) => !cfg.allowPackages.includes(p.name)).slice(0, 10);
  if (pkgs.length) {
    const results = await Promise.all(pkgs.map((p) => checkPackage(p.name, p.ecosystem)));
    for (const r of results) {
      if (r.level === 'deny') deny.push(...r.problems);
      else if (r.level === 'ask') ask.push(`«${r.name}»: ${r.problems.join('; ')}`);
    }
  }

  // 2. Опасные команды
  for (const d of DANGEROUS) if (d.re.test(command)) ask.push(d.why);
  ask.push(...rmTargetsUnsafe(command));

  // 3. Git
  deny.push(...gitChecks(command, cwd));

  if (deny.length) {
    const reason =
      '[vibe-check] Команда остановлена:\n' + deny.map((x) => '• ' + x).join('\n') +
      '\n\nОбъясни пользователю простыми словами, в чём риск, и предложи безопасный вариант.' +
      (ask.length ? '\nТакже обрати внимание: ' + ask.join('; ') : '');
    return preToolDecision(cfg.mode === 'warn' ? 'ask' : 'deny', reason);
  }
  if (ask.length) {
    return preToolDecision(
      'ask',
      '[vibe-check] Проверь перед запуском:\n' + ask.map((x) => '• ' + x).join('\n') +
        '\nУбедись, что это не боевая база и не живой сайт, и что есть свежий бэкап (пункты 51, 57, 59).'
    );
  }
});
