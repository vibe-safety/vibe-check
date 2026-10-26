#!/usr/bin/env node
'use strict';
// Использование: node scan-secrets.js [папка проекта] [--history]
// Ищет секреты в файлах проекта и в собранном коде, проверяет .gitignore и .env в git.
// --history: ищет ключи в истории git (удалённые из кода, но оставшиеся в коммитах).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { walk } = require('./lib/project');
const { scanText, isSecretsFile, isExampleEnvFile } = require('./lib/patterns');
const { loadConfig } = require('./lib/config');

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
const withHistory = args.includes('--history');
const cfg = loadConfig(root);

function git(gitArgs, maxMb = 50) {
  return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', maxBuffer: maxMb * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
}

const report = { root, findings: [], envFiles: [], gitignore: {}, git: {}, history: [] };
const currentValues = new Set();

for (const f of walk(root, { ignorePaths: cfg.ignorePaths })) {
  let text;
  try {
    text = fs.readFileSync(f.full, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue;
  const secretsFile = isSecretsFile(f.rel);
  if (secretsFile) report.envFiles.push(f.rel);
  const found = scanText(text, { secretsFile });
  if (isExampleEnvFile(f.rel)) for (const x of scanText(text)) if (x.rule !== 'public-env' && x.severity === 'high') found.push({ ...x, name: x.name + ' в файле-примере' });
  for (const x of found) {
    if (x.value) currentValues.add(x.value);
    report.findings.push({
      file: f.rel,
      line: x.line,
      check: x.check,
      severity: x.severity,
      what: x.name,
      preview: x.preview,
      where: f.inBuild ? 'собранный код (видит любой посетитель)' : f.isPublicDir ? 'папка public (видит любой посетитель)' : 'исходный код',
      note: x.note,
    });
  }
}

// .gitignore
try {
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  report.gitignore.exists = true;
  report.gitignore.coversEnv = /^\s*\/?\.env(\*|\.\*|\.local)?\s*$/m.test(gi) || /^\s*\*\.env\s*$/m.test(gi) || /^\s*\.env\*?\s*$/m.test(gi);
  report.gitignore.coversVibeCheck = /\.vibe-check/.test(gi);
} catch {
  report.gitignore.exists = false;
}

// git: отслеживаются ли .env, есть ли удалённый репозиторий
try {
  git(['rev-parse', '--is-inside-work-tree']);
  report.git.isRepo = true;
  report.git.trackedEnvFiles = git(['ls-files']).split('\n').filter((x) => x && isSecretsFile(x));
  try {
    report.git.remotes = git(['remote', '-v']).split('\n').filter(Boolean).map((l) => l.split(/\s+/)[1]).filter((v, i, a) => a.indexOf(v) === i);
  } catch {
    report.git.remotes = [];
  }
  report.git.hasLockfile = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'poetry.lock', 'uv.lock', 'Pipfile.lock'].filter((l) => fs.existsSync(path.join(root, l)));
} catch {
  report.git.isRepo = false;
}

// История git
if (withHistory && report.git.isRepo) {
  let log = '';
  try {
    log = git(['log', '-p', '-U0', '--no-color', '--all', '--format=@@COMMIT %h %ad', '--date=short', '-n', '2000'], 200);
  } catch {}
  let commit = '';
  let file = '';
  const seen = new Set();
  for (const line of log.split('\n')) {
    if (line.startsWith('@@COMMIT ')) {
      commit = line.slice(9);
      continue;
    }
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const isEnv = isSecretsFile(file);
    for (const x of scanText(line.slice(1))) {
      if (x.severity !== 'high' || x.rule === 'public-env') continue;
      const key = x.value || x.preview;
      if (seen.has(key)) continue;
      seen.add(key);
      report.history.push({
        commit,
        file,
        what: x.name,
        preview: x.preview,
        stillInCode: currentValues.has(x.value),
        committedEnvFile: isEnv,
      });
    }
  }
}

report.summary = {
  high: report.findings.filter((f) => f.severity === 'high').length,
  medium: report.findings.filter((f) => f.severity === 'medium').length,
  inHistory: report.history.length,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
