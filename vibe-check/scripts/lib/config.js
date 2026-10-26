'use strict';
const fs = require('fs');
const path = require('path');

// Настройки проекта: <проект>/.vibe-check/config.json
// mode: "block" — опасное запрещается (по умолчанию), "warn" — спрашивать, "off" — хуки молчат.
// allowPackages: пакеты, которые проверять не нужно. ignorePaths: части путей, которые не сканировать.
const DEFAULTS = { mode: 'block', allowPackages: [], ignorePaths: [] };

function loadConfig(cwd) {
  let cfg = { ...DEFAULTS };
  try {
    const raw = fs.readFileSync(path.join(cwd || process.cwd(), '.vibe-check', 'config.json'), 'utf8');
    cfg = { ...cfg, ...JSON.parse(raw) };
  } catch {
    // нет файла — значения по умолчанию
  }
  if (process.env.VIBE_CHECK_MODE) cfg.mode = process.env.VIBE_CHECK_MODE;
  return cfg;
}

module.exports = { loadConfig };
