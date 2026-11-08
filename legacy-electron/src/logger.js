'use strict';
const fs = require('fs');
const path = require('path');

let file = null;

function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'mis-cercas.log');
    try {
      if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old');
    } catch { /* aún no existe */ }
  } catch {
    file = null;
  }
}

function text(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function write(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map(text).join(' ')}\n`;
  if (level === 'ERROR') console.error(line.trim());
  if (file) {
    try { fs.appendFileSync(file, line); } catch { /* sin disco: se ignora */ }
  }
}

module.exports = {
  init,
  get file() { return file; },
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a)
};
