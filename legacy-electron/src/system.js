'use strict';
const { app, globalShortcut } = require('electron');
const log = require('./logger');

/* ---------- iniciar con Windows ---------- */
function loginOptions() {
  // Instalada como .exe no hacen falta argumentos; en modo desarrollo hay que indicar la carpeta de la app.
  return { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] };
}

function getAutoStart() {
  try { return !!app.getLoginItemSettings(loginOptions()).openAtLogin; } catch { return false; }
}

function setAutoStart(on) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, ...loginOptions() });
    return true;
  } catch (e) {
    log.warn('No se pudo cambiar el inicio con Windows', e.message);
    return false;
  }
}

/* ---------- atajo global ---------- */
let current = null;
let currentHandler = null;

function setHotkey(accel, handler = currentHandler) {
  const prev = current;
  try { if (prev) globalShortcut.unregister(prev); } catch { /* nada */ }
  let ok = false;
  try {
    ok = globalShortcut.register(accel, handler);
  } catch (e) {
    log.warn('Atajo no válido', accel, e.message);
  }
  if (ok) {
    current = accel;
    currentHandler = handler;
    return true;
  }
  if (prev && currentHandler) {
    try { globalShortcut.register(prev, currentHandler); } catch { /* nada */ }
  }
  return false;
}

function releaseHotkeys() {
  try { globalShortcut.unregisterAll(); } catch { /* nada */ }
}

module.exports = { getAutoStart, setAutoStart, setHotkey, releaseHotkeys };
