'use strict';
// Обход файлов проекта и определение стека (какие модули проверки включить).
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', '.vibe-check', 'vendor', 'venv', '.venv', 'env', '__pycache__', '.turbo',
  '.cache', 'coverage', '.idea', '.vscode', 'Pods', '.gradle', '.expo', '.svelte-kit', '.nuxt', '.output', 'target', '.dart_tool']);
// Папки сборки: сканируем отдельно — то, что в них, видит любой посетитель.
const BUILD_DIRS = new Set(['dist', 'build', 'out', '.next', 'public']);
const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|html|htm|json|ya?ml|toml|ini|env|py|rb|php|go|rs|java|kt|swift|dart|sql|sh|ps1|md|txt|cfg|conf|xml|gradle|plist|properties|map)$/i;
const MAX_FILE = 2 * 1024 * 1024;

function* walk(root, opts = {}) {
  const ignore = opts.ignorePaths || [];
  const stack = [root];
  let count = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (ignore.some((p) => rel.includes(p))) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name === '.next') {
          // в .next в браузер уходит только static
          stack.push(path.join(full, 'static'));
          continue;
        }
        stack.push(full);
      } else if (e.isFile()) {
        const isEnv = /^\.env/.test(e.name) || e.name === '.dev.vars';
        if (!isEnv && !TEXT_EXT.test(e.name)) continue;
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          continue;
        }
        if (size > MAX_FILE) continue;
        const top = rel.split('/')[0];
        yield { full, rel, inBuild: BUILD_DIRS.has(top) && top !== 'public' ? true : rel.startsWith('.next/'), isPublicDir: top === 'public' };
        if (++count > (opts.maxFiles || 20000)) return;
      }
    }
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function loadModules() {
  return readJson(path.join(__dirname, '..', '..', 'catalog', 'modules.json'));
}

// Собирает зависимости из package.json (корень + 2 уровня вглубь), requirements.txt, pyproject.toml, pubspec.yaml.
function collectDeps(root) {
  const deps = new Set();
  const manifests = [];
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 2 && !SKIP_DIRS.has(e.name) && !BUILD_DIRS.has(e.name) && !e.name.startsWith('.')) visit(full, depth + 1);
        continue;
      }
      if (e.name === 'package.json') {
        const pkg = readJson(full);
        if (!pkg) continue;
        manifests.push(path.relative(root, full));
        for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) Object.keys(pkg[k] || {}).forEach((d) => deps.add(d.toLowerCase()));
      } else if (/^requirements.*\.txt$/.test(e.name) || e.name === 'pyproject.toml' || e.name === 'Pipfile' || e.name === 'pubspec.yaml') {
        manifests.push(path.relative(root, full));
        const text = fs.readFileSync(full, 'utf8');
        if (e.name === 'pubspec.yaml') deps.add('flutter');
        for (const line of text.split(/\r?\n/)) {
          const m = line.trim().match(/^["']?([A-Za-z0-9][A-Za-z0-9_.\-]*)/);
          if (m && !line.trim().startsWith('#') && !line.trim().startsWith('[')) deps.add(m[1].toLowerCase());
        }
      }
    }
  };
  visit(root, 0);
  return { deps, manifests };
}

function exists(root, rel) {
  try {
    fs.accessSync(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

// Признаки России: lang="ru", кириллица в интерфейсе, рубли, домен .ru/.рф.
function detectRussia(root) {
  const kinds = { 'lang="ru"': [], 'рубли': [], 'домен .ru/.рф': [], 'русский текст': [] };
  for (const f of walk(root, { maxFiles: 400 })) {
    if (f.inBuild || !/\.(jsx|tsx|vue|svelte|astro|html|py)$/i.test(f.rel)) continue;
    let text;
    try {
      text = fs.readFileSync(f.full, 'utf8').slice(0, 200000);
    } catch {
      continue;
    }
    if (/lang=["']ru["']/.test(text)) kinds['lang="ru"'].push(f.rel);
    if (/₽|\bRUB\b|руб\./.test(text)) kinds['рубли'].push(f.rel);
    if (/https?:\/\/[^\s"'`]+\.(ru|рф)\b/.test(text)) kinds['домен .ru/.рф'].push(f.rel);
    if ((text.match(/[а-яё]{4,}/gi) || []).length > 5) kinds['русский текст'].push(f.rel);
  }
  if (kinds['русский текст'].length < 3) kinds['русский текст'] = [];
  const signals = Object.entries(kinds)
    .filter(([, files]) => files.length)
    .map(([kind, files]) => `${kind} (${files.length === 1 ? files[0] : 'в ' + files.length + ' файлах'})`);
  return { isRussia: signals.length > 0, signals };
}

function detectStack(root, { withRussia = true } = {}) {
  const catalog = loadModules();
  const { deps, manifests } = collectDeps(root);
  const modules = [];
  for (const m of catalog.modules) {
    if (m.onDemand) continue;
    if (m.always) {
      modules.push({ id: m.id, title: m.title, reasons: ['всегда'] });
      continue;
    }
    if (m.id === 'russia') continue;
    const reasons = [];
    for (const d of m.deps || []) if (deps.has(d.toLowerCase())) reasons.push(`зависимость ${d}`);
    for (const f of m.files || []) if (exists(root, f)) reasons.push(`файл ${f}`);
    // мобильное: android/ios одни ничего не значат без expo/react-native/capacitor/flutter
    if (m.id === 'mobile' && reasons.length && !reasons.some((r) => r.startsWith('зависимость'))) {
      if (!exists(root, 'app.json') || !deps.has('expo')) continue;
    }
    if (reasons.length) modules.push({ id: m.id, title: m.title, reasons: reasons.slice(0, 4) });
  }
  const foreign = [];
  for (const d of catalog.foreignInfra.deps) if (deps.has(d)) foreign.push(d);
  for (const f of catalog.foreignInfra.files) if (exists(root, f)) foreign.push(f);
  let russia = { isRussia: false, signals: [] };
  if (withRussia) {
    russia = detectRussia(root);
    if (russia.isRussia) {
      const m = catalog.modules.find((x) => x.id === 'russia');
      modules.push({ id: m.id, title: m.title, reasons: russia.signals });
    }
  }
  const checks = new Set();
  for (const m of modules) catalog.modules.find((x) => x.id === m.id).checks.forEach((c) => checks.add(c));
  return {
    root,
    manifests,
    modules,
    checks: [...checks].sort((a, b) => a - b),
    foreignInfra: [...new Set(foreign)],
    russia,
    isProject: manifests.length > 0 || exists(root, 'index.html'),
  };
}

module.exports = { walk, detectStack, collectDeps, readJson, exists };
