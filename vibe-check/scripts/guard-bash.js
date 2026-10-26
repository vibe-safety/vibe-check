#!/usr/bin/env node
'use strict';
// PreToolUse hook for Bash/PowerShell:
//  1) package installs — the package exists and isn't suspicious (check 57);
//  2) dangerous commands — dropping a database, force-push, deploying to live — ask first (checks 51, 59);
//  3) git commit / push — no secrets or .env go to GitHub (checks 8, 9).
const { execFileSync } = require('child_process');
const { readInput, preToolDecision, safeMain } = require('./lib/hook-io');
const { scanText, isSecretsFile } = require('./lib/patterns');
const { checkPackage, parseInstallCommand } = require('./lib/packages');
const { loadConfig } = require('./lib/config');
const { t, setLang } = require('./lib/i18n');

const SAFE_RM_TARGETS = /^(\.\/)?(node_modules|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.turbo|\.cache|coverage|tmp|temp|\.expo|__pycache__|\.pytest_cache|\.vibe-check)\/?$/;

const DANGEROUS = [
  { re: /\bdrop\s+(table|database|schema)\b/i, why: { en: 'deleting a table or a database', ru: 'удаление таблицы или базы данных' } },
  { re: /\btruncate\s+(table\s+)?["\w]/i, why: { en: 'emptying a whole table', ru: 'полная очистка таблицы' } },
  { re: /\bdelete\s+from\s+[\w."]+\s*(;|"|'|$)/i, why: { en: 'deleting every row of a table (DELETE without WHERE)', ru: 'удаление всех строк таблицы (DELETE без WHERE)' } },
  { re: /\bsupabase\s+db\s+reset\b/, why: { en: 'resetting the Supabase database', ru: 'сброс базы Supabase' } },
  { re: /\bsupabase\s+db\s+push\b/, why: { en: 'changing the structure of a remote (possibly live) Supabase database', ru: 'изменение структуры удалённой (возможно, боевой) базы Supabase' } },
  { re: /\bprisma\s+migrate\s+reset\b/, why: { en: 'resetting the database with Prisma (all data is deleted)', ru: 'сброс базы через Prisma (все данные удалятся)' } },
  { re: /\bprisma\s+db\s+push\b.*--(force-reset|accept-data-loss)/, why: { en: 'changing the database with data loss', ru: 'изменение базы с потерей данных' } },
  { re: /\bdrizzle-kit\s+(push|drop)\b/, why: { en: 'changing the database structure with drizzle-kit', ru: 'изменение структуры базы через drizzle-kit' } },
  { re: /\bdropdb\b/, why: { en: 'deleting a database', ru: 'удаление базы данных' } },
  { re: /\bheroku\s+pg:reset\b/, why: { en: 'resetting the Heroku database', ru: 'сброс базы Heroku' } },
  { re: /\brailway\s+(down|delete)\b/, why: { en: 'deleting a Railway service', ru: 'удаление сервиса Railway' } },
  { re: /\bfly(ctl)?\s+(apps|volumes)\s+destroy\b/, why: { en: 'destroying a Fly.io app or volume', ru: 'удаление приложения или диска Fly.io' } },
  { re: /\bfirebase\s+(firestore:delete|database:remove)\b/, why: { en: 'deleting Firebase data', ru: 'удаление данных Firebase' } },
  { re: /\bgit\s+push\b.*\s(--force|-f|--force-with-lease)\b/, why: { en: 'force-overwriting history on GitHub', ru: 'принудительная перезапись истории на GitHub' } },
  { re: /\bgit\s+reset\s+--hard\b/, why: { en: 'a reset that loses unsaved changes', ru: 'откат с потерей несохранённых изменений' } },
  { re: /\bgit\s+clean\s+-[a-z]*f/, why: { en: 'deleting untracked files', ru: 'удаление неотслеживаемых файлов' } },
  { re: /\bvercel\b.*\s--prod\b/, why: { en: 'deploying to the live site (Vercel)', ru: 'деплой на боевой сайт (Vercel)' } },
  { re: /\bnetlify\s+deploy\b.*\s--prod\b/, why: { en: 'deploying to the live site (Netlify)', ru: 'деплой на боевой сайт (Netlify)' } },
  { re: /\bfirebase\s+deploy\b/, why: { en: 'deploying to Firebase', ru: 'деплой в Firebase' } },
  { re: /\beas\s+(submit|update\b.*--(branch|channel)\s+production)\b/, why: { en: 'publishing the mobile app', ru: 'публикация мобильного приложения' } },
  { re: /\bwrangler\s+(deploy|publish)\b/, why: { en: 'deploying to Cloudflare', ru: 'деплой в Cloudflare' } },
];

function rmTargetsUnsafe(command) {
  const reasons = [];
  // bash: rm -rf a b
  for (const m of command.matchAll(/\brm\s+((?:-[a-zA-Z]+\s+)+)([^;&|\n]+)/g)) {
    const flags = m[1];
    if (!/r/i.test(flags) || !/f/.test(flags)) continue;
    const targets = m[2].trim().split(/\s+/).map((x) => x.replace(/^["']|["']$/g, ''));
    if (targets.some((x) => !SAFE_RM_TARGETS.test(x))) reasons.push(t({ en: 'permanently deleting files: ', ru: 'безвозвратное удаление файлов: ' }) + targets.join(' '));
  }
  // PowerShell: Remove-Item ... -Recurse -Force
  for (const m of command.matchAll(/\bRemove-Item\b([^;\n|]*)/gi)) {
    const rest = m[1];
    if (!/-Recurse/i.test(rest)) continue;
    const targets = rest.replace(/-\w+(\s+\$\w+)?/g, ' ').trim().split(/[\s,]+/).filter(Boolean).map((x) => x.replace(/^["']|["']$/g, ''));
    if (!targets.length || targets.some((x) => !SAFE_RM_TARGETS.test(x))) {
      reasons.push(t({ en: 'permanently deleting a folder: ', ru: 'безвозвратное удаление папки: ' }) + (targets.join(' ') || t({ en: '(path not recognized)', ru: '(путь не распознан)' })));
    }
  }
  return reasons;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 });
}

// Parse a diff: added lines per file.
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
  if (envFiles.length) {
    deny.push(t({
      en: `a file with secrets is going into the repository: ${envFiles.join(', ')}. Remove it from git (git rm --cached) and add it to .gitignore (check 8)`,
      ru: `в репозиторий попадает файл с секретами: ${envFiles.join(', ')}. Его нужно убрать из git (git rm --cached) и добавить в .gitignore (пункт 8)`,
    }));
  }

  let diff = '';
  try {
    if (isCommit) diff = git(cwd, ['diff', '--cached', '-U0', '--no-color']) + (/\s-[a-zA-Z]*a/.test(command) ? git(cwd, ['diff', '-U0', '--no-color']) : '');
    else diff = git(cwd, ['log', '-p', '-U0', '--no-color', '@{u}..HEAD']);
  } catch {}
  const found = scanDiff(diff).slice(0, 5);
  for (const f of found) deny.push(`${f.file}: ${f.name} (${f.preview})`);
  if (found.length && isPush) {
    deny.push(t({
      en: 'the secret is already committed: deleting it from the code is not enough, it stays in history. Issue a new key in the service and remove the old one from history before pushing (check 9)',
      ru: 'секрет уже в коммите: просто удалить его из кода мало — он останется в истории. Нужно перевыпустить ключ в сервисе и убрать его из истории до push (пункт 9)',
    }));
  }
  return deny;
}

safeMain(async () => {
  const input = await readInput();
  const cfg = loadConfig(input.cwd);
  setLang(cfg.lang);
  if (cfg.mode === 'off') return;
  const command = (input.tool_input && input.tool_input.command) || '';
  if (!command) return;
  const cwd = input.cwd || process.cwd();

  const deny = [];
  const ask = [];

  // 1. Packages
  const pkgs = parseInstallCommand(command).filter((p) => !cfg.allowPackages.includes(p.name)).slice(0, 10);
  if (pkgs.length) {
    const results = await Promise.all(pkgs.map((p) => checkPackage(p.name, p.ecosystem)));
    for (const r of results) {
      if (r.level === 'deny') deny.push(...r.problems);
      else if (r.level === 'ask') ask.push(`"${r.name}": ${r.problems.join('; ')}`);
    }
  }

  // 2. Dangerous commands
  for (const d of DANGEROUS) if (d.re.test(command)) ask.push(t(d.why));
  ask.push(...rmTargetsUnsafe(command));

  // 3. Git
  deny.push(...gitChecks(command, cwd));

  if (deny.length) {
    const reason =
      t({ en: '[vibe-check] Command stopped:', ru: '[vibe-check] Команда остановлена:' }) + '\n' + deny.map((x) => '• ' + x).join('\n') +
      t({ en: '\n\nExplain the risk to the user in plain words, in their language, and suggest a safe alternative.', ru: '\n\nОбъясни пользователю простыми словами, в чём риск, и предложи безопасный вариант.' }) +
      (ask.length ? t({ en: '\nAlso note: ', ru: '\nТакже обрати внимание: ' }) + ask.join('; ') : '');
    return preToolDecision(cfg.mode === 'warn' ? 'ask' : 'deny', reason);
  }
  if (ask.length) {
    return preToolDecision(
      'ask',
      t({ en: '[vibe-check] Check before running:', ru: '[vibe-check] Проверь перед запуском:' }) + '\n' + ask.map((x) => '• ' + x).join('\n') +
        t({
          en: '\nMake sure this is not the live database or the live site, and that there is a fresh backup (checks 51, 57, 59).',
          ru: '\nУбедись, что это не боевая база и не живой сайт, и что есть свежий бэкап (пункты 51, 57, 59).',
        })
    );
  }
});
