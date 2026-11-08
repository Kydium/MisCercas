'use strict';
const { ipcMain, shell, dialog, app, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const store = require('./store');
const fences = require('./fences');
const menus = require('./menus');
const icons = require('./icons');
const util = require('./util');
const system = require('./system');
const theme = require('./theme');
const themes = require('./themes');
const log = require('./logger');

const fenceId = (e) => fences.idFor(e.sender);

function settingsPayload(withCatalog = false) {
  return {
    settings: store.settings(),
    theme: theme.effective(),
    ...(withCatalog ? { themes: themes.THEMES, groups: themes.GROUPS } : {}),
    autoStart: system.getAutoStart(),
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    hotkey: store.settings().hotkey
  };
}

function replaceEverything(raw, toggle) {
  store.replaceAll(raw);
  if (!store.fences().length) store.newFence({ title: 'Mi primera cerca' });
  icons.clear();
  system.setHotkey(store.settings().hotkey, toggle);
  fences.rebuildAll();
}

function register({ toggle }) {
  /* ---------- cercas ---------- */
  ipcMain.handle('state:get', (e) => {
    const id = fenceId(e);
    return id ? fences.getState(id) : null;
  });

  ipcMain.handle('fence:patch', (e, p) => {
    const id = fenceId(e);
    if (!id || !p || typeof p !== 'object') return false;
    const allowed = {};
    for (const k of ['title', 'items', 'sort', 'view']) if (k in p) allowed[k] = p[k];
    fences.patch(id, allowed);
    return true;
  });

  ipcMain.handle('fence:menu', (e) => {
    const id = fenceId(e);
    if (id) menus.showFenceMenu(id);
  });
  ipcMain.handle('item:menu', (e, ctx) => menus.showItemMenu(e.sender, ctx));

  ipcMain.handle('portal:list', (e) => {
    const f = store.fence(fenceId(e));
    if (!f || !f.portal) return { entries: [], reachable: 0, total: 0 };
    return util.listPortal(f.portal);
  });

  ipcMain.handle('items:info', async (e, paths) => {
    if (!Array.isArray(paths)) return [];
    const id = fenceId(e);
    const dirs = util.desktopDirs(app.getPath('desktop'));
    const moved = new Map();
    const info = await Promise.all(paths.slice(0, 600).map(async (p) => {
      try {
        const s = await fs.promises.stat(p);
        return { exists: true, isDir: s.isDirectory() };
      } catch {
        const alt = util.findMoved(p, dirs);
        if (alt) { moved.set(p, alt); return { exists: true, isDir: false }; }
        return { exists: false, isDir: false };
      }
    }));
    const f = store.fence(id);
    if (f && moved.size) {
      // el elemento se movió de escritorio: se actualiza la ruta guardada y la cerca se recarga
      for (const it of f.items) if (moved.has(it.p)) it.p = moved.get(it.p);
      store.saveSoon();
      log.info('Se actualizaron rutas de accesos directos movidos de escritorio:', moved.size);
      fences.send(id, 'reload');
    }
    const lost = paths.filter((_, i) => !info[i].exists);
    if (lost.length) log.warn('Elementos no encontrados en la cerca', id, lost.slice(0, 5).join(' | '));
    return info;
  });

  // Un elemento se soltó fuera de todas las cercas: sale de la cerca (y, si venía del Escritorio, vuelve a verse allí)
  ipcMain.handle('item:release', (e, ctx) => {
    const id = fenceId(e);
    const f = store.fence(id);
    if (!f || f.portal || !ctx || typeof ctx.path !== 'string') return null;
    const pt = screen.getCursorScreenPoint();
    for (const o of store.fences()) {
      const w = fences.getWin(o.id);
      if (!w || !w.isVisible()) continue;
      const b = w.getBounds();
      if (pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height) return null; // cayó sobre una cerca
    }
    const i = f.items.findIndex((it) => it.p === ctx.path);
    if (i < 0) return null;
    const back = require('./desktopHide').inDesktop(ctx.path) && store.settings().hideDesktop;
    f.items.splice(i, 1);
    store.saveSoon();
    fences.send(id, 'reload');
    return back ? 'desktop' : 'removed';
  });

  ipcMain.handle('icon:get', (_e, p, size, isDir) => icons.get(p, size, isDir));

  ipcMain.handle('item:open', async (_e, p) => {
    if (typeof p !== 'string' || !p) return 'Ruta no válida';
    return shell.openPath(p);
  });

  ipcMain.handle('item:add', (e, paths, index) => fences.addItems(fenceId(e), paths, index));

  ipcMain.handle('item:transfer', (e, d) => {
    const to = fenceId(e);
    if (!to || !d || typeof d !== 'object') return false;
    return fences.transferItem(String(d.fromFence), to, String(d.path), d.index);
  });

  ipcMain.handle('app:action', (e, name) => {
    if (name === 'settings') require('./settingsWindow').open();
    else if (name === 'newFence') fences.addFence({ near: fenceId(e) });
    else if (name === 'toggleAll') fences.toggleAll();
    else if (name === 'toggleRoll') {
      const id = fenceId(e);
      const f = store.fence(id);
      if (f && !f.autoRoll) fences.patch(id, { rolled: !f.rolled }, { notify: true });
    }
  });

  /* ---------- configuración ---------- */
  ipcMain.handle('settings:get', () => settingsPayload(true));

  ipcMain.handle('settings:set', (_e, patch) => {
    const p = patch && typeof patch === 'object' ? { ...patch } : {};
    let error = null;
    if ('autoStart' in p) {
      system.setAutoStart(!!p.autoStart);
      delete p.autoStart;
    }
    if (typeof p.hotkey === 'string' && p.hotkey !== store.settings().hotkey) {
      if (!system.setHotkey(p.hotkey, toggle)) {
        error = 'No se pudo usar ese atajo (puede que otra aplicación ya lo use).';
        delete p.hotkey;
      }
    }
    store.setSettings(p);
    fences.broadcastSettings();
    return { ...settingsPayload(), error };
  });

  ipcMain.handle('data:action', async (e, name) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const filters = [{ name: 'Configuración (JSON)', extensions: ['json'] }];
    const ask = async (message, detail, yes) => {
      const r = await dialog.showMessageBox(win, {
        type: 'warning', buttons: [yes, 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Mis Cercas', message, detail
      });
      return r.response === 0;
    };
    try {
      switch (name) {
        case 'openFolder':
          await shell.openPath(app.getPath('userData'));
          return { ok: true };
        case 'openLog':
          if (log.file) shell.showItemInFolder(log.file);
          return { ok: true };
        case 'export': {
          const r = await dialog.showSaveDialog(win, { title: 'Exportar configuración', defaultPath: 'mis-cercas-config.json', filters });
          if (r.canceled || !r.filePath) return { ok: false, canceled: true };
          fs.writeFileSync(r.filePath, store.exportJson());
          return { ok: true };
        }
        case 'import': {
          const r = await dialog.showOpenDialog(win, { title: 'Importar configuración', properties: ['openFile'], filters });
          if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
          let raw;
          try { raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { ok: false, error: 'El archivo no es una configuración válida.' }; }
          if (!(await ask('¿Reemplazar tus cercas actuales?', 'Se sustituirán por las del archivo importado.', 'Importar'))) return { ok: false, canceled: true };
          replaceEverything(raw, toggle);
          return { ok: true };
        }
        case 'reset':
          if (!(await ask('¿Restablecer Mis Cercas?', 'Se borrarán todas tus cercas y ajustes.', 'Restablecer'))) return { ok: false, canceled: true };
          replaceEverything({}, toggle);
          return { ok: true };
        default:
          return { ok: false };
      }
    } catch (err) {
      log.error('Acción de datos fallida', name, err);
      return { ok: false, error: 'No se pudo completar la acción.' };
    }
  });
}

module.exports = { register };
