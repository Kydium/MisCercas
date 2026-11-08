'use strict';
const { nativeTheme } = require('electron');
const store = require('./store');
const themes = require('./themes');

/** Tema que se está usando, ya resuelto (si el ajuste es "auto" sigue a Windows). */
function effective() {
  return themes.resolve(store.settings().theme, nativeTheme.shouldUseDarkColors);
}

/** Color de acento por defecto: el del tema o el que el usuario eligió. */
function accent() {
  const s = store.settings();
  return s.accentFollowsTheme ? effective().accent : s.accent;
}

module.exports = { effective, accent };
