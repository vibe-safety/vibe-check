'use strict';
// Проверка пакетов перед установкой: существует ли, давно ли появился, популярен ли, не опечатка ли.

const { t } = require('./i18n');

const POPULAR = {
  npm: ['react', 'react-dom', 'next', 'vue', 'nuxt', 'svelte', 'vite', 'typescript', 'express', 'fastify', 'axios', 'lodash',
    'zod', 'prisma', '@prisma/client', 'drizzle-orm', 'tailwindcss', 'postcss', 'autoprefixer', 'eslint', 'prettier', 'jest', 'vitest',
    'dotenv', 'cors', 'helmet', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'uuid', 'nanoid', 'dayjs', 'date-fns', 'moment', 'chalk',
    'commander', 'yargs', 'stripe', 'openai', '@anthropic-ai/sdk', 'ai', 'langchain', 'firebase', '@supabase/supabase-js', 'mongoose',
    'mongodb', 'pg', 'mysql2', 'redis', 'ioredis', 'socket.io', 'ws', 'multer', 'sharp', 'nodemailer', 'resend', 'telegraf', 'grammy',
    'node-telegram-bot-api', 'expo', 'react-native', 'framer-motion', 'three', 'clsx', 'class-variance-authority', 'lucide-react',
    'react-hook-form', '@tanstack/react-query', 'swr', 'zustand', 'redux', '@reduxjs/toolkit', 'react-router-dom', 'next-auth',
    'shadcn', 'radix-ui', 'sonner', 'recharts', 'chart.js', 'puppeteer', 'playwright', 'cheerio', 'body-parser', 'cookie-parser',
    'express-rate-limit', 'rate-limiter-flexible', 'dompurify', 'isomorphic-dompurify', 'sanitize-html', 'validator', 'yup', 'joi',
    'create-next-app', 'create-vite', 'nodemon', 'ts-node', 'tsx', 'concurrently', 'cross-env', 'husky', 'lint-staged', 'webpack',
    'esbuild', 'rollup', 'babel', 'core-js', 'graphql', 'apollo-server', '@apollo/client', 'trpc', 'hono', 'koa', 'nestjs', '@nestjs/core'],
  pypi: ['requests', 'numpy', 'pandas', 'flask', 'django', 'fastapi', 'uvicorn', 'pydantic', 'sqlalchemy', 'psycopg2', 'psycopg2-binary',
    'openai', 'anthropic', 'langchain', 'python-dotenv', 'aiogram', 'python-telegram-bot', 'pytelegrambotapi', 'httpx', 'aiohttp',
    'beautifulsoup4', 'selenium', 'playwright', 'pillow', 'matplotlib', 'scikit-learn', 'torch', 'tensorflow', 'transformers',
    'boto3', 'stripe', 'supabase', 'firebase-admin', 'celery', 'redis', 'pymongo', 'gunicorn', 'jinja2', 'streamlit', 'gradio',
    'pytest', 'black', 'ruff', 'mypy', 'pyjwt', 'bcrypt', 'passlib', 'cryptography', 'yookassa', 'google-generativeai', 'tiktoken'],
};

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // перестановка соседних букв (axois → axios) — тоже одна ошибка
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

function lookalike(name, ecosystem) {
  const list = POPULAR[ecosystem] || [];
  if (list.includes(name) || name.length < 4) return null;
  const strip = (s) => s.replace(/[-_.]/g, '').toLowerCase();
  for (const p of list) {
    if (strip(p) === strip(name) && p !== name) return p;
    if (levenshtein(name, p) === 1) return p;
  }
  return null;
}

async function getJson(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'vibe-check-plugin' } });
    if (res.status === 404) return { status: 404 };
    if (!res.ok) return { status: res.status, error: true };
    return { status: 200, body: await res.json() };
  } finally {
    clearTimeout(t);
  }
}

const DAY = 24 * 3600 * 1000;

// Возвращает { name, ecosystem, exists, ageDays, weeklyDownloads, lookalike, problems: [], level: ok|ask|deny|unknown }
async function checkPackage(name, ecosystem) {
  const r = { name, ecosystem, problems: [], level: 'ok' };
  r.lookalike = lookalike(name, ecosystem);
  try {
    if (ecosystem === 'npm') {
      const enc = name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name);
      const dl = await getJson(`https://api.npmjs.org/downloads/point/last-week/${enc}`).catch(() => null);
      if (dl && dl.status === 200) r.weeklyDownloads = dl.body.downloads;
      if (!(r.weeklyDownloads >= 1000)) {
        const meta = await getJson(`https://registry.npmjs.org/${enc}`, 6000);
        if (meta.status === 404) r.exists = false;
        else if (meta.status === 200) {
          r.exists = true;
          const created = meta.body.time && meta.body.time.created;
          if (created) r.ageDays = Math.floor((Date.now() - Date.parse(created)) / DAY);
        }
      } else r.exists = true;
    } else if (ecosystem === 'pypi') {
      const meta = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, 6000);
      if (meta.status === 404) r.exists = false;
      else if (meta.status === 200) {
        r.exists = true;
        let first = Infinity;
        for (const files of Object.values(meta.body.releases || {})) {
          for (const f of files) {
            const t = Date.parse(f.upload_time_iso_8601 || f.upload_time);
            if (t < first) first = t;
          }
        }
        if (first !== Infinity) r.ageDays = Math.floor((Date.now() - first) / DAY);
        r.releases = Object.keys(meta.body.releases || {}).length;
      }
    }
  } catch {
    r.level = 'unknown';
    return r;
  }

  if (r.exists === false) {
    r.level = 'deny';
    r.problems.push(t({
      en: `package "${name}" does not exist in ${ecosystem}. AI most likely made up the name, and attackers register such names with malicious code (check 57)`,
      ru: `пакета «${name}» не существует в ${ecosystem}. Скорее всего, ИИ выдумал название — а злоумышленники регистрируют такие названия с вредоносным кодом (пункт 57)`,
    }));
  } else if (r.exists === undefined) {
    r.level = 'unknown';
  } else {
    if (r.ageDays !== undefined && r.ageDays < 30) r.problems.push(t({ en: `the package appeared only ${r.ageDays} days ago`, ru: `пакет появился всего ${r.ageDays} дн. назад` }));
    if (r.weeklyDownloads !== undefined && r.weeklyDownloads < 50) r.problems.push(t({ en: `the package has only ${r.weeklyDownloads} downloads a week`, ru: `у пакета всего ${r.weeklyDownloads} скачиваний в неделю` }));
    if (r.releases !== undefined && r.releases < 2 && r.ageDays !== undefined && r.ageDays < 180) r.problems.push(t({ en: 'the package is new and has a single version', ru: 'у пакета одна версия и он новый' }));
    if (r.problems.length) r.level = 'ask';
  }
  if (r.lookalike && r.level !== 'deny') {
    r.problems.push(t({ en: `the name is very close to the popular "${r.lookalike}": check for a typo`, ru: `название очень похоже на популярный «${r.lookalike}» — проверь, нет ли опечатки` }));
    r.level = 'ask';
  }
  return r;
}

// Разбор команды установки. Возвращает [{ name, ecosystem }].
function parseInstallCommand(command) {
  const result = [];
  const segments = String(command).split(/&&|\|\||;|\n|\|/);
  for (const seg of segments) {
    const tokens = seg.trim().match(/"[^"]*"|'[^']*'|\S+/g);
    if (!tokens) continue;
    const t = tokens.map((x) => x.replace(/^["']|["']$/g, ''));
    let i = 0;
    while (i < t.length && /^[A-Z_]+=/.test(t[i])) i++; // FOO=bar npm i
    const cmd = t.slice(i);
    if (!cmd.length) continue;
    let eco = null;
    let args = [];
    const [a, b, c] = cmd;
    if (a === 'npm' && ['i', 'install', 'add', 'in', 'isntall'].includes(b)) { eco = 'npm'; args = cmd.slice(2); }
    else if ((a === 'pnpm' || a === 'yarn' || a === 'bun') && b === 'add') { eco = 'npm'; args = cmd.slice(2); }
    else if (a === 'bun' && (b === 'i' || b === 'install')) { eco = 'npm'; args = cmd.slice(2); }
    else if (a === 'npx' || a === 'bunx') { eco = 'npm'; args = cmd.slice(1).filter((x) => !x.startsWith('-')).slice(0, 1); }
    else if ((a === 'pnpm' && b === 'dlx') || (a === 'yarn' && b === 'dlx')) { eco = 'npm'; args = cmd.slice(2).filter((x) => !x.startsWith('-')).slice(0, 1); }
    else if (/^pip3?$/.test(a) && b === 'install') { eco = 'pypi'; args = cmd.slice(2); }
    else if (/^python3?$/.test(a) && b === '-m' && c === 'pip' && cmd[3] === 'install') { eco = 'pypi'; args = cmd.slice(4); }
    else if (a === 'uv' && b === 'pip' && c === 'install') { eco = 'pypi'; args = cmd.slice(3); }
    else if ((a === 'uv' || a === 'poetry') && b === 'add') { eco = 'pypi'; args = cmd.slice(2); }
    if (!eco) continue;
    let skipNext = false;
    for (const arg of args) {
      if (skipNext) { skipNext = false; continue; }
      if (['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-t', '--target', '--index-url', '-i', '--prefix', '--registry'].includes(arg)) { skipNext = true; continue; }
      if (arg.startsWith('-')) continue;
      if (/^(\.|\/|~|[A-Za-z]:\\|https?:|git[+@:]|file:|npm:|link:|workspace:)/.test(arg)) continue;
      if (/\.(txt|whl|tgz|tar\.gz|zip)$/.test(arg)) continue;
      let name = arg;
      if (eco === 'npm') {
        if (!name.startsWith('@') && name.includes('/')) continue; // github:user/repo и подобное
        const at = name.indexOf('@', name.startsWith('@') ? 1 : 0);
        if (at > 0) name = name.slice(0, at);
      } else {
        name = name.split(/[=<>!~\[;@ ]/)[0];
      }
      if (name && /^[@a-zA-Z0-9][\w.\-\/@]*$/.test(name)) result.push({ name: name.toLowerCase(), ecosystem: eco });
    }
  }
  return result;
}

module.exports = { checkPackage, parseInstallCommand, lookalike, POPULAR };
