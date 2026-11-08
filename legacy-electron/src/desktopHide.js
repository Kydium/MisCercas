'use strict';
// Lo que está en una cerca y vive en el Escritorio se oculta del Escritorio (atributo «oculto»; no se mueve ni
// se borra nada), para no ver el icono dos veces. Al sacarlo de la cerca, o al desactivar el ajuste, se vuelve a mostrar.
// Solo se vuelve a mostrar lo que ocultó esta aplicación; lo que el usuario ya tuviera oculto no se toca.
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { execFile } = require('child_process');
const store = require('./store');
const util = require('./util');
const hidefile = require('./hidefile');
const log = require('./logger');

const SETTLE = 400;
const key = (p) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : p);

let timer = null;
let running = false;
let pending = false;
let asked = new Set();
let dirsCache = null;

function dirs() {
  if (!dirsCache) dirsCache = util.desktopDirs(app.getPath('desktop')).map(key);
  return dirsCache;
}

/** ¿Está en un Escritorio (del usuario, público o de OneDrive)? */
function inDesktop(p) {
  if (typeof p !== 'string' || !p) return false;
  return dirs().includes(key(path.dirname(p)));
}

const enabled = () => store.settings().hideDesktop && hidefile.available();

/** Rutas que deberían estar ocultas ahora: elementos del Escritorio que están en cercas normales. */
function desired() {
  const out = new Map();
  if (!enabled()) return out;
  for (const f of store.fences()) {
    if (f.portal) continue;
    for (const it of f.items) if (inDesktop(it.p)) out.set(key(it.p), it.p);
  }
  return out;
}

const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };

async function runOnce() {
  const want = desired();
  const ours = new Map(store.hiddenList().map((p) => [key(p), p]));
  const failures = [];

  for (const [k, p] of want) {
    if (ours.has(k) || !exists(p)) continue;
    if (hidefile.isHidden(p)) continue; // ya estaba oculto por el usuario: no es nuestro, no se toca
    if (hidefile.setHidden(p, true)) ours.set(k, p); else failures.push({ p, hide: true });
  }
  for (const [k, p] of [...ours]) {
    if (want.has(k)) continue;
    if (!exists(p) || hidefile.setHidden(p, false)) ours.delete(k); else failures.push({ p, hide: false });
  }
  store.setHiddenList([...ours.values()]);
  if (failures.length) await askAdmin(failures, ours);
}

// Los accesos directos del Escritorio público (de todos los usuarios) suelen necesitar permisos de administrador.
async function askAdmin(failures, ours) {
  const fresh = failures.filter((f) => !asked.has(key(f.p) + f.hide));
  if (!fresh.length || process.platform !== 'win32') return;
  for (const f of fresh) asked.add(key(f.p) + f.hide);
  log.warn('No se pudo cambiar el atributo oculto de', fresh.length, 'elemento(s):', fresh.slice(0, 3).map((f) => f.p).join(' | '));
  const r = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Continuar', 'Ahora no'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'Mis Cercas',
    message: `${fresh.length} acceso(s) directo(s) están en el Escritorio de todos los usuarios`,
    detail: 'Para ocultarlos o mostrarlos Windows pide permisos de administrador. Se abrirá una ventana de confirmación. No se borra ni se mueve nada.'
  });
  if (r.response !== 0) return;
  const script = path.join(app.getPath('userData'), 'ocultar.cmd');
  const lines = ['@echo off', ...fresh.map((f) => `attrib ${f.hide ? '+h' : '-h'} "${f.p}"`)];
  try {
    fs.writeFileSync(script, lines.join('\r\n') + '\r\n');
    await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${script.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden -Wait`], { windowsHide: true }, () => resolve());
    });
  } catch (e) {
    log.warn('No se pudo ejecutar el cambio con permisos de administrador', e.message);
  }
  try { fs.unlinkSync(script); } catch { /* ya no está */ }
  for (const f of fresh) {
    const k = key(f.p);
    if (f.hide && hidefile.isHidden(f.p)) ours.set(k, f.p);
    if (!f.hide && !hidefile.isHidden(f.p)) ours.delete(k);
  }
  store.setHiddenList([...ours.values()]);
}

async function sync() {
  if (running) { pending = true; return; }
  running = true;
  try {
    do {
      pending = false;
      await runOnce();
    } while (pending);
  } catch (e) {
    log.warn('No se pudo actualizar lo oculto del Escritorio', e.message);
  } finally {
    running = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(sync, SETTLE);
}

function init() {
  store.onChange(schedule);
  schedule();
}

module.exports = { init, sync, schedule, inDesktop, _reset: () => { dirsCache = null; asked = new Set(); } };
