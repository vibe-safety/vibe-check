'use strict';
// Language for messages the user sees: config "lang" → VIBE_CHECK_LANG → system locale (ru* → ru, otherwise en).

let current = null;

function detect() {
  const env = (process.env.VIBE_CHECK_LANG || '').toLowerCase();
  if (env === 'ru' || env === 'en') return env;
  let locale = '';
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {}
  locale = locale || process.env.LANG || process.env.LC_ALL || '';
  return /^ru/i.test(locale) ? 'ru' : 'en';
}

function setLang(lang) {
  current = lang === 'ru' || lang === 'en' ? lang : detect();
}

function lang() {
  if (!current) current = detect();
  return current;
}

// t({ en: '…', ru: '…' }) → text in the current language
function t(msg) {
  if (typeof msg === 'string') return msg;
  return msg[lang()] || msg.en;
}

module.exports = { t, lang, setLang, detect };
