'use strict';
const fs = require('fs');
const path = require('path');
const { app, nativeImage, shell } = require('electron');

// Los iconos se piden al propio Windows (el mismo sistema que usa el Explorador), así las carpetas,
// accesos directos, programas y unidades se ven igual que en el escritorio.
// app.getFileIcon solo mira la extensión del archivo: se usa únicamente como respaldo y nunca para carpetas.
const TTL = 5 * 60 * 1000;      // los iconos se vuelven a pedir cada 5 min (por si cambia el icono de una carpeta)
const TIMEOUT = 6000;           // algunas miniaturas (vídeos, red) pueden tardar: pasado este tiempo se usa el respaldo
const MAX_PARALLEL = 4;

const cache = new Map();        // clave -> { url, t }
const inflight = new Map();     // clave -> Promise (no se pide dos veces el mismo icono)
const waiting = [];
let running = 0;

const pxFor = (size) => (Number(size) >= 64 ? 128 : 96);

function limited(task) {
  return new Promise((resolve) => {
    const run = () => {
      running++;
      task().then(resolve, () => resolve(null)).finally(() => {
        running--;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (running < MAX_PARALLEL) run(); else waiting.push(run);
  });
}

function withTimeout(promise, ms) {
  let t;
  const limit = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('tiempo agotado')), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(t));
}

async function shellIcon(p, px) {
  if (typeof nativeImage.createThumbnailFromPath !== 'function') return null;
  try {
    const img = await withTimeout(nativeImage.createThumbnailFromPath(p, { width: px, height: px }), TIMEOUT);
    return img && !img.isEmpty() ? img.toDataURL() : null;
  } catch {
    return null;
  }
}

async function typeIcon(p, isDir) {
  if (isDir && process.platform === 'win32') return null; // daría un icono equivocado: se dibuja uno propio
  try {
    const img = await app.getFileIcon(p, { size: 'large' });
    return img && !img.isEmpty() ? img.toDataURL() : null;
  } catch {
    return null;
  }
}

const winicon = require('./winicon');
const log = require('./logger');
let warned = false;

// Convierte los píxeles BGRA (alfa recto) que da winicon en una imagen, o null si salieron vacíos.
function fromRaw(r) {
  if (!r) return null;
  const d = r.data;
  let seen = false;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a) {
      if (d[i] || d[i + 1] || d[i + 2]) seen = true;
      d[i] = Math.round((d[i] * a) / 255);       // el formato de nativeImage lleva el alfa premultiplicado
      d[i + 1] = Math.round((d[i + 1] * a) / 255);
      d[i + 2] = Math.round((d[i + 2] * a) / 255);
    }
  }
  if (!seen) return null;
  try {
    const img = nativeImage.createFromBitmap(d, { width: r.width, height: r.height });
    return img.isEmpty() ? null : img.toDataURL();
  } catch {
    return null;
  }
}

const expand = (v) => (typeof v === 'string' ? v.replace(/%([^%]+)%/g, (m, n) => process.env[n] || process.env[n.toUpperCase()] || m).replace(/^"|"$/g, '') : '');
const isFile = (f) => { try { return !!f && fs.statSync(f).isFile(); } catch { return false; } };

// Ubicaciones de icono (archivo + número), como las usa el Explorador: la del propio acceso directo y, si no
// la tiene, el primer icono del programa al que apunta.
function locations(p) {
  const ext = path.extname(p).toLowerCase();
  const out = [];
  try {
    if (ext === '.lnk' && typeof shell.readShortcutLink === 'function') {
      const l = shell.readShortcutLink(p);
      const ico = expand(l.icon);
      if (isFile(ico)) out.push({ file: ico, index: Number(l.iconIndex) || 0 });
      const target = expand(l.target);
      if (isFile(target)) out.push({ file: target, index: 0 });
    } else if (ext === '.url') {
      const txt = fs.readFileSync(p, 'utf8');
      const f = /^IconFile=(.+)$/im.exec(txt);
      const i = /^IconIndex=(-?\d+)/im.exec(txt);
      const ico = f && expand(f[1].trim());
      if (isFile(ico)) out.push({ file: ico, index: i ? Number(i[1]) : 0 });
    } else if (['.exe', '.ico', '.dll', '.scr'].includes(ext)) {
      out.push({ file: p, index: 0 });
    }
  } catch { /* se usa el respaldo */ }
  return out;
}

// Respaldo: el Explorador a veces da el icono de «documento» para los .lnk; se prueba el icono propio del acceso
// directo o el del programa por miniatura y por tipo; si no, la miniatura del propio .lnk (así se resuelven los
// accesos directos «anunciados» de Office) y, al final, el icono por tipo.
function sourcesOf(p) {
  const ext = path.extname(p).toLowerCase();
  const out = [];
  try {
    if (ext === '.lnk' && typeof shell.readShortcutLink === 'function') {
      const l = shell.readShortcutLink(p);
      const ico = expand(l.icon);
      if (isFile(ico) && (!l.iconIndex || path.extname(ico).toLowerCase() === '.ico')) out.push(ico);
      const target = expand(l.target);
      if (isFile(target)) out.push(target);
    } else if (ext === '.url') {
      const m = /^IconFile=(.+)$/im.exec(fs.readFileSync(p, 'utf8'));
      const ico = m && expand(m[1].trim());
      if (isFile(ico)) out.push(ico);
    }
  } catch { /* se usa el icono del propio archivo */ }
  return out;
}

async function load(p, px, isDir) {
  const ext = path.extname(p).toLowerCase();
  if (!warned && process.platform === 'win32' && !winicon.available()) {
    warned = true;
    log.warn('No se pudo cargar el acceso a los iconos de Windows; se usará el método de respaldo.');
  }
  if (['.lnk', '.url', '.exe', '.ico', '.dll', '.scr'].includes(ext)) {
    for (const loc of locations(p)) {
      const u = fromRaw(winicon.extract(loc.file, loc.index, 128));
      if (u) return u;
    }
  }
  if (ext === '.lnk' || ext === '.url') {
    for (const src of sourcesOf(p)) {
      const url = (await limited(() => shellIcon(src, px))) || (await typeIcon(src, false));
      if (url) return url;
    }
  }
  return (await limited(() => shellIcon(p, px))) || (await typeIcon(p, isDir));
}

/** Icono como data URL, o null si no hay (la ventana dibuja entonces uno genérico). */
async function get(p, size, isDir) {
  if (typeof p !== 'string' || !p) return null;
  const px = pxFor(size);
  const key = `${px}|${p}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.url;
  if (inflight.has(key)) return inflight.get(key);
  const job = load(p, px, !!isDir)
    .then((url) => {
      if (url) {
        if (cache.size > 800) cache.clear();
        cache.set(key, { url, t: Date.now() });
      }
      return url;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

function clear() { cache.clear(); }

module.exports = { get, clear, pxFor };
