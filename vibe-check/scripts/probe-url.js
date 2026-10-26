#!/usr/bin/env node
'use strict';
// Usage: node probe-url.js https://my-site.com
// Read-only check of a live site (GET/HEAD, about 20 requests): HTTPS, security headers, cookies, CORS,
// exposed service files, source maps, domain email records. Run it only against your own site.
// Output is data for Claude, so it's in English; Claude retells it in the user's language.
const dns = require('dns').promises;
require('./lib/i18n').setLang('en');
const { scanText } = require('./lib/patterns');

const input = process.argv[2];
if (!input) {
  console.error('Pass a URL: node probe-url.js https://example.com');
  process.exit(1);
}
const base = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input);
const results = [];
const add = (check, status, title, detail) => results.push({ check, status, title, detail });
const UA = { 'User-Agent': 'vibe-check-plugin (security self-check)' };

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 10000);
  try {
    const res = await fetch(url, { redirect: opts.redirect || 'follow', signal: ctrl.signal, headers: { ...UA, ...(opts.headers || {}) }, method: opts.method || 'GET' });
    const body = opts.method === 'HEAD' ? '' : (await res.text()).slice(0, 300000);
    return { res, body };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'no answer within 10 seconds' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const home = await get(base.href);
  if (home.error) {
    add(null, 'fail', 'The site did not open', home.error);
    return finish();
  }
  const h = home.res.headers;

  // 46. HTTPS and the redirect from http
  if (base.protocol !== 'https:') add(46, 'fail', 'The site works without HTTPS', 'A certificate is needed (free and automatic on Vercel, Netlify, Cloudflare).');
  const http = await get('http://' + base.host + '/', { redirect: 'manual' });
  if (!http.error) {
    const loc = http.res.headers.get('location') || '';
    if (http.res.status >= 300 && http.res.status < 400 && loc.startsWith('https://')) add(46, 'ok', 'http:// redirects to https://');
    else add(46, 'warn', 'http:// does not redirect to https://', `Status ${http.res.status}. Someone who types the address without https stays on the insecure version.`);
  }

  // 47. Security headers
  const hdr = (n) => h.get(n);
  const csp = hdr('content-security-policy') || '';
  const missing = [];
  if (!hdr('strict-transport-security')) missing.push('Strict-Transport-Security: the browser always opens the site over HTTPS');
  if (!csp) missing.push('Content-Security-Policy: blocks other people\'s scripts from running (XSS protection)');
  if (!hdr('x-frame-options') && !/frame-ancestors/.test(csp)) missing.push('X-Frame-Options or frame-ancestors: your site can\'t be embedded in someone else\'s page (clickjacking protection)');
  if (!hdr('x-content-type-options')) missing.push('X-Content-Type-Options: nosniff');
  if (!hdr('referrer-policy')) missing.push('Referrer-Policy: don\'t hand the full page address to other sites');
  if (missing.length) add(47, missing.length >= 3 ? 'warn' : 'info', `Missing security headers: ${missing.length}`, missing.join('\n'));
  else add(47, 'ok', 'Security headers are in place');

  // 48. Debug mode / versions
  const powered = hdr('x-powered-by') || '';
  const server = hdr('server') || '';
  if (powered) add(48, 'info', `The server reveals its technology: X-Powered-By: ${powered}`, 'A hint for attackers about which vulnerabilities to try. Better turned off.');
  if (/\d+\.\d+/.test(server)) add(48, 'info', `The server reveals its exact version: ${server}`);
  if (/__NEXT_DATA__[\s\S]{0,2000}"buildId":"development"|webpack-dev-server|vite\/client|react-refresh/.test(home.body)) add(48, 'fail', 'The site seems to run in development mode', 'A live site must run in production mode (NODE_ENV=production).');

  // 27. Cookies
  const cookies = typeof h.getSetCookie === 'function' ? h.getSetCookie() : (h.get('set-cookie') ? [h.get('set-cookie')] : []);
  for (const c of cookies) {
    const name = c.split('=')[0];
    const miss = [];
    if (!/;\s*secure/i.test(c)) miss.push('Secure');
    if (!/;\s*httponly/i.test(c)) miss.push('HttpOnly');
    if (!/;\s*samesite/i.test(c)) miss.push('SameSite');
    if (miss.length) add(27, /sess|auth|token|sid/i.test(name) ? 'warn' : 'info', `Cookie "${name}" is missing flags: ${miss.join(', ')}`);
  }

  // 52. CORS
  const cors = await get(base.href, { headers: { Origin: 'https://vibe-check-test.example' } });
  if (!cors.error) {
    const acao = cors.res.headers.get('access-control-allow-origin');
    const acac = cors.res.headers.get('access-control-allow-credentials');
    if (acao === 'https://vibe-check-test.example' && acac === 'true') add(52, 'fail', 'CORS lets any site in, together with the user\'s cookies', 'Another site can make requests on behalf of a logged-in user.');
    else if (acao === '*') add(52, 'info', 'CORS: Access-Control-Allow-Origin: *', 'Fine for public pages; not for an API with personal data.');
  }

  // 49. Exposed service files (compared with the answer for a page that certainly doesn't exist)
  const notFound = await get(new URL('/__vibe_check_' + Date.now(), base).href);
  const fallback = notFound.error ? '' : notFound.body;
  const looksLikeFallback = (r) => r.body === fallback || (fallback && Math.abs(r.body.length - fallback.length) < 50) || /<html/i.test(r.body.slice(0, 500));
  const probes = [
    { p: '/.env', test: (b) => /^[A-Z_][A-Z0-9_]*\s*=/m.test(b), title: 'The .env file with keys is open to everyone', sev: 'fail' },
    { p: '/.env.local', test: (b) => /^[A-Z_][A-Z0-9_]*\s*=/m.test(b), title: 'The .env.local file with keys is open to everyone', sev: 'fail' },
    { p: '/.git/HEAD', test: (b) => /^ref:\s/.test(b), title: 'The .git folder is open: anyone can download all source code and history', sev: 'fail' },
    { p: '/.git/config', test: (b) => /\[core\]/.test(b), title: 'The .git/config file is open', sev: 'fail' },
    { p: '/.DS_Store', test: (b) => b.includes('Bud1'), title: '.DS_Store is open (a list of files on the server)', sev: 'warn' },
    { p: '/api/debug', test: () => true, title: 'The /api/debug address is open', sev: 'warn' },
    { p: '/api/test', test: () => true, title: 'The /api/test address is open', sev: 'warn' },
    { p: '/phpinfo.php', test: (b) => /phpinfo|PHP Version/i.test(b), title: 'phpinfo is open (the whole server configuration)', sev: 'fail' },
    { p: '/server-status', test: (b) => /Apache Server Status/i.test(b), title: 'server-status is open', sev: 'warn' },
    { p: '/backup.sql', test: (b) => /CREATE TABLE|INSERT INTO/i.test(b), title: 'A database dump backup.sql is open', sev: 'fail' },
    { p: '/dump.sql', test: (b) => /CREATE TABLE|INSERT INTO/i.test(b), title: 'A database dump dump.sql is open', sev: 'fail' },
  ];
  const exposed = [];
  for (const pr of probes) {
    const r = await get(new URL(pr.p, base).href);
    if (r.error || r.res.status !== 200 || !r.body) continue;
    if (pr.p.startsWith('/api/') && looksLikeFallback(r)) continue;
    if (!pr.p.startsWith('/api/') && !pr.test(r.body)) continue;
    exposed.push(pr.p);
    add(49, pr.sev, pr.title, `${new URL(pr.p, base).href} returns 200. Close access and, if keys were there, issue new ones.`);
  }
  if (!exposed.length) add(49, 'ok', 'Service files (.env, .git, dumps, debug) are not exposed');

  // 13. Admin panel
  for (const p of ['/admin', '/wp-admin/', '/administrator']) {
    const r = await get(new URL(p, base).href);
    if (!r.error && r.res.status === 200 && !looksLikeFallback(r)) add(13, 'info', `The ${p} address opens`, 'Make sure nothing is visible without logging in and there is no default password.');
  }

  // 53. Source maps
  const scripts = [...home.body.matchAll(/<script[^>]+src=["']([^"']+\.js)(\?[^"']*)?["']/gi)].map((m) => new URL(m[1], base).href).filter((u) => new URL(u).host === base.host).slice(0, 5);
  let maps = 0;
  for (const s of scripts) {
    const r = await get(s + '.map', { method: 'HEAD' });
    if (!r.error && r.res.status === 200 && /json|octet|text/.test(r.res.headers.get('content-type') || '')) maps++;
  }
  if (maps) add(53, 'warn', `Front-end source code is published (source maps: ${maps})`, 'Anyone can read your source code. Turn off source maps for production in the build settings.');
  else if (scripts.length) add(53, 'ok', 'Source maps are not published');

  // 6. Keys right in the page HTML
  const leaks = scanText(home.body).filter((f) => f.severity === 'high');
  for (const l of leaks.slice(0, 5)) add(l.check, 'fail', `A secret is visible in the home page code: ${l.name}`, l.preview);

  // 55. Domain email
  const domain = base.hostname.replace(/^www\./, '');
  const noSpf = 'Without it, email from your domain lands in spam more often and the sender is easier to fake.';
  try {
    const txt = (await dns.resolveTxt(domain)).map((r) => r.join(''));
    const spf = txt.find((x) => x.startsWith('v=spf1'));
    add(55, spf ? 'ok' : 'warn', spf ? 'SPF is set up' : 'The domain has no SPF record', spf || noSpf);
  } catch {
    add(55, 'warn', 'The domain has no SPF record', noSpf);
  }
  const noDmarc = 'DMARC tells mail services what to do with fake emails sent in your name.';
  try {
    const dm = (await dns.resolveTxt('_dmarc.' + domain)).map((r) => r.join('')).find((x) => x.startsWith('v=DMARC1'));
    add(55, dm ? 'ok' : 'warn', dm ? 'DMARC is set up' : 'The domain has no DMARC record', dm || noDmarc);
  } catch {
    add(55, 'warn', 'The domain has no DMARC record', noDmarc);
  }
  add(55, 'info', 'DKIM is checked manually', 'It needs the selector from your email service (Resend, Google Workspace, Yandex 360): see their domain settings.');

  finish();
}

function finish() {
  const order = { fail: 0, warn: 1, info: 2, ok: 3 };
  results.sort((a, b) => order[a.status] - order[b.status]);
  process.stdout.write(JSON.stringify({ url: base.href, checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
}

main();
