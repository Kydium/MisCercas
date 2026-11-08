'use strict';
const fs = require('fs');
const path = require('path');

const EXT = {
  shortcuts: ['.lnk', '.url'],
  docs: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.txt', '.rtf', '.csv', '.md'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tif', '.tiff', '.heic', '.avif'],
  media: ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv'],
  archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.iso'],
  apps: ['.exe', '.msi', '.bat', '.cmd', '.ps1', '.jar']
};
const FILTERS = ['all', 'folders', ...Object.keys(EXT)];
const SORTS = ['name', 'date', 'size', 'type'];
const IGNORED = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'system volume information']);

/* ---------- validadores sencillos ---------- */
const num = (v, d, min, max) => {
  v = Number(v);
  if (!Number.isFinite(v)) return d;
  return Math.min(max, Math.max(min, v));
};
const str = (v, d, max = 200) => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/* ---------- nombres ---------- */
function displayName(name, isDir) {
  if (isDir) return name;
  const ext = path.extname(name).toLowerCase();
  return ext === '.lnk' || ext === '.url' ? name.slice(0, -ext.length) : name;
}

function baseLabel(p) {
  const last = String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
  return displayName(last, false);
}

/* ---------- portales ---------- */
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function isHiddenName(name) {
  const n = name.toLowerCase();
  return n.startsWith('.') || n.startsWith('~$') || IGNORED.has(n);
}

function matches(entry, filter) {
  if (filter === 'all') return true;
  if (filter === 'folders') return entry.isDir;
  if (entry.isDir) return false;
  return (EXT[filter] || []).includes(path.extname(entry.name).toLowerCase());
}

function sortEntries(list, mode) {
  const byName = (a, b) => collator.compare(a.name, b.name);
  const folders = (a, b) => Number(b.isDir) - Number(a.isDir);
  const cmp = {
    name: (a, b) => folders(a, b) || byName(a, b),
    date: (a, b) => (b.mtime - a.mtime) || byName(a, b),
    size: (a, b) => folders(a, b) || (b.size - a.size) || byName(a, b),
    type: (a, b) => folders(a, b) ||
      collator.compare(path.extname(a.name), path.extname(b.name)) || byName(a, b)
  }[mode] || ((a, b) => folders(a, b) || byName(a, b));
  return list.sort(cmp);
}

async function listPortal(portal) {
  const dirs = (portal && portal.dirs) || [];
  const seen = new Set();
  const out = [];
  let reachable = 0;
  for (const dir of dirs) {
    let dirents;
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      reachable++;
    } catch { continue; }
    const batch = dirents
      .filter((d) => portal.showHidden || !isHiddenName(d.name))
      .map((d) => ({ name: d.name, path: path.join(dir, d.name), isDir: d.isDirectory(), mtime: 0, size: 0 }));
    await Promise.all(batch.map(async (e) => {
      try {
        const st = await fs.promises.stat(e.path);
        e.isDir = st.isDirectory();
        e.mtime = st.mtimeMs;
        e.size = st.size;
      } catch { /* enlace roto: se deja con valores por defecto */ }
    }));
    for (const e of batch) {
      const key = e.name.toLowerCase();
      if (seen.has(key) || !matches(e, portal.filter)) continue;
      seen.add(key);
      e.label = displayName(e.name, e.isDir);
      out.push(e);
    }
  }
  return { entries: sortEntries(out, portal.sort), reachable, total: dirs.length };
}


/** Carpetas donde puede haber acabado un acceso directo del escritorio (escritorio del usuario, público, OneDrive). */
function desktopDirs(userDesktop) {
  const path = require('path');
  const out = [userDesktop, path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
  for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const d = process.env[k];
    if (d) out.push(path.join(d, 'Desktop'), path.join(d, 'Escritorio'));
  }
  return [...new Set(out.filter(Boolean))];
}

/**
 * Si un elemento que estaba en un escritorio ya no existe ahí (p. ej. Windows pasó el escritorio a OneDrive),
 * busca el mismo nombre en los demás escritorios. Devuelve la nueva ruta o null.
 */
function findMoved(p, dirs) {
  const path = require('path');
  const fs = require('fs');
  if (typeof p !== 'string' || !p) return null;
  if (!/^(desktop|escritorio)$/i.test(path.basename(path.dirname(p)))) return null;
  const base = path.basename(p);
  for (const d of dirs) {
    const c = path.join(d, base);
    if (c.toLowerCase() === p.toLowerCase()) continue;
    try { fs.statSync(c); return c; } catch { /* sigue buscando */ }
  }
  return null;
}

module.exports = {
  desktopDirs, findMoved,
  EXT, FILTERS, SORTS,
  num, str, bool, oneOf, isHex,
  displayName, baseLabel, sortEntries, listPortal
};
