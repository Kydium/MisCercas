'use strict';
const fs = require('fs');
const path = require('path');
const log = require('./logger');
const { FILTERS, SORTS, num, str, bool, oneOf, isHex } = require('./util');
const { isTheme } = require('./themes');

const MIN_W = 170;
const MIN_H = 110;

const DEFAULT_SETTINGS = {
  theme: 'auto',            // auto o el id de un tema (ver themes.js)
  accent: '#4d8dff',
  accentFollowsTheme: true, // true = el acento lo pone el tema; false = se usa el color elegido
  titlebar: 'theme',        // theme | solid | glass | clear
  finish: 'flat',           // flat (plano, sin relieve) | raised (con brillo, borde luminoso y sombra en el título)
  hideDesktop: true,        // oculta del Escritorio lo que está dentro de una cerca (sin borrarlo ni moverlo)
  snap: true,               // imán: al soltar una cerca se alinea con los bordes de las demás
  keepOnTop: false,         // modo seguro: todas las cercas siempre encima
  opacity: 0.62,
  radius: 10,
  iconSize: 40,             // 28 | 40 | 52 | 64
  showLabels: true,
  openWith: 'double',       // double | single
  hotkey: 'Control+Alt+F',
  animations: true,
  defaultAutoRoll: false
};

let file = null;
let data = null;
let timer = null;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- saneado ---------- */
function sanitizeSettings(r) {
  r = r && typeof r === 'object' ? r : {};
  const d = DEFAULT_SETTINGS;
  // Quien ya había elegido un acento propio en la versión anterior lo conserva
  const customAccent = isHex(r.accent) && r.accent.toLowerCase() !== d.accent;
  return {
    theme: isTheme(r.theme) ? r.theme : d.theme,
    accent: isHex(r.accent) ? r.accent : d.accent,
    accentFollowsTheme: bool(r.accentFollowsTheme, !customAccent),
    titlebar: oneOf(r.titlebar, ['theme', 'solid', 'glass', 'clear'], d.titlebar),
    finish: oneOf(r.finish, ['flat', 'raised'], d.finish),
    hideDesktop: bool(r.hideDesktop, d.hideDesktop),
    snap: bool(r.snap, d.snap),
    keepOnTop: bool(r.keepOnTop, d.keepOnTop),
    opacity: num(r.opacity, d.opacity, 0.2, 0.95),
    radius: Math.round(num(r.radius, d.radius, 0, 22)),
    iconSize: oneOf(Number(r.iconSize), [28, 40, 52, 64], d.iconSize),
    showLabels: bool(r.showLabels, d.showLabels),
    openWith: oneOf(r.openWith, ['double', 'single'], d.openWith),
    hotkey: str(r.hotkey, d.hotkey, 60) || d.hotkey,
    animations: bool(r.animations, d.animations),
    defaultAutoRoll: bool(r.defaultAutoRoll, d.defaultAutoRoll)
  };
}

function sanitizeItem(i) {
  if (typeof i === 'string') return i ? { p: i } : null;
  if (i && typeof i.p === 'string' && i.p) {
    const out = { p: i.p };
    if (typeof i.n === 'string' && i.n.trim()) out.n = i.n.trim().slice(0, 120);
    return out;
  }
  return null;
}

function sanitizePortal(p) {
  if (!p) return null;
  if (typeof p === 'string') p = { dirs: [p] };
  if (typeof p !== 'object') return null;
  let dirs = [];
  if (Array.isArray(p.dirs)) dirs = p.dirs.filter((d) => typeof d === 'string' && d);
  else if (typeof p.dir === 'string' && p.dir) dirs = [p.dir];
  if (!dirs.length) return null;
  return {
    dirs: dirs.slice(0, 4),
    filter: oneOf(p.filter, FILTERS, 'all'),
    sort: oneOf(p.sort, SORTS, 'name'),
    showHidden: bool(p.showHidden, false)
  };
}

function sanitizeFence(r) {
  r = r && typeof r === 'object' ? r : {};
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    title: str(r.title, 'Nueva cerca', 80).trim() || 'Nueva cerca',
    x: Math.round(num(r.x, 80, -30000, 30000)),
    y: Math.round(num(r.y, 80, -30000, 30000)),
    w: Math.round(num(r.w, 320, MIN_W, 4000)),
    h: Math.round(num(r.h, 240, MIN_H, 4000)),
    rolled: bool(r.rolled, false),
    locked: bool(r.locked, false),
    pinned: bool(r.pinned, false),
    autoRoll: bool(r.autoRoll, false),
    view: oneOf(r.view, ['grid', 'list'], 'grid'),
    sort: oneOf(r.sort, ['manual', 'name', 'type'], 'manual'),
    color: isHex(r.color) ? r.color : null,
    portal: sanitizePortal(r.portal),
    items: (Array.isArray(r.items) ? r.items : []).map(sanitizeItem).filter(Boolean).slice(0, 500)
  };
}

function sanitizeSnapshots(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).map((s) => ({
    id: typeof s.id === 'string' && s.id ? s.id : newId(),
    name: str(s && s.name, 'Disposición', 60),
    ts: num(s && s.ts, Date.now(), 0, 8.64e15),
    fences: (Array.isArray(s && s.fences) ? s.fences : []).map((f) => ({
      id: str(f && f.id, '', 40),
      x: Math.round(num(f && f.x, 0, -30000, 30000)),
      y: Math.round(num(f && f.y, 0, -30000, 30000)),
      w: Math.round(num(f && f.w, 320, MIN_W, 4000)),
      h: Math.round(num(f && f.h, 240, MIN_H, 4000)),
      rolled: bool(f && f.rolled, false)
    })).filter((f) => f.id)
  }));
}

function normalize(raw) {
  const src = Array.isArray(raw) ? { fences: raw } : (raw && typeof raw === 'object' ? raw : {});
  const seen = new Set();
  const fences = (Array.isArray(src.fences) ? src.fences : []).map(sanitizeFence).filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  return {
    version: 2,
    settings: sanitizeSettings(src.settings),
    fences,
    snapshots: sanitizeSnapshots(src.snapshots),
    hidden: (Array.isArray(src.hidden) ? src.hidden : []).filter((p) => typeof p === 'string' && p).slice(0, 3000)
  };
}

/* ---------- disco ---------- */
function init(dir) {
  file = path.join(dir, 'fences.json');
  let raw = null;
  for (const f of [file, file + '.bak']) {
    try {
      raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      break;
    } catch (e) {
      if (e.code !== 'ENOENT') log.warn('No se pudo leer', f, e.message);
    }
  }
  data = normalize(raw);
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!data || !file) return;
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch { /* sin copia */ }
    fs.renameSync(tmp, file);
  } catch (e) {
    log.error('No se pudo guardar la configuración', e);
  }
}

const listeners = [];
const onChange = (fn) => { listeners.push(fn); };

function saveSoon() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
  for (const fn of listeners) { try { fn(); } catch { /* un oyente no debe romper el guardado */ } }
}

/* ---------- API ---------- */
function newFence(overrides = {}) {
  const f = sanitizeFence({ autoRoll: data.settings.defaultAutoRoll, ...overrides, id: newId() });
  data.fences.push(f);
  saveSoon();
  return f;
}

function removeFence(id) {
  data.fences = data.fences.filter((f) => f.id !== id);
  saveSoon();
}

function setSettings(patch) {
  data.settings = sanitizeSettings({ ...data.settings, ...patch });
  saveSoon();
  return data.settings;
}

/** Elementos que esta aplicación ocultó del Escritorio (para poder mostrarlos de nuevo). */
function setHiddenList(list) {
  const next = [...new Set(list)];
  if (JSON.stringify(next) === JSON.stringify(data.hidden)) return;
  data.hidden = next;
  clearTimeout(timer);
  timer = setTimeout(flush, 250); // se guarda sin volver a avisar a los oyentes
}

function replaceAll(raw) {
  data = normalize(raw);
  flush();
}

function exportJson() {
  return JSON.stringify(data, null, 2);
}

module.exports = {
  MIN_W, MIN_H, DEFAULT_SETTINGS,
  newId, normalize, sanitizeFence, sanitizeSettings,
  init, flush, saveSoon, onChange, setHiddenList, newFence, removeFence, setSettings, replaceAll, exportJson,
  settings: () => data.settings,
  fences: () => data.fences,
  fence: (id) => data.fences.find((f) => f.id === id),
  snapshots: () => data.snapshots,
  hiddenList: () => data.hidden,
  get file() { return file; }
};
