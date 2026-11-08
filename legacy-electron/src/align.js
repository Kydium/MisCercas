'use strict';
// Geometría pura para alinear, igualar y ordenar cercas (sin Electron, para poder probarla).
// Una "caja" es { id, x, y, w, h }.

const GAP = 12;         // separación entre cercas al ordenarlas o pegarlas
const THRESHOLD = 14;   // distancia (px) a la que el imán empieza a actuar

function nearest(value, targets, thr) {
  let best = null;
  for (const t of targets) {
    const d = Math.abs(t - value);
    if (d <= thr && (best === null || d < Math.abs(best - value))) best = t;
  }
  return best;
}

/**
 * Imán: ajusta una cerca recién movida o redimensionada a los bordes de las demás y de la pantalla.
 * prev = caja antes del cambio (para saber qué borde se movió). Devuelve la caja ajustada.
 * collapsed: la cerca está enrollada, no se toca su alto.
 */
function snap(box, prev, others, wa, { thr = THRESHOLD, collapsed = false } = {}) {
  const out = { ...box };
  // objetivos para el borde izquierdo/superior (ls, ts) y para el derecho/inferior (rs, bs)
  const ls = [wa.x];
  const rs = [wa.x + wa.width];
  const ts = [wa.y];
  const bs = [wa.y + wa.height];
  for (const o of others) {
    ls.push(o.x, o.x + o.w + GAP);
    rs.push(o.x + o.w, o.x - GAP);
    ts.push(o.y, o.y + o.h + GAP);
    bs.push(o.y + o.h, o.y - GAP);
  }
  const resized = prev && (box.w !== prev.w || (!collapsed && box.h !== prev.h));

  // ----- horizontal -----
  const leftMoved = !prev || box.x !== prev.x;
  const rightMoved = !prev || box.x + box.w !== prev.x + prev.w;
  if (!resized) {
    const l = nearest(box.x, ls, thr);
    const r = nearest(box.x + box.w, rs, thr);
    const dl = l === null ? Infinity : Math.abs(l - box.x);
    const dr = r === null ? Infinity : Math.abs(r - (box.x + box.w));
    if (dl <= dr && l !== null) out.x = l; else if (r !== null) out.x = r - box.w;
  } else {
    if (leftMoved) {
      const l = nearest(box.x, ls, thr);
      if (l !== null) { out.w = box.x + box.w - l; out.x = l; }
    }
    if (rightMoved) {
      const r = nearest(box.x + box.w, rs, thr);
      const eq = nearest(box.w, others.map((o) => o.w), thr); // mismo ancho que otra cerca
      if (r !== null && (eq === null || Math.abs(r - (box.x + box.w)) <= Math.abs(eq - box.w))) out.w = r - out.x;
      else if (eq !== null) out.w = eq;
    }
  }

  // ----- vertical -----
  const topMoved = !prev || box.y !== prev.y;
  const bottomMoved = !prev || box.y + box.h !== prev.y + prev.h;
  if (!resized) {
    const t = nearest(box.y, ts, thr);
    const b = collapsed ? null : nearest(box.y + box.h, bs, thr);
    const dt = t === null ? Infinity : Math.abs(t - box.y);
    const db = b === null ? Infinity : Math.abs(b - (box.y + box.h));
    if (dt <= db && t !== null) out.y = t; else if (b !== null) out.y = b - box.h;
  } else if (!collapsed) {
    if (topMoved) {
      const t = nearest(box.y, ts, thr);
      if (t !== null) { out.h = box.y + box.h - t; out.y = t; }
    }
    if (bottomMoved) {
      const b = nearest(box.y + box.h, bs, thr);
      const eq = nearest(box.h, others.map((o) => o.h), thr);
      if (b !== null && (eq === null || Math.abs(b - (box.y + box.h)) <= Math.abs(eq - box.h))) out.h = b - out.y;
      else if (eq !== null) out.h = eq;
    }
  }
  return out;
}

const sameAs = (list, ref, props) => list.map((b) => (b.id === ref.id ? b : { ...b, ...props }));

const sameSize = (list, ref) => sameAs(list, ref, { w: ref.w, h: ref.h });
const sameWidth = (list, ref) => sameAs(list, ref, { w: ref.w });
const sameHeight = (list, ref) => sameAs(list, ref, { h: ref.h });
const alignLeft = (list, ref) => sameAs(list, ref, { x: ref.x });
const alignTop = (list, ref) => sameAs(list, ref, { y: ref.y });
const alignRight = (list, ref) => list.map((b) => (b.id === ref.id ? b : { ...b, x: ref.x + ref.w - b.w }));
const alignBottom = (list, ref) => list.map((b) => (b.id === ref.id ? b : { ...b, y: ref.y + ref.h - b.h }));

/** Apila las demás en una columna debajo de la de referencia, con su mismo ancho y alineadas a ella. */
function stackColumn(list, ref) {
  const rest = list.filter((b) => b.id !== ref.id).sort((a, b) => a.y - b.y || a.x - b.x);
  let y = ref.y + ref.h + GAP;
  const out = [ref];
  for (const b of rest) { out.push({ ...b, x: ref.x, w: ref.w, y }); y += b.h + GAP; }
  return out;
}

/**
 * Ordena todas en filas (de izquierda a derecha, de arriba abajo) dentro del área de trabajo, todas del
 * mismo tamaño (el de la referencia). El orden respeta cómo estaban: primero por fila aproximada y luego por x.
 */
function tidyGrid(list, ref, wa) {
  const w = Math.min(ref.w, wa.width - GAP * 2);
  const h = Math.min(ref.h, wa.height - GAP * 2);
  const rowH = Math.max(1, Math.round(h / 2));
  const sorted = [...list].sort((a, b) => Math.round(a.y / rowH) - Math.round(b.y / rowH) || a.x - b.x);
  const perRow = Math.max(1, Math.floor((wa.width - GAP) / (w + GAP)));
  return sorted.map((b, i) => ({
    ...b, w, h,
    x: wa.x + GAP + (i % perRow) * (w + GAP),
    y: wa.y + GAP + Math.floor(i / perRow) * (h + GAP)
  }));
}

/** Tamaño más habitual entre las cercas (el de la que más se repite; empata por la primera). */
function commonSize(list) {
  const count = new Map();
  let best = list[0];
  let bestN = 0;
  for (const b of list) {
    const k = `${b.w}x${b.h}`;
    const n = (count.get(k) || 0) + 1;
    count.set(k, n);
    if (n > bestN) { best = b; bestN = n; }
  }
  return best;
}

module.exports = { GAP, THRESHOLD, snap, sameSize, sameWidth, sameHeight, alignLeft, alignTop, alignRight, alignBottom, stackColumn, tidyGrid, commonSize };
