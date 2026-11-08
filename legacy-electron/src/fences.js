'use strict';
const { app, BrowserWindow, screen, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const theme = require('./theme');
const log = require('./logger');
const winapi = require('./winapi');
const { createGuard } = require('./showdesktop');
const align = require('./align');

const { MIN_W, MIN_H } = store;
const HEADER_H = 36;
const WM_NCLBUTTONDBLCLK = 0x00a3;

const PRELOAD = path.join(__dirname, 'preload.js');
const PAGE = path.join(__dirname, 'renderer', 'fence.html');
const ICON = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

const wins = new Map();      // id -> BrowserWindow
const owners = new Map();    // webContents.id -> id
const st = new Map();        // id -> estado transitorio
const watchers = new Map();  // id -> [FSWatcher]
const refreshTimers = new Map();
let hidden = false;
let guard = null;
let lastKeep = false;
let hoverTimer = null;
let onChange = () => {};

const alive = (id) => {
  const w = wins.get(id);
  return w && !w.isDestroyed() ? w : null;
};
const key = (p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p));
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ---------- mensajes hacia las ventanas ---------- */
function send(id, channel, payload) {
  const w = alive(id);
  if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}
const sendAll = (channel, payload) => { for (const id of wins.keys()) send(id, channel, payload); };

const keepTop = () => !!store.settings().keepOnTop;

/** "Todas encima" (modo seguro): solo se vuelve a aplicar cuando el ajuste cambia. */
function applyTopmost() {
  const keep = keepTop();
  if (keep === lastKeep) return;
  lastKeep = keep;
  for (const [id, w] of wins) {
    const f = store.fence(id);
    if (f && !w.isDestroyed()) w.setAlwaysOnTop(f.pinned || keep, 'floating');
  }
}

function broadcastSettings() {
  applyTopmost();
  const payload = { settings: store.settings(), theme: theme.effective() };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('settings', payload);
  }
}

/* ---------- geometría ---------- */
function isCollapsed(f) {
  const s = st.get(f.id);
  return f.autoRoll ? !(s && s.hover) : f.rolled;
}

function clampToVisible(b) {
  const wa = screen.getDisplayMatching(b).workArea;
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  return {
    x: Math.min(Math.max(b.x, wa.x - width + 80), wa.x + wa.width - 80),
    y: Math.min(Math.max(b.y, wa.y), wa.y + wa.height - HEADER_H),
    width,
    height
  };
}

const targetBounds = (f, collapsed) =>
  clampToVisible({ x: f.x, y: f.y, width: f.w, height: collapsed ? HEADER_H : f.h });

function animate(id, to, done) {
  const win = alive(id);
  const s = st.get(id);
  if (!win || !s) return;
  clearTimeout(s.anim);
  s.anim = null;
  const from = win.getBounds();
  if (!store.settings().animations || from.height === to.height) {
    win.setBounds(to);
    if (done) done();
    return;
  }
  const t0 = Date.now();
  const step = () => {
    const w = alive(id);
    if (!w) return;
    const p = Math.min(1, (Date.now() - t0) / 150);
    const e = 1 - Math.pow(1 - p, 3);
    w.setBounds({ x: to.x, y: to.y, width: to.width, height: Math.round(from.height + (to.height - from.height) * e) });
    if (p < 1) {
      s.anim = setTimeout(step, 15);
    } else {
      s.anim = null;
      if (done) done();
    }
  };
  step();
}

function relayout(id, animated = true) {
  const win = alive(id);
  const f = store.fence(id);
  const s = st.get(id);
  if (!win || !f || !s) return;
  const collapsed = isCollapsed(f);
  s.collapsed = collapsed;
  const to = targetBounds(f, collapsed);
  if (collapsed) {
    win.setMinimumSize(MIN_W, HEADER_H);
    if (animated) animate(id, to); else win.setBounds(to);
  } else {
    const done = () => {
      const w = alive(id);
      if (w && !isCollapsed(f)) w.setMinimumSize(MIN_W, MIN_H);
    };
    if (animated) animate(id, to, done);
    else { win.setBounds(to); done(); }
  }
  send(id, 'layout', { collapsed });
}

function persist(id) {
  const win = alive(id);
  const f = store.fence(id);
  const s = st.get(id);
  if (!win || !f || !s || s.anim) return;
  const b = win.getBounds();
  if (s.collapsed && b.height !== HEADER_H) win.setBounds({ ...b, height: HEADER_H });
  f.x = b.x;
  f.y = b.y;
  f.w = b.width;
  if (!s.collapsed) f.h = Math.max(MIN_H, b.height);
  store.saveSoon();
}

/* ---------- auto-enrollar al salir el ratón ---------- */
function tickHover() {
  if (hidden) return;
  const pt = screen.getCursorScreenPoint();
  const now = Date.now();
  for (const f of store.fences()) {
    if (!f.autoRoll) continue;
    const win = alive(f.id);
    const s = st.get(f.id);
    if (!win || !s) continue;
    const b = win.getBounds();
    const inside = pt.x >= b.x - 2 && pt.x <= b.x + b.width + 2 && pt.y >= b.y - 2 && pt.y <= b.y + b.height + 2;
    if (inside || s.menuOpen > 0) {
      s.lastInside = now;
      if (!s.hover) { s.hover = true; relayout(f.id); }
    } else if (s.hover && now - s.lastInside > 450) {
      s.hover = false;
      relayout(f.id);
    }
  }
}

function updateHoverLoop() {
  const need = store.fences().some((f) => f.autoRoll);
  if (need && !hoverTimer) hoverTimer = setInterval(tickHover, 90);
  if (!need && hoverTimer) { clearInterval(hoverTimer); hoverTimer = null; }
}

const menuOpened = (id) => { const s = st.get(id); if (s) s.menuOpen++; };
const menuClosed = (id) => { const s = st.get(id); if (s) s.menuOpen = Math.max(0, s.menuOpen - 1); };

/* ---------- portales: vigilar carpetas ---------- */
function unwatch(id) {
  for (const w of watchers.get(id) || []) { try { w.close(); } catch { /* ya cerrado */ } }
  watchers.delete(id);
  clearTimeout(refreshTimers.get(id));
  refreshTimers.delete(id);
}

function watchPortal(id) {
  unwatch(id);
  const f = store.fence(id);
  if (!f || !f.portal) return;
  const list = [];
  const kick = () => {
    clearTimeout(refreshTimers.get(id));
    refreshTimers.set(id, setTimeout(() => send(id, 'reload'), 250));
  };
  for (const dir of f.portal.dirs) {
    try {
      const w = fs.watch(dir, { persistent: false }, kick);
      w.on('error', () => {});
      list.push(w);
    } catch (e) {
      log.warn('No se pudo vigilar', dir, e.message);
    }
  }
  watchers.set(id, list);
}

/* ---------- ventanas ---------- */
function create(f) {
  const s = { hover: false, lastInside: 0, menuOpen: 0, anim: null, collapsed: false };
  st.set(f.id, s);
  s.collapsed = isCollapsed(f);
  const b = targetBounds(f, s.collapsed);
  const win = new BrowserWindow({
    ...b,
    minWidth: MIN_W,
    minHeight: s.collapsed ? HEADER_H : MIN_H,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    resizable: !f.locked,
    movable: !f.locked,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: f.pinned || keepTop(),
    show: false,
    title: f.title,
    icon: ICON,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  if (f.pinned || keepTop()) win.setAlwaysOnTop(true, 'floating');

  const wcId = win.webContents.id;
  wins.set(f.id, win);
  owners.set(wcId, f.id);
  win.setMenuBarVisibility(false);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => { if (!hidden) win.showInactive(); });
  // Red de seguridad: si el sistema llegara a minimizarla, se vuelve a mostrar sin quitarle el foco a nadie
  win.on('minimize', () => {
    setTimeout(() => {
      const w = alive(f.id);
      if (!w || w !== win || hidden || !w.isMinimized()) return;
      w.showInactive();
      setTimeout(() => { if (!w.isDestroyed() && w.isMinimized()) w.restore(); }, 150);
    }, 0);
  });
  win.on('moved', () => gestureEnd(f.id));
  win.on('resized', () => gestureEnd(f.id));
  win.on('system-context-menu', (e) => {
    e.preventDefault();
    require('./menus').showFenceMenu(f.id);
  });
  win.on('closed', () => {
    owners.delete(wcId);
    // si ya se creó otra ventana con el mismo id (importar/restablecer), no se toca
    if (wins.get(f.id) === win) {
      const cur = st.get(f.id);
      if (cur) clearTimeout(cur.anim);
      wins.delete(f.id);
      st.delete(f.id);
    }
  });
  // Doble clic en la barra de título (zona arrastrable) = enrollar / desenrollar
  if (process.platform === 'win32' && typeof win.hookWindowMessage === 'function') {
    win.hookWindowMessage(WM_NCLBUTTONDBLCLK, () => toggleRoll(f.id));
  }
  win.loadFile(PAGE);
  watchPortal(f.id);
  return win;
}

function toggleRoll(id) {
  const f = store.fence(id);
  if (f && !f.autoRoll) patch(id, { rolled: !f.rolled }, { notify: true });
}

const PATCHABLE = ['title', 'rolled', 'locked', 'pinned', 'autoRoll', 'view', 'sort', 'color', 'portal', 'items'];

function patch(id, p, { notify = false } = {}) {
  const f = store.fence(id);
  if (!f || !p || typeof p !== 'object') return null;
  const before = { rolled: f.rolled, autoRoll: f.autoRoll, locked: f.locked, pinned: f.pinned, portal: JSON.stringify(f.portal) };
  const clean = {};
  for (const k of PATCHABLE) if (k in p) clean[k] = p[k];
  const merged = store.sanitizeFence({ ...f, ...clean, id });
  for (const k of PATCHABLE) f[k] = merged[k];

  const win = alive(id);
  const s = st.get(id);
  if (win) {
    win.setTitle(f.title);
    if (f.locked !== before.locked) { win.setResizable(!f.locked); win.setMovable(!f.locked); }
    if (f.pinned !== before.pinned) win.setAlwaysOnTop(f.pinned || keepTop(), 'floating');
  }
  if (f.autoRoll !== before.autoRoll) {
    if (s) { s.hover = f.autoRoll; s.lastInside = Date.now(); }
    updateHoverLoop();
  }
  if (f.rolled !== before.rolled || f.autoRoll !== before.autoRoll) relayout(id);
  if (JSON.stringify(f.portal) !== before.portal) watchPortal(id);
  store.saveSoon();
  if (notify) send(id, 'reload');
  onChange();
  return f;
}

function getState(id) {
  const f = store.fence(id);
  if (!f) return null;
  const s = st.get(id);
  return { fence: f, settings: store.settings(), theme: theme.effective(), collapsed: !!(s && s.collapsed) };
}

/* ---------- crear y borrar ---------- */
function nextPosition(nearId) {
  const near = nearId && alive(nearId);
  if (near) {
    const b = near.getBounds();
    return { x: b.x + 36, y: b.y + 36 };
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const n = store.fences().length % 8;
  return { x: wa.x + 60 + n * 36, y: wa.y + 60 + n * 36 };
}

function templateData(name) {
  const desktop = app.getPath('desktop');
  const pub = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop');
  switch (name) {
    case 'desktop':
      return { title: 'Escritorio', w: 420, h: 320, portal: { dirs: process.platform === 'win32' ? [desktop, pub] : [desktop] } };
    case 'downloads':
      return { title: 'Descargas', w: 380, h: 300, portal: { dirs: [app.getPath('downloads')], sort: 'date' } };
    case 'documents':
      return { title: 'Documentos', w: 380, h: 300, portal: { dirs: [app.getPath('documents')] } };
    case 'pictures':
      return { title: 'Imágenes', w: 380, h: 300, portal: { dirs: [app.getPath('pictures')], filter: 'images' } };
    default:
      return {};
  }
}

function addFence(opts = {}) {
  const t = opts.template === 'folder' && opts.dir
    ? { title: path.basename(opts.dir) || 'Carpeta', w: 380, h: 300, portal: { dirs: [opts.dir] } }
    : templateData(opts.template);
  const f = store.newFence({ title: 'Nueva cerca', ...t, ...nextPosition(opts.near) });
  if (hidden) setHidden(false);
  create(f);
  updateHoverLoop();
  onChange();
  return f;
}

function duplicate(id) {
  const f = store.fence(id);
  if (!f) return null;
  const copy = store.newFence({ ...JSON.parse(JSON.stringify(f)), title: `${f.title} (copia)`, ...nextPosition(id) });
  create(copy);
  updateHoverLoop();
  onChange();
  return copy;
}

function deleteFence(id) {
  unwatch(id);
  store.removeFence(id);
  const w = alive(id);
  if (w) w.destroy();
  updateHoverLoop();
  onChange();
}

/* ---------- elementos ---------- */
function addItems(id, paths, index) {
  const f = store.fence(id);
  if (!f || f.portal || !Array.isArray(paths)) return 0;
  const have = new Set(f.items.map((i) => key(i.p)));
  const fresh = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !p) continue;
    const n = process.platform === 'win32' ? path.normalize(p) : p;
    if (have.has(key(n))) continue;
    have.add(key(n));
    fresh.push({ p: n });
  }
  if (!fresh.length) return 0;
  const at = Number.isInteger(index) ? Math.max(0, Math.min(index, f.items.length)) : f.items.length;
  f.items.splice(at, 0, ...fresh);
  store.saveSoon();
  send(id, 'reload');
  return fresh.length;
}

function transferItem(fromId, toId, itemPath, index) {
  const a = store.fence(fromId);
  const b = store.fence(toId);
  if (!a || !b || a.portal || b.portal || fromId === toId) return false;
  const i = a.items.findIndex((it) => key(it.p) === key(itemPath));
  if (i < 0) return false;
  const [it] = a.items.splice(i, 1);
  if (!b.items.some((x) => key(x.p) === key(it.p))) {
    const at = Number.isInteger(index) ? Math.max(0, Math.min(index, b.items.length)) : b.items.length;
    b.items.splice(at, 0, it);
  }
  store.saveSoon();
  send(fromId, 'reload');
  send(toId, 'reload');
  return true;
}

/* ---------- mostrar / ocultar ---------- */
function setHidden(h) {
  hidden = !!h;
  for (const w of wins.values()) {
    if (w.isDestroyed()) continue;
    if (hidden) w.hide(); else w.showInactive();
  }
  onChange();
}
const toggleAll = () => setHidden(!hidden);
const isHidden = () => hidden;

/* ---------- disposiciones y orden ---------- */
function saveSnapshot() {
  const d = new Date();
  const name = `Disposición ${d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  const snaps = store.snapshots();
  snaps.unshift({
    id: store.newId(),
    name,
    ts: Date.now(),
    fences: store.fences().map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, rolled: f.rolled }))
  });
  snaps.splice(12);
  store.saveSoon();
  onChange();
}

function restoreSnapshot(id) {
  const snap = store.snapshots().find((s) => s.id === id);
  if (!snap) return false;
  for (const s of snap.fences) {
    const f = store.fence(s.id);
    if (!f) continue;
    Object.assign(f, { x: s.x, y: s.y, w: s.w, h: s.h, rolled: s.rolled });
    relayout(f.id, false);
    send(f.id, 'reload');
  }
  store.saveSoon();
  return true;
}

function deleteSnapshot(id) {
  const snaps = store.snapshots();
  const i = snaps.findIndex((s) => s.id === id);
  if (i >= 0) snaps.splice(i, 1);
  store.saveSoon();
  onChange();
}

/* ---------- imán, igualar y ordenar ---------- */
const boxOf = (f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h });
const sameDisplay = (a, b) => screen.getDisplayMatching(a).id === screen.getDisplayMatching(b).id;

/** Cercas visibles en la misma pantalla que la indicada (las demás, con su tamaño real). */
function neighbours(id) {
  const win = alive(id);
  if (!win) return [];
  const me = win.getBounds();
  const out = [];
  for (const f of store.fences()) {
    if (f.id === id) continue;
    const w = alive(f.id);
    if (!w || !w.isVisible()) continue;
    const b = w.getBounds();
    if (sameDisplay(me, b)) out.push({ id: f.id, x: b.x, y: b.y, w: b.width, h: b.height });
  }
  return out;
}

/** Al terminar de mover o redimensionar: guarda y, si el imán está activo, alinea con las vecinas. */
function gestureEnd(id) {
  const f = store.fence(id);
  const s = st.get(id);
  if (!f || !s) return;
  const prev = { id, x: f.x, y: f.y, w: f.w, h: s.collapsed ? HEADER_H : f.h }; // geometría anterior, aún guardada
  persist(id);
  snapToNeighbours(id, prev);
}

function snapToNeighbours(id, prev) {
  const f = store.fence(id);
  const win = alive(id);
  const s = st.get(id);
  if (!f || !win || !s || s.anim || !store.settings().snap || f.locked) return;
  const cur = win.getBounds();
  const box = { id, x: cur.x, y: cur.y, w: cur.width, h: cur.height };
  const wa = screen.getDisplayMatching(cur).workArea;
  const to = align.snap(box, prev, neighbours(id), wa, { collapsed: !!s.collapsed });
  if (to.x !== box.x || to.y !== box.y || to.w !== box.w || to.h !== box.h) {
    win.setBounds({ x: to.x, y: to.y, width: Math.max(MIN_W, to.w), height: s.collapsed ? HEADER_H : Math.max(MIN_H, to.h) });
    persist(id);
  }
}

/** Aplica cajas calculadas (x, y, w, h) a las cercas y las guarda. */
function applyBoxes(boxes) {
  for (const b of boxes) {
    const f = store.fence(b.id);
    if (!f || f.locked) continue;
    f.x = Math.round(b.x);
    f.y = Math.round(b.y);
    f.w = Math.max(MIN_W, Math.round(b.w));
    f.h = Math.max(MIN_H, Math.round(b.h));
    relayout(b.id, false);
  }
  store.saveSoon();
  onChange();
}

/** Cercas de la misma pantalla que `id`, con su tamaño guardado (el que tienen al estar desenrolladas). */
function peers(id) {
  const win = alive(id);
  if (!win) return [];
  const me = win.getBounds();
  return store.fences().filter((f) => {
    const w = alive(f.id);
    return w && w.isVisible() && sameDisplay(me, w.getBounds());
  }).map(boxOf);
}

const OPS = {
  size: align.sameSize, width: align.sameWidth, height: align.sameHeight,
  left: align.alignLeft, top: align.alignTop, right: align.alignRight, bottom: align.alignBottom,
  column: align.stackColumn
};

/** Alinea o iguala las demás cercas de la pantalla tomando `id` como referencia. */
function alignTo(id, op) {
  const list = peers(id);
  const ref = list.find((b) => b.id === id);
  if (!ref || !OPS[op]) return;
  applyBoxes(OPS[op](list, ref).filter((b) => b.id !== id));
}

/** Ordena todas las cercas de la pantalla en cuadrícula, todas del mismo tamaño. */
function tidy(id) {
  const win = (id && alive(id)) || alive(store.fences()[0] && store.fences()[0].id);
  if (!win) return;
  const anchor = id || store.fences()[0].id;
  const list = peers(anchor);
  if (!list.length) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  applyBoxes(align.tidyGrid(list, align.commonSize(list), wa));
}

function arrange() {
  const wa = screen.getPrimaryDisplay().workArea;
  let x = wa.x + 24;
  let y = wa.y + 24;
  let rowH = 0;
  for (const f of store.fences()) {
    const h = isCollapsed(f) ? HEADER_H : f.h;
    if (x > wa.x + 24 && x + f.w > wa.x + wa.width - 24) { x = wa.x + 24; y += rowH + 16; rowH = 0; }
    f.x = x;
    f.y = y;
    x += f.w + 16;
    rowH = Math.max(rowH, h);
    relayout(f.id, false);
  }
  store.saveSoon();
}

/** Cierra todas las ventanas y las vuelve a crear desde los datos (importar / restablecer). */
function rebuildAll() {
  for (const id of [...wins.keys()]) {
    unwatch(id);
    const w = alive(id);
    if (w) w.destroy();
    wins.delete(id);
    st.delete(id);
  }
  for (const f of store.fences()) create(f);
  updateHoverLoop();
  broadcastSettings();
  onChange();
}

/* ---------- arranque ---------- */
function startGuard() {
  const native = winapi.create();
  if (!native) return;
  guard = createGuard({
    native,
    targets: () => [...wins].filter(([, w]) => !w.isDestroyed()).map(([id, win]) => {
      const f = store.fence(id);
      return { id, win, pinned: !!(f && f.pinned) };
    }),
    isHidden: () => hidden,
    keepOnTop: keepTop
  });
  guard.start();
  app.once('will-quit', () => guard.stop());
}

function init(onChangeCb) {
  if (onChangeCb) onChange = onChangeCb;
  lastKeep = keepTop();
  for (const f of store.fences()) create(f);
  updateHoverLoop();
  startGuard();
  const replace = debounce(() => { for (const f of store.fences()) relayout(f.id, false); }, 400);
  screen.on('display-added', replace);
  screen.on('display-removed', replace);
  screen.on('display-metrics-changed', replace);
  nativeTheme.on('updated', broadcastSettings);
}

module.exports = {
  HEADER_H,
  init, rebuildAll, getState, patch, relayout,
  addFence, duplicate, deleteFence, addItems, transferItem,
  setHidden, toggleAll, isHidden,
  saveSnapshot, restoreSnapshot, deleteSnapshot, arrange, alignTo, tidy,
  broadcastSettings, send, sendAll, menuOpened, menuClosed,
  idFor: (sender) => owners.get(sender.id),
  getWin: alive
};
