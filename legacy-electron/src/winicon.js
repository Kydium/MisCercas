'use strict';
// Saca el icono de un archivo (.exe, .dll, .ico) directamente de Windows, igual que el Explorador:
// la ubicación del icono de un acceso directo es «archivo + número de icono». Devuelve los píxeles en
// bruto (BGRA) para que icons.js los convierta. En otros sistemas o si koffi no carga, no hace nada.
const path = require('path');

let api;          // undefined = sin intentar, null = no disponible

function load() {
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== 'win32') return api;
  try {
    let koffi = null;
    for (const t of [path.join(__dirname, 'vendor', 'koffi', 'win32_x64', 'koffi.node'), 'koffi']) {
      try { const k = require(t); if (k && typeof k.load === 'function') { koffi = k; break; } } catch { /* siguiente */ }
    }
    if (!koffi) return api;
    const user32 = koffi.load('user32.dll');
    const gdi32 = koffi.load('gdi32.dll');
    api = {
      extract: user32.func('uint32_t __stdcall PrivateExtractIconsW(str16 file, int index, int cx, int cy, void *icons, void *ids, uint32_t n, uint32_t flags)'),
      getInfo: user32.func('int __stdcall GetIconInfo(intptr_t icon, void *info)'),
      destroy: user32.func('int __stdcall DestroyIcon(intptr_t icon)'),
      getDC: user32.func('intptr_t __stdcall GetDC(intptr_t wnd)'),
      releaseDC: user32.func('int __stdcall ReleaseDC(intptr_t wnd, intptr_t dc)'),
      getObject: gdi32.func('int __stdcall GetObjectW(intptr_t obj, int size, void *buf)'),
      getBits: gdi32.func('int __stdcall GetDIBits(intptr_t dc, intptr_t bmp, uint32_t start, uint32_t lines, void *bits, void *info, uint32_t usage)'),
      del: gdi32.func('int __stdcall DeleteObject(intptr_t obj)')
    };
  } catch {
    api = null;
  }
  return api;
}

const handle = (buf, off) => Number(buf.readBigUInt64LE(off));

function header(w, h) {
  const b = Buffer.alloc(44);
  b.writeUInt32LE(40, 0);
  b.writeInt32LE(w, 4);
  b.writeInt32LE(-h, 8);      // de arriba hacia abajo
  b.writeUInt16LE(1, 12);
  b.writeUInt16LE(32, 14);
  return b;
}

function bitsOf(a, dc, bmp, w, h) {
  const data = Buffer.alloc(w * h * 4);
  const ok = a.getBits(dc, bmp, 0, h, data, header(w, h), 0);
  return ok ? data : null;
}

/** { width, height, data } con data en BGRA y alfa sin premultiplicar; o null si el archivo no tiene ese icono. */
function extract(file, index, size) {
  const a = load();
  if (!a || typeof file !== 'string' || !file) return null;
  let icon = 0;
  let dc = 0;
  const info = Buffer.alloc(32);
  let hasInfo = false;
  try {
    const icons = Buffer.alloc(8);
    const n = a.extract(file, index || 0, size, size, icons, null, 1, 0);
    icon = handle(icons, 0);
    if (!n || !icon || n === 0xffffffff) return null;
    if (!a.getInfo(icon, info)) return null;
    hasInfo = true;
    const mask = handle(info, 16);
    const color = handle(info, 24);
    if (!color) return null;
    const bm = Buffer.alloc(32);
    if (!a.getObject(color, 32, bm)) return null;
    const width = bm.readInt32LE(4);
    const height = Math.abs(bm.readInt32LE(8));
    if (width < 1 || height < 1 || width > 1024 || height > 1024) return null;
    dc = a.getDC(0);
    const data = bitsOf(a, dc, color, width, height);
    if (!data) return null;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) if (data[i]) { hasAlpha = true; break; }
    if (!hasAlpha) {
      // icono sin canal alfa: la transparencia está en la máscara (negro = opaco)
      const m = mask ? bitsOf(a, dc, mask, width, height) : null;
      for (let i = 0; i < data.length; i += 4) data[i + 3] = m && m[i] === 0 && m[i + 1] === 0 && m[i + 2] === 0 ? 255 : m ? 0 : 255;
    }
    return { width, height, data };
  } catch {
    return null;
  } finally {
    try {
      if (hasInfo) { const m = handle(info, 16); const c = handle(info, 24); if (m) a.del(m); if (c) a.del(c); }
      if (dc) a.releaseDC(0, dc);
      if (icon) a.destroy(icon);
    } catch { /* nada */ }
  }
}

module.exports = { extract, available: () => !!load() };
