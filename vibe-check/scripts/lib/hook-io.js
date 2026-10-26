'use strict';

function readInput() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// Без process.exit(): на Windows выход при незакрытом fetch роняет Node. Вызывающий делает return.

// decision: "deny" | "ask". reason видит Claude (и пользователь при "ask").
function preToolDecision(decision, reason, systemMessage) {
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } };
  if (systemMessage) out.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(out));
}

// Предупреждение без остановки: показывается пользователю.
function warnOnly(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
}

// Хук никогда не должен ломать работу: любая внутренняя ошибка = пропустить.
function safeMain(fn) {
  fn().catch(() => {
    process.exitCode = 0;
  });
}

module.exports = { readInput, preToolDecision, warnOnly, safeMain };
