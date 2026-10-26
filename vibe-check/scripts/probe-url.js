#!/usr/bin/env node
'use strict';
// Использование: node probe-url.js https://мой-сайт.ru
// Проверка живого сайта только чтением (GET/HEAD, около 20 запросов): HTTPS, защитные заголовки, куки, CORS,
// открытые служебные файлы, source maps, почтовые записи домена. Запускать только для своего сайта.
const dns = require('dns').promises;

const input = process.argv[2];
if (!input) {
  console.error('Укажи адрес: node probe-url.js https://example.com');
  process.exit(1);
}
const base = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input);
const results = [];
const add = (check, status, title, detail) => results.push({ check, status, title, detail });
const UA = { 'User-Agent': 'vibe-check-plugin (security self-check)' };

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 10000);
  try {
    const res = await fetch(url, { redirect: opts.redirect || 'follow', signal: ctrl.signal, headers: { ...UA, ...(opts.headers || {}) }, method: opts.method || 'GET' });
    const body = opts.method === 'HEAD' ? '' : (await res.text()).slice(0, 300000);
    return { res, body };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'нет ответа за 10 секунд' : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const home = await get(base.href);
  if (home.error) {
    add(null, 'fail', 'Сайт не открылся', home.error);
    return finish();
  }
  const h = home.res.headers;

  // 46. HTTPS и редирект с http
  if (base.protocol !== 'https:') add(46, 'fail', 'Сайт работает без HTTPS', 'Нужен сертификат (у Vercel, Netlify, Cloudflare он бесплатный и включается автоматически).');
  const http = await get('http://' + base.host + '/', { redirect: 'manual' });
  if (!http.error) {
    const loc = http.res.headers.get('location') || '';
    if (http.res.status >= 300 && http.res.status < 400 && loc.startsWith('https://')) add(46, 'ok', 'http:// перенаправляет на https://');
    else add(46, 'warn', 'http:// не перенаправляет на https://', `Ответ ${http.res.status}. Человек, набравший адрес без https, останется на незащищённой версии.`);
  }

  // 47. Защитные заголовки
  const hdr = (n) => h.get(n);
  const csp = hdr('content-security-policy') || '';
  const missing = [];
  if (!hdr('strict-transport-security')) missing.push('Strict-Transport-Security — браузер всегда открывает сайт только по HTTPS');
  if (!csp) missing.push('Content-Security-Policy — запрещает запуск чужих скриптов (защита от XSS)');
  if (!hdr('x-frame-options') && !/frame-ancestors/.test(csp)) missing.push('X-Frame-Options или frame-ancestors — твой сайт нельзя встроить в чужую страницу (защита от кликджекинга)');
  if (!hdr('x-content-type-options')) missing.push('X-Content-Type-Options: nosniff');
  if (!hdr('referrer-policy')) missing.push('Referrer-Policy — не отдавать чужим сайтам полный адрес страницы');
  if (missing.length) add(47, missing.length >= 3 ? 'warn' : 'info', `Не хватает защитных заголовков: ${missing.length}`, missing.join('\n'));
  else add(47, 'ok', 'Защитные заголовки на месте');

  // 48. Отладка / версии
  const powered = hdr('x-powered-by') || '';
  const server = hdr('server') || '';
  if (powered) add(48, 'info', `Сервер сообщает технологию: X-Powered-By: ${powered}`, 'Это подсказка атакующему, какие уязвимости пробовать. Лучше отключить.');
  if (/\d+\.\d+/.test(server)) add(48, 'info', `Сервер сообщает точную версию: ${server}`);
  if (/__NEXT_DATA__[\s\S]{0,2000}"buildId":"development"|webpack-dev-server|vite\/client|react-refresh/.test(home.body)) add(48, 'fail', 'Похоже, сайт запущен в режиме разработки', 'На боевом сайте должен быть production-режим (NODE_ENV=production).');

  // 27. Куки
  const cookies = typeof h.getSetCookie === 'function' ? h.getSetCookie() : (h.get('set-cookie') ? [h.get('set-cookie')] : []);
  for (const c of cookies) {
    const name = c.split('=')[0];
    const miss = [];
    if (!/;\s*secure/i.test(c)) miss.push('Secure');
    if (!/;\s*httponly/i.test(c)) miss.push('HttpOnly');
    if (!/;\s*samesite/i.test(c)) miss.push('SameSite');
    if (miss.length) add(27, /sess|auth|token|sid/i.test(name) ? 'warn' : 'info', `Куки «${name}» без флагов: ${miss.join(', ')}`);
  }

  // 52. CORS
  const cors = await get(base.href, { headers: { Origin: 'https://vibe-check-test.example' } });
  if (!cors.error) {
    const acao = cors.res.headers.get('access-control-allow-origin');
    const acac = cors.res.headers.get('access-control-allow-credentials');
    if (acao === 'https://vibe-check-test.example' && acac === 'true') add(52, 'fail', 'CORS пускает любой сайт вместе с куками пользователя', 'Чужой сайт может делать запросы от имени вошедшего пользователя.');
    else if (acao === '*') add(52, 'info', 'CORS: Access-Control-Allow-Origin: *', 'Для публичных страниц нормально; для API с личными данными — нет.');
  }

  // 49. Открытые служебные файлы (сравниваем с ответом на заведомо несуществующую страницу)
  const notFound = await get(new URL('/__vibe_check_' + Date.now(), base).href);
  const fallback = notFound.error ? '' : notFound.body;
  const looksLikeFallback = (r) => r.body === fallback || (fallback && Math.abs(r.body.length - fallback.length) < 50) || /<html/i.test(r.body.slice(0, 500));
  const probes = [
    { p: '/.env', test: (b) => /^[A-Z_][A-Z0-9_]*\s*=/m.test(b), title: 'Файл .env с ключами открыт всем', sev: 'fail' },
    { p: '/.env.local', test: (b) => /^[A-Z_][A-Z0-9_]*\s*=/m.test(b), title: 'Файл .env.local с ключами открыт всем', sev: 'fail' },
    { p: '/.git/HEAD', test: (b) => /^ref:\s/.test(b), title: 'Папка .git открыта: можно скачать весь исходный код и историю', sev: 'fail' },
    { p: '/.git/config', test: (b) => /\[core\]/.test(b), title: 'Файл .git/config открыт', sev: 'fail' },
    { p: '/.DS_Store', test: (b) => b.includes('Bud1'), title: 'Открыт .DS_Store (список файлов на сервере)', sev: 'warn' },
    { p: '/api/debug', test: () => true, title: 'Открыт адрес /api/debug', sev: 'warn' },
    { p: '/api/test', test: () => true, title: 'Открыт адрес /api/test', sev: 'warn' },
    { p: '/phpinfo.php', test: (b) => /phpinfo|PHP Version/i.test(b), title: 'Открыт phpinfo (вся конфигурация сервера)', sev: 'fail' },
    { p: '/server-status', test: (b) => /Apache Server Status/i.test(b), title: 'Открыт server-status', sev: 'warn' },
    { p: '/backup.sql', test: (b) => /CREATE TABLE|INSERT INTO/i.test(b), title: 'Открыт дамп базы backup.sql', sev: 'fail' },
    { p: '/dump.sql', test: (b) => /CREATE TABLE|INSERT INTO/i.test(b), title: 'Открыт дамп базы dump.sql', sev: 'fail' },
  ];
  const exposed = [];
  for (const pr of probes) {
    const r = await get(new URL(pr.p, base).href);
    if (r.error || r.res.status !== 200 || !r.body) continue;
    if (pr.p.startsWith('/api/') && looksLikeFallback(r)) continue;
    if (!pr.p.startsWith('/api/') && !pr.test(r.body)) continue;
    exposed.push(pr.p);
    add(49, pr.sev, pr.title, `${new URL(pr.p, base).href} отвечает 200. Закрой доступ и, если там были ключи, перевыпусти их.`);
  }
  if (!exposed.length) add(49, 'ok', 'Служебные файлы (.env, .git, дампы, debug) не открыты');

  // 50. Админка
  for (const p of ['/admin', '/wp-admin/', '/administrator']) {
    const r = await get(new URL(p, base).href);
    if (!r.error && r.res.status === 200 && !looksLikeFallback(r)) add(13, 'info', `Адрес ${p} открывается`, 'Проверь, что без входа там ничего не видно и что нет пароля по умолчанию.');
  }

  // 53. Source maps
  const scripts = [...home.body.matchAll(/<script[^>]+src=["']([^"']+\.js)(\?[^"']*)?["']/gi)].map((m) => new URL(m[1], base).href).filter((u) => new URL(u).host === base.host).slice(0, 5);
  let maps = 0;
  for (const s of scripts) {
    const r = await get(s + '.map', { method: 'HEAD' });
    if (!r.error && r.res.status === 200 && /json|octet|text/.test(r.res.headers.get('content-type') || '')) maps++;
  }
  if (maps) add(53, 'warn', `Исходный код фронта выложен (source maps: ${maps})`, 'Любой может прочитать твой исходный код. В настройках сборки отключи source maps для production.');
  else if (scripts.length) add(53, 'ok', 'Source maps не выложены');

  // 6. Ключи прямо в HTML страницы
  const { scanText } = require('./lib/patterns');
  const leaks = scanText(home.body).filter((f) => f.severity === 'high');
  for (const l of leaks.slice(0, 5)) add(l.check, 'fail', `В коде главной страницы виден секрет: ${l.name}`, l.preview);

  // 55. Почта домена
  const domain = base.hostname.replace(/^www\./, '');
  try {
    const txt = (await dns.resolveTxt(domain)).map((r) => r.join(''));
    const spf = txt.find((t) => t.startsWith('v=spf1'));
    add(55, spf ? 'ok' : 'warn', spf ? 'SPF настроен' : 'Нет SPF-записи у домена', spf || 'Без неё письма с твоего домена чаще попадают в спам, а подделать отправителя проще.');
  } catch {
    add(55, 'warn', 'Нет SPF-записи у домена', 'Без неё письма с твоего домена чаще попадают в спам.');
  }
  try {
    const dm = (await dns.resolveTxt('_dmarc.' + domain)).map((r) => r.join('')).find((t) => t.startsWith('v=DMARC1'));
    add(55, dm ? 'ok' : 'warn', dm ? 'DMARC настроен' : 'Нет DMARC-записи у домена', dm || 'DMARC говорит почтовикам, что делать с поддельными письмами от твоего имени.');
  } catch {
    add(55, 'warn', 'Нет DMARC-записи у домена', 'DMARC говорит почтовикам, что делать с поддельными письмами от твоего имени.');
  }
  add(55, 'info', 'DKIM проверяется вручную', 'Нужен селектор от почтового сервиса (Resend, Яндекс 360, Google Workspace) — смотри в их настройках домена.');

  finish();
}

function finish() {
  const order = { fail: 0, warn: 1, info: 2, ok: 3 };
  results.sort((a, b) => order[a.status] - order[b.status]);
  process.stdout.write(JSON.stringify({ url: base.href, checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
}

main();
