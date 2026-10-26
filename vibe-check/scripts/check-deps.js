#!/usr/bin/env node
'use strict';
// Использование: node check-deps.js [папка проекта]
// Проверяет библиотеки: известные уязвимости (npm audit), lockfile, существование и «подозрительность» каждого пакета.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkPackage } = require('./lib/packages');
const { readJson } = require('./lib/project');
const { loadConfig } = require('./lib/config');

const root = path.resolve(process.argv[2] || process.cwd());
const cfg = loadConfig(root);
const report = { root, lockfiles: [], audit: null, packages: [], problems: [] };

const LOCKS = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'poetry.lock', 'uv.lock', 'Pipfile.lock'];
report.lockfiles = LOCKS.filter((l) => fs.existsSync(path.join(root, l)));

const pkg = readJson(path.join(root, 'package.json'));
const npmDeps = pkg ? Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }) : [];
let pyDeps = [];
for (const f of ['requirements.txt', 'requirements-dev.txt']) {
  try {
    pyDeps.push(
      ...fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
        .map((l) => l.split(/[=<>!~\[;@ ]/)[0].toLowerCase())
    );
  } catch {}
}
pyDeps = [...new Set(pyDeps)];

if ((npmDeps.length || pyDeps.length) && !report.lockfiles.length) report.problems.push({ check: 58, text: 'нет lockfile — версии библиотек не зафиксированы' });

// npm audit
if (pkg && report.lockfiles.includes('package-lock.json')) {
  let out = '';
  try {
    out = execFileSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000, shell: process.platform === 'win32' });
  } catch (e) {
    out = (e.stdout || '').toString(); // npm audit выходит с ошибкой, если нашёл уязвимости
  }
  try {
    const j = JSON.parse(out);
    const v = (j.metadata && j.metadata.vulnerabilities) || {};
    const top = Object.values(j.vulnerabilities || {})
      .filter((x) => x.severity === 'critical' || x.severity === 'high')
      .slice(0, 15)
      .map((x) => ({ name: x.name, severity: x.severity, direct: x.isDirect, fix: x.fixAvailable ? (x.fixAvailable === true ? 'npm audit fix' : `обновить ${x.fixAvailable.name} до ${x.fixAvailable.version}`) : 'исправления пока нет' }));
    report.audit = { tool: 'npm audit', counts: v, top };
  } catch {
    report.audit = { tool: 'npm audit', error: 'не удалось запустить npm audit (нет интернета или npm)' };
  }
} else if (pkg) {
  report.audit = { tool: 'npm audit', error: 'нет package-lock.json: npm audit работает только с ним. Можно создать командой npm install --package-lock-only' };
}

// Существование и «подозрительность» пакетов
async function main() {
  const list = [
    ...npmDeps.filter((n) => !cfg.allowPackages.includes(n)).map((n) => ({ name: n, ecosystem: 'npm' })),
    ...pyDeps.filter((n) => !cfg.allowPackages.includes(n)).map((n) => ({ name: n, ecosystem: 'pypi' })),
  ].slice(0, 150);
  const queue = [...list];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const r = await checkPackage(p.name, p.ecosystem);
      if (r.level === 'deny' || r.level === 'ask') report.packages.push({ name: r.name, ecosystem: r.ecosystem, level: r.level, problems: r.problems, ageDays: r.ageDays, weeklyDownloads: r.weeklyDownloads });
      else if (r.level === 'unknown') report.packages.push({ name: r.name, ecosystem: r.ecosystem, level: 'unknown', problems: ['не удалось проверить (нет ответа реестра)'] });
    }
  });
  await Promise.all(workers);
  report.checked = list.length;
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main();
