'use strict';
// Acceso mínimo a la API de Windows (user32) con koffi. Solo se usa para saber cuándo Windows
// "muestra el escritorio" (Win+D) y para colocar las cercas en el orden de ventanas correcto.
// En otros sistemas, o si koffi no carga, create() devuelve null y la app sigue funcionando igual.
const path = require('path');

const GW_HWNDNEXT = 2;
const GW_HWNDPREV = 3;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
const HWND_TOP = 0;
const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const WS_POPUP = 0x80000000;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;
const MAX_WALK = 3000;

function loadKoffi() {
  const tries = [path.join(__dirname, 'vendor', 'koffi', 'win32_x64', 'koffi.node'), 'koffi'];
  let last = null;
  for (const t of tries) {
    try {
      const k = require(t);
      if (k && typeof k.load === 'function') return k;
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('koffi no está disponible');
}

function build(koffi) {
  const lib = koffi.load('user32.dll');
  const f = {
    GetForegroundWindow: lib.func('intptr_t __stdcall GetForegroundWindow()'),
    GetClassNameW: lib.func('int __stdcall GetClassNameW(intptr_t hWnd, void *buf, int max)'),
    FindWindowExW: lib.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 title)'),
    GetWindow: lib.func('intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t cmd)'),
    GetTopWindow: lib.func('intptr_t __stdcall GetTopWindow(intptr_t hWnd)'),
    IsWindowVisible: lib.func('int __stdcall IsWindowVisible(intptr_t hWnd)'),
    IsWindow: lib.func('int __stdcall IsWindow(intptr_t hWnd)'),
    SetWindowPos: lib.func('int __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
    CreateWindowExW: lib.func('intptr_t __stdcall CreateWindowExW(uint32_t ex, str16 cls, str16 name, uint32_t style, int x, int y, int w, int h, intptr_t parent, intptr_t menu, intptr_t inst, void *param)'),
    DestroyWindow: lib.func('int __stdcall DestroyWindow(intptr_t hWnd)')
  };
  const buf = Buffer.alloc(512);

  const className = (h) => {
    const n = f.GetClassNameW(h, buf, 256);
    return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
  };

  /** Ventanas que forman el escritorio: Program Manager y las WorkerW (de primer nivel). */
  function desktopHosts() {
    const hosts = [];
    const prog = f.FindWindowExW(0, 0, 'Progman', null);
    if (prog) hosts.push(prog);
    let w = 0;
    for (let i = 0; i < 24; i++) {
      w = f.FindWindowExW(0, w, 'WorkerW', null);
      if (!w) break;
      hosts.push(w);
    }
    return hosts.filter((h) => f.IsWindowVisible(h));
  }

  return {
    hwndOf(win) {
      const b = win.getNativeWindowHandle();
      return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
    },

    /** Ventana de referencia invisible (1x1) para saber si el escritorio está por encima de las ventanas normales. */
    createAnchor() {
      const h = f.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, 'STATIC', 'MisCercasAnchor', WS_POPUP, 0, 0, 1, 1, 0, 0, 0, null);
      return h || 0;
    },
    destroyAnchor(h) {
      if (h && f.IsWindow(h)) f.DestroyWindow(h);
    },

    /** true si alguna ventana del escritorio está por encima de la referencia (= "Mostrar escritorio" activo). */
    desktopCovers(anchor) {
      const hosts = new Set(desktopHosts());
      if (!hosts.size) return false;
      let w = f.GetWindow(anchor, GW_HWNDPREV);
      for (let i = 0; w && i < MAX_WALK; i++) {
        if (hosts.has(w)) return true;
        w = f.GetWindow(w, GW_HWNDPREV);
      }
      return false;
    },

    setTopmost(h) {
      return !!f.SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS);
    },

    /** Quita "siempre encima" y deja la ventana justo sobre el escritorio, detrás de las demás ventanas. */
    lower(h) {
      f.SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, FLAGS);
      const hosts = new Set(desktopHosts());
      let top = 0;
      let w = f.GetTopWindow(0);
      for (let i = 0; w && i < MAX_WALK; i++) {
        if (hosts.has(w)) { top = w; break; }
        w = f.GetWindow(w, GW_HWNDNEXT);
      }
      if (!top) return;
      const above = f.GetWindow(top, GW_HWNDPREV);
      if (above === h) return;
      f.SetWindowPos(h, above || HWND_TOP, 0, 0, 0, 0, FLAGS);
    },

    /** Datos para el registro de errores. */
    describe() {
      const fg = f.GetForegroundWindow();
      return {
        foreground: fg ? className(fg) : '',
        desktopWindows: desktopHosts().length
      };
    }
  };
}

let cached;

function create() {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform !== 'win32') return cached;
  try {
    cached = build(loadKoffi());
  } catch (e) {
    require('./logger').warn('No se pudo cargar el acceso a Windows (koffi):', e && e.message);
  }
  return cached;
}

module.exports = { create, build };
