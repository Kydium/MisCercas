'use strict';
// Marca o desmarca el atributo «oculto» de un archivo o carpeta de Windows (como «attrib +h»).
// Así un acceso directo del Escritorio deja de verse allí sin moverlo ni borrarlo.
// En otros sistemas, o si koffi no carga, available() es false y no hace nada.
const path = require('path');

const FILE_ATTRIBUTE_HIDDEN = 0x2;
const INVALID = 0xffffffff;

let api;            // undefined = sin intentar, null = no disponible
let override = null; // para pruebas: { get(p), set(p, attrs) }

function load() {
  if (override) return override;
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== 'win32') return api;
  try {
    let koffi = null;
    for (const t of [path.join(__dirname, 'vendor', 'koffi', 'win32_x64', 'koffi.node'), 'koffi']) {
      try { const k = require(t); if (k && typeof k.load === 'function') { koffi = k; break; } } catch { /* siguiente */ }
    }
    if (!koffi) return api;
    const k32 = koffi.load('kernel32.dll');
    const get = k32.func('uint32_t __stdcall GetFileAttributesW(str16 file)');
    const set = k32.func('int __stdcall SetFileAttributesW(str16 file, uint32_t attrs)');
    api = { get: (p) => get(p), set: (p, a) => !!set(p, a) };
  } catch {
    api = null;
  }
  return api;
}

const available = () => !!load();

function isHidden(p) {
  const a = load();
  if (!a) return false;
  const v = a.get(p);
  return v !== INVALID && (v & FILE_ATTRIBUTE_HIDDEN) !== 0;
}

/** Oculta (on = true) o muestra el archivo. Devuelve true si quedó como se pidió. */
function setHidden(p, on) {
  const a = load();
  if (!a || typeof p !== 'string' || !p) return false;
  try {
    const v = a.get(p);
    if (v === INVALID) return false;
    const next = on ? (v | FILE_ATTRIBUTE_HIDDEN) : (v & ~FILE_ATTRIBUTE_HIDDEN);
    if (next !== v && !a.set(p, next >>> 0)) return false;
    const after = a.get(p);
    return after !== INVALID && ((after & FILE_ATTRIBUTE_HIDDEN) !== 0) === !!on;
  } catch {
    return false;
  }
}

module.exports = { available, isHidden, setHidden, _use: (o) => { override = o; } };
