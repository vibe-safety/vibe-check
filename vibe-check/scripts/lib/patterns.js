'use strict';
const { t } = require('./i18n');
// Шаблоны секретов. severity: high — блокируем, medium — предупреждаем.
// check(value) — доп. фильтр против ложных срабатываний.

const hasDigitAndLetter = (v) => /\d/.test(v) && /[A-Za-z]/.test(v);

const SECRET_PATTERNS = [
  { id: 'anthropic', name: { en: 'Anthropic key (Claude API)', ru: 'ключ Anthropic (Claude API)' }, re: /sk-ant-[A-Za-z0-9_-]{20,}/g, severity: 'high' },
  { id: 'openai', name: { en: 'OpenAI key', ru: 'ключ OpenAI' }, re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, severity: 'high', check: hasDigitAndLetter },
  { id: 'stripe-live', name: { en: 'live Stripe secret key', ru: 'боевой секретный ключ Stripe' }, re: /\b[sr]k_live_[0-9a-zA-Z]{20,}/g, severity: 'high' },
  { id: 'stripe-test', name: { en: 'test Stripe secret key', ru: 'тестовый секретный ключ Stripe' }, re: /\bsk_test_[0-9a-zA-Z]{20,}/g, severity: 'medium' },
  { id: 'stripe-webhook', name: { en: 'Stripe webhook secret', ru: 'секрет вебхука Stripe' }, re: /\bwhsec_[A-Za-z0-9]{20,}/g, severity: 'high' },
  { id: 'supabase-secret', name: { en: 'Supabase secret key (sb_secret)', ru: 'секретный ключ Supabase (sb_secret)' }, re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g, severity: 'high' },
  { id: 'aws', name: { en: 'AWS access key', ru: 'ключ доступа AWS' }, re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: 'high' },
  { id: 'github', name: { en: 'GitHub token', ru: 'токен GitHub' }, re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g, severity: 'high' },
  { id: 'gitlab', name: { en: 'GitLab token', ru: 'токен GitLab' }, re: /\bglpat-[A-Za-z0-9_-]{20,}/g, severity: 'high' },
  { id: 'slack', name: { en: 'Slack token', ru: 'токен Slack' }, re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, severity: 'high' },
  { id: 'sendgrid', name: { en: 'SendGrid key', ru: 'ключ SendGrid' }, re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, severity: 'high' },
  { id: 'telegram', name: { en: 'Telegram bot token', ru: 'токен Telegram-бота' }, re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, severity: 'high' },
  { id: 'private-key', name: { en: 'private key', ru: 'приватный ключ' }, re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g, severity: 'high' },
  { id: 'google', name: { en: 'Google API key (Gemini, Maps, Firebase)', ru: 'ключ Google API (Gemini, Maps, Firebase)' }, re: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: 'medium',
    note: {
      en: 'A Firebase web key is public by design, but Gemini and paid Google API keys are secret.',
      ru: 'Ключ Firebase для веба публичный по задумке, но ключи Gemini и платных Google API — секретные.',
    } },
  { id: 'db-url', name: { en: 'database URL with a password', ru: 'адрес базы данных с паролем' }, re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/[^:\s'"`/]+:[^@\s'"`]+@[^\s'"`]+/g, severity: 'high',
    check: (v) => !/@(localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres|mysql|mongo|redis)(:|\/|$)/.test(v) && !/:(password|postgres|pass|secret|\$\{)/i.test(v) },
  { id: 'jwt-service-role', name: { en: 'Supabase service_role key (bypasses all database protection)', ru: 'ключ service_role Supabase (обходит всю защиту базы)' }, re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: 'high',
    check: (v) => jwtRole(v) === 'service_role' },
  { id: 'generic', name: { en: 'looks like a password or key in code', ru: 'похоже на пароль или ключ в коде' }, re: /(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)["']?\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/gi, severity: 'medium',
    check: (v) => hasDigitAndLetter(v) && !/process\.env|import\.meta|os\.environ|getenv|\$\{/.test(v) },
];

// Секретные имена переменных с «публичной» приставкой: такие значения уходят в браузер или в приложение.
const PUBLIC_ENV_RE = /\b(?:NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|PUBLIC_|GATSBY_)[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|OPENAI|ANTHROPIC|CLAUDE|GEMINI|GROQ|DEEPSEEK|DATABASE_URL|DB_PASS|PASSWORD|WEBHOOK|BOT_TOKEN|ADMIN_KEY)[A-Z0-9_]*\b/g;

const PLACEHOLDER_RE = /x{6,}|your[-_]|example|placeholder|dummy|changeme|replace[-_]?me|\.\.\.|<[^>]*>|\*{4,}|0{10,}/i;

function jwtRole(token) {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).role;
  } catch {
    return undefined;
  }
}

// Файлы, где секретам место: .env, .env.local и т.п. (но не .env.example).
function isSecretsFile(filePath) {
  const base = String(filePath).replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (/\.(example|sample|template|dist|defaults)$/.test(base)) return false;
  return /^\.env(\..+)?$/.test(base) || base === '.dev.vars' || base === 'secrets.toml';
}

function isExampleEnvFile(filePath) {
  const base = String(filePath).replace(/\\/g, '/').split('/').pop().toLowerCase();
  return /^\.env.*\.(example|sample|template|dist|defaults)$/.test(base);
}

function mask(value) {
  if (value.length <= 10) return value.slice(0, 3) + '…';
  return value.slice(0, 8) + '…' + value.slice(-2);
}

// Возвращает список находок в тексте. opts.secretsFile — файл .env: значения секретов там допустимы.
function scanText(text, opts = {}) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.length > 5000) line = line.slice(0, 5000);
    for (const m of line.matchAll(PUBLIC_ENV_RE)) {
      // Пропускаем строки, где переменная только упоминается в комментарии-объяснении
      findings.push({ rule: 'public-env', name: t({ en: `secret in the "public" variable ${m[0]}`, ru: `секрет в «публичной» переменной ${m[0]}` }), severity: 'high', line: i + 1, preview: m[0], check: 7 });
    }
    if (opts.secretsFile) return;
    for (const p of SECRET_PATTERNS) {
      p.re.lastIndex = 0;
      for (const m of line.matchAll(p.re)) {
        const value = m[1] || m[0];
        if (PLACEHOLDER_RE.test(value)) continue;
        if (p.check && !p.check(value)) continue;
        findings.push({ rule: p.id, name: t(p.name), severity: p.severity, line: i + 1, preview: mask(value), value, note: p.note && t(p.note), check: p.id === 'jwt-service-role' ? 10 : 6 });
      }
    }
  });
  // Убираем дубли (один ключ мог попасть под openai и generic)
  const seen = new Set();
  return findings.filter((f) => {
    const key = f.line + ':' + (f.value || f.preview);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { SECRET_PATTERNS, PUBLIC_ENV_RE, scanText, isSecretsFile, isExampleEnvFile, mask, jwtRole };
