(() => {
  'use strict';
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const fenceEl = $('fence');
  const bodyEl = $('body');
  const itemsEl = $('items');
  const titleEl = $('title');
  const emptyEl = $('empty');

  const MIME = 'application/x-mc-item';
  const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  const svg = (inner, extra = '') =>
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
  const ICONS = {
    down: svg('<path d="M3.5 6l4.5 4.5L12.5 6"/>'),
    right: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
    dots: svg('<circle cx="3" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r="1.2" fill="currentColor" stroke="none"/>'),
    folder: svg('<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.6h5A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.6"/><path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7"/>'),
    pin: svg('<path d="M9.5 2.5l4 4-2 .8-1.8 1.8.3 2.4-1 1-2.7-2.7-3.8 3.8M6.1 5.1l1-1 2.4.3"/>'),
    auto: svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>')
  };

  let S = null;            // { fence, settings, theme, collapsed }
  let entries = [];        // lo que se muestra
  let unreachable = false;
  let selected = -1;
  let dragFrom = null;     // elemento que se arrastra desde esta cerca
  let loadSeq = 0;
  let toastTimer = null;
  let io = null;
  const iconCache = new Map();

  /* ---------- utilidades ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const baseLabel = (p) => {
    const last = String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
    return last.replace(/\.(lnk|url)$/i, '');
  };
  const extOf = (p) => { const m = /\.[^.\\/]+$/.exec(p); return m ? m[0].toLowerCase() : ''; };
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
  const iconKey = (p) => `${S.settings.iconSize >= 64 ? 128 : 96}|${p}`;
  // Iconos de emergencia (solo si el sistema no entrega uno): una carpeta amarilla y una hoja
  const dataSvg = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const FALLBACK = {
    dir: dataSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3b92f"/><stop offset="1" stop-color="#d9930d"/></linearGradient><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe28f"/><stop offset="1" stop-color="#f7bc2d"/></linearGradient></defs><path d="M5 15a4 4 0 0 1 4-4h15l6 6h25a4 4 0 0 1 4 4v29a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="url(#b)"/><rect x="5" y="22" width="54" height="33" rx="4" fill="url(#f)"/></svg>'),
    file: dataSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 6h25l13 13v37a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z" fill="#f4f6fa" stroke="#aeb7c6" stroke-width="2"/><path d="M39 6v10a3 3 0 0 0 3 3h10z" fill="#d5dbe6"/></svg>')
  };

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  /* ---------- tema y cabecera ---------- */
  function applyTheme() {
    const s = S.settings;
    const th = S.theme; // tema ya resuelto: { id, dark, accent, header, gradient, k, vars }
    const accent = S.fence.color || (s.accentFollowsTheme ? th.accent : s.accent);
    const vars = s.finish === 'raised' ? th.vars : th.flat; // plano (por defecto) o con relieve
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    const header = s.titlebar === 'theme' ? th.header : s.titlebar;
    // Si el usuario cambia el estilo de una barra propia del tema (Alto contraste, Retro 95), el texto se adapta
    if (th.header === 'custom' && header !== 'custom') {
      root.style.setProperty('--hdr-text', vars['--text']);
      root.style.setProperty('--hdr-shadow', 'none');
    }
    root.dataset.theme = th.dark ? 'dark' : 'light';
    root.dataset.finish = s.finish === 'raised' ? 'raised' : 'flat';
    root.dataset.hdr = header;
    root.dataset.grad = th.gradient ? '1' : '0';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-rgb', hexToRgb(accent));
    root.style.setProperty('--alpha', String(Math.min(0.97, s.opacity * th.k)));
    root.style.setProperty('--radius', `${s.radius}px`);
    root.style.setProperty('--icon', `${s.iconSize}px`);
    fenceEl.classList.toggle('nolabels', !s.showLabels);
    root.classList.toggle('collapsed', !!S.collapsed);
    root.classList.add('ready');
  }

  function renderHeader() {
    const f = S.fence;
    titleEl.textContent = f.title;
    document.title = f.title;
    const badges = [];
    if (f.portal) badges.push([`Portal: ${f.portal.dirs.join(' + ')}`, ICONS.folder]);
    if (f.locked) badges.push(['Posición bloqueada', ICONS.lock]);
    if (f.pinned) badges.push(['Siempre encima', ICONS.pin]);
    if (f.autoRoll) badges.push(['Se enrolla al salir el ratón', ICONS.auto]);
    $('badges').innerHTML = badges.map(([t, i]) => `<span class="badge" title="${esc(t)}">${i}</span>`).join('');
    $('btnRoll').hidden = f.autoRoll;
    $('btnRoll').innerHTML = f.rolled ? ICONS.right : ICONS.down;
    $('btnMenu').innerHTML = ICONS.dots;
  }

  /* ---------- datos ---------- */
  async function buildEntries() {
    const f = S.fence;
    unreachable = false;
    if (f.portal) {
      const r = await api.portalList();
      unreachable = r.reachable === 0;
      entries = r.entries.map((e) => ({ path: e.path, label: e.label, isDir: e.isDir, src: -1, missing: false }));
      return;
    }
    const info = await api.itemsInfo(f.items.map((i) => i.p));
    entries = f.items.map((it, i) => ({
      path: it.p,
      label: it.n || baseLabel(it.p),
      isDir: !!(info[i] && info[i].isDir),
      src: i,
      missing: !(info[i] && info[i].exists)
    }));
    if (f.sort === 'name') entries.sort((a, b) => collator.compare(a.label, b.label));
    else if (f.sort === 'type') entries.sort((a, b) => collator.compare(extOf(a.path), extOf(b.path)) || collator.compare(a.label, b.label));
  }

  async function load() {
    const seq = ++loadSeq;
    const st = await api.state();
    if (!st || seq !== loadSeq) return;
    S = st;
    applyTheme();
    await buildEntries();
    if (seq !== loadSeq) return;
    render();
  }

  /* ---------- pintar ---------- */
  function makeItem(en, i) {
    const el = document.createElement('div');
    el.className = `item${en.missing ? ' missing' : ''}`;
    el.dataset.i = String(i);
    el.title = en.missing ? `No se encontró: ${en.path}` : en.path;
    el.draggable = false;
    const img = document.createElement('img');
    img.className = 'ico';
    img.alt = '';
    img.draggable = false;
    const cached = iconCache.get(iconKey(en.path));
    if (cached) { img.src = cached; img.classList.add('loaded'); }
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = en.label;
    el.append(img, lbl);
    return el;
  }

  function setEmptyText() {
    const f = S.fence;
    let text = 'Arrastra aquí archivos, carpetas o accesos directos.';
    if (f.portal) {
      if (unreachable) text = 'No se puede acceder a la carpeta de este portal.';
      else if (f.portal.filter !== 'all') text = 'No hay elementos que coincidan con el filtro.';
      else text = 'La carpeta está vacía.';
    }
    emptyEl.querySelector('p').textContent = text;
  }

  function render() {
    renderHeader();
    itemsEl.className = S.fence.view === 'list' ? 'list' : 'grid';
    itemsEl.textContent = '';
    const frag = document.createDocumentFragment();
    entries.forEach((en, i) => frag.appendChild(makeItem(en, i)));
    itemsEl.appendChild(frag);
    emptyEl.hidden = entries.length > 0;
    if (!emptyEl.hidden) setEmptyText();
    if (selected >= entries.length) selected = -1;
    paintSelection();
    observeIcons();
  }

  function observeIcons() {
    if (io) io.disconnect();
    io = new IntersectionObserver((list) => {
      for (const o of list) {
        if (!o.isIntersecting) continue;
        io.unobserve(o.target);
        loadIcon(o.target);
      }
    }, { root: bodyEl, rootMargin: '140px' });
    for (const el of itemsEl.children) {
      if (!el.firstChild.classList.contains('loaded')) io.observe(el);
    }
  }

  async function loadIcon(el) {
    const en = entries[Number(el.dataset.i)];
    if (!en) return;
    const url = await api.icon(en.path, S.settings.iconSize, en.isDir);
    if (url) iconCache.set(iconKey(en.path), url);
    const img = el.firstChild;
    if (img && img.isConnected) { img.src = url || (en.isDir ? FALLBACK.dir : FALLBACK.file); img.classList.add('loaded'); }
  }

  /* ---------- selección y acciones ---------- */
  function paintSelection() {
    [...itemsEl.children].forEach((el, i) => el.classList.toggle('selected', i === selected));
  }
  function select(i, scroll = true) {
    selected = i;
    paintSelection();
    if (scroll && i >= 0 && itemsEl.children[i]) itemsEl.children[i].scrollIntoView({ block: 'nearest' });
  }

  async function openEntry(en) {
    if (!en) return;
    if (en.missing) { toast('No se encontró este elemento. Quizá se movió o se borró.'); return; }
    const err = await api.open(en.path);
    if (err) toast(`No se pudo abrir: ${err}`);
  }

  async function commitItems(items) {
    S.fence.items = items;
    await api.patch({ items });
    await buildEntries();
    render();
  }
  function updateItem(src, fn) {
    const items = S.fence.items.map((it) => ({ ...it }));
    if (!items[src]) return;
    fn(items[src]);
    commitItems(items);
  }
  function removeItem(src) {
    selected = -1;
    commitItems(S.fence.items.filter((_, i) => i !== src));
  }
  function reorder(from, at) {
    const items = S.fence.items.slice();
    if (from < 0 || from >= items.length) return;
    const [it] = items.splice(from, 1);
    const to = Math.max(0, Math.min(items.length, at > from ? at - 1 : at));
    items.splice(to, 0, it);
    selected = to;
    commitItems(items);
  }

  /* ---------- renombrar ---------- */
  function startItemRename(i) {
    const el = itemsEl.children[i];
    const en = entries[i];
    if (!el || !en || en.src < 0) return;
    const lbl = el.querySelector('.lbl');
    const input = document.createElement('input');
    input.className = 'rename';
    input.maxLength = 120;
    input.value = en.label;
    lbl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (ok && v && v !== en.label) updateItem(en.src, (it) => { it.n = v; });
      else render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  function startTitleRename() {
    if (!S || $('titleInput')) return;
    const input = document.createElement('input');
    input.id = 'titleInput';
    input.maxLength = 80;
    input.value = S.fence.title;
    titleEl.hidden = true;
    titleEl.after(input);
    window.focus();
    input.focus();
    input.select();
    let done = false;
    const finish = async (ok) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      titleEl.hidden = false;
      if (ok && v && v !== S.fence.title) { S.fence.title = v; await api.patch({ title: v }); }
      renderHeader();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  /* ---------- ratón y menús ---------- */
  itemsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.item');
    itemsEl.focus({ preventScroll: true });
    if (!el) { select(-1); return; }
    const i = Number(el.dataset.i);
    select(i, false);
    if (S.settings.openWith === 'single') openEntry(entries[i]);
  });
  itemsEl.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.item');
    if (el && S.settings.openWith === 'double') openEntry(entries[Number(el.dataset.i)]);
  });
  bodyEl.addEventListener('click', (e) => { if (e.target === bodyEl) select(-1); });
  // Al hacer clic fuera (en el escritorio u otra ventana) la selección se quita, como en el Explorador
  window.addEventListener('blur', () => {
    const a = document.activeElement;
    if (!a || a.tagName !== 'INPUT') select(-1, false);
  });

  document.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (!S || e.target.closest('input')) return;
    const el = e.target.closest('.item');
    if (!el) { api.fenceMenu(); return; }
    const i = Number(el.dataset.i);
    select(i, false);
    const en = entries[i];
    const action = await api.itemMenu({ index: en.src, path: en.path });
    if (action === 'open') openEntry(en);
    else if (action === 'rename') startItemRename(i);
    else if (action === 'restore') updateItem(en.src, (it) => { delete it.n; });
    else if (action === 'remove') removeItem(en.src);
  });

  $('btnRoll').addEventListener('click', () => api.action('toggleRoll'));
  $('btnMenu').addEventListener('click', () => api.fenceMenu());

  /* ---------- teclado ---------- */
  function moveSelection(dx, dy) {
    const n = entries.length;
    if (!n) return;
    if (selected < 0) { select(0); return; }
    if (dx) { select(Math.max(0, Math.min(n - 1, selected + dx))); return; }
    const cur = itemsEl.children[selected].getBoundingClientRect();
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      if (i === selected) continue;
      const r = itemsEl.children[i].getBoundingClientRect();
      const d = r.top - cur.top;
      if (dy > 0 ? d <= 4 : d >= -4) continue;
      const score = Math.abs(d) * 1000 + Math.abs(r.left - cur.left);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) select(best);
  }

  window.addEventListener('keydown', (e) => {
    if (!S || e.target.tagName === 'INPUT') return;
    const en = entries[selected];
    switch (e.key) {
      case 'ArrowRight': moveSelection(1, 0); break;
      case 'ArrowLeft': moveSelection(-1, 0); break;
      case 'ArrowDown': moveSelection(0, 1); break;
      case 'ArrowUp': moveSelection(0, -1); break;
      case 'Home': if (entries.length) select(0); break;
      case 'End': if (entries.length) select(entries.length - 1); break;
      case 'Enter': openEntry(en); break;
      case 'Escape': select(-1, false); break;
      case 'Delete': if (en && en.src >= 0) removeItem(en.src); break;
      case 'F2': if (en && en.src >= 0) startItemRename(selected); else startTitleRename(); break;
      default: return;
    }
    e.preventDefault();
  });

  /* ---------- arrastrar y soltar ---------- */
  const hint = (text) => { $('dropHint').textContent = text; };
  function clearDropMarks() {
    fenceEl.classList.remove('dropping', 'deny');
    itemsEl.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }
  function insertion(e) {
    const el = e.target.closest ? e.target.closest('.item') : null;
    if (!el) return { index: entries.length, el: null, after: true };
    const i = Number(el.dataset.i);
    const r = el.getBoundingClientRect();
    const after = S.fence.view === 'list' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    return { index: after ? i + 1 : i, el, after };
  }

  itemsEl.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.item');
    if (!el) return;
    const en = entries[Number(el.dataset.i)];
    dragFrom = { src: en.src, path: en.path };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(MIME, JSON.stringify({ fence: S.fence.id, path: en.path, src: en.src }));
    el.classList.add('dragging');
  });
  itemsEl.addEventListener('dragend', async (e) => {
    const was = dragFrom;
    dragFrom = null;
    // Soltado fuera de todas las cercas (p. ej. sobre el Escritorio): el elemento sale de la cerca
    if (was && S && !S.fence.portal && e.dataTransfer.dropEffect === 'none') {
      const r = await api.releaseItem({ path: was.path });
      if (r === 'desktop') toast('Devuelto al Escritorio');
      else if (r === 'removed') toast('Quitado de la cerca');
    }
    itemsEl.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    clearDropMarks();
  });

  /* Arrastre con el puntero (en Tauri no funciona el arrastrar y soltar de HTML5 entre ventanas) */
  let pd = null;
  let justDragged = false;
  function itemAt(x, y) {
    const t = document.elementFromPoint(x, y);
    return t && t.closest ? t.closest('.item') : null;
  }
  function insertionAt(x, y) {
    const el = itemAt(x, y);
    if (!el) return { index: entries.length, el: null, after: true };
    const i = Number(el.dataset.i);
    const r = el.getBoundingClientRect();
    const after = S.fence.view === 'list' ? y > r.top + r.height / 2 : x > r.left + r.width / 2;
    return { index: after ? i + 1 : i, el, after };
  }
  itemsEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !S || S.fence.portal) return;
    const el = e.target.closest('.item');
    if (!el) return;
    const en = entries[Number(el.dataset.i)];
    if (!en || en.src < 0) return;
    pd = { el, en, x: e.clientX, y: e.clientY, active: false, ghost: null, id: e.pointerId };
  });
  document.addEventListener('pointermove', (e) => {
    if (!pd) return;
    if (!pd.active) {
      if (Math.hypot(e.clientX - pd.x, e.clientY - pd.y) < 6) return;
      pd.active = true;
      try { pd.el.setPointerCapture(pd.id); } catch { /* sin captura */ }
      pd.el.classList.add('dragging');
      const g = pd.el.cloneNode(true);
      g.style.cssText = `position:fixed;z-index:99;pointer-events:none;opacity:.85;width:${pd.el.offsetWidth}px;margin:0`;
      document.body.appendChild(g);
      pd.ghost = g;
    }
    pd.ghost.style.left = `${e.clientX - pd.el.offsetWidth / 2}px`;
    pd.ghost.style.top = `${e.clientY - pd.el.offsetHeight / 2}px`;
    clearDropMarks();
    const inside = e.clientX >= 0 && e.clientY >= 0 && e.clientX < window.innerWidth && e.clientY < window.innerHeight;
    if (inside && S.fence.sort === 'manual') {
      const ins = insertionAt(e.clientX, e.clientY);
      if (ins.el) ins.el.classList.add(ins.after ? 'drop-after' : 'drop-before');
    }
  });
  async function endDrag(e) {
    const d = pd;
    pd = null;
    if (!d || !d.active) return;
    if (d.ghost) d.ghost.remove();
    d.el.classList.remove('dragging');
    clearDropMarks();
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 50);
    if (e.type === 'pointercancel') return;
    const inside = e.clientX >= 0 && e.clientY >= 0 && e.clientX < window.innerWidth && e.clientY < window.innerHeight;
    if (inside) {
      if (S.fence.sort === 'manual') reorder(d.en.src, insertionAt(e.clientX, e.clientY).index);
      else toast('Para reordenar, cambia el orden de la cerca a "Manual".');
      return;
    }
    const r = await api.releaseItem({ path: d.en.path });
    if (r === 'desktop') toast('Devuelto al Escritorio');
    else if (r === 'removed') toast('Quitado de la cerca');
    else if (r === 'moved') toast('Movido a otra cerca');
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  itemsEl.addEventListener('click', (e) => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
  itemsEl.addEventListener('dblclick', (e) => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);

  document.addEventListener('dragover', (e) => {
    e.preventDefault(); // evita que Electron navegue al soltar un archivo fuera de la cerca
    if (!S) return;
    const types = [...e.dataTransfer.types];
    const internal = types.includes(MIME);
    if (!internal && !types.includes('Files')) return;
    clearDropMarks();
    if (S.fence.portal) {
      e.dataTransfer.dropEffect = 'none';
      fenceEl.classList.add('deny');
      hint('Este portal solo muestra una carpeta');
      return;
    }
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
    if (internal && dragFrom) {
      if (S.fence.sort === 'manual') {
        const ins = insertion(e);
        if (ins.el) ins.el.classList.add(ins.after ? 'drop-after' : 'drop-before');
      }
      return;
    }
    fenceEl.classList.add('dropping');
    hint(internal ? 'Soltar para mover aquí' : 'Soltar para agregar a la cerca');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) clearDropMarks();
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    clearDropMarks();
    if (!S || S.fence.portal) return;
    const manual = S.fence.sort === 'manual';
    const at = manual ? insertion(e).index : undefined;
    const raw = e.dataTransfer.getData(MIME);
    if (raw) {
      let d;
      try { d = JSON.parse(raw); } catch { return; }
      if (d.fence === S.fence.id) {
        if (manual) reorder(d.src, at);
        else toast('Para reordenar, cambia el orden de la cerca a "Manual".');
      } else {
        await api.transfer({ fromFence: d.fence, path: d.path, index: at });
      }
      return;
    }
    const paths = [...e.dataTransfer.files].map((f) => api.pathOf(f)).filter(Boolean);
    if (!paths.length) return;
    const added = await api.addItems(paths, at);
    if (!added) toast('Esos elementos ya estaban en la cerca.');
  });

  /* ---------- mensajes desde el proceso principal ---------- */
  api.onReload(load);
  api.onRenameTitle(startTitleRename);
  api.onLayout(({ collapsed }) => {
    if (!S) return;
    S.collapsed = collapsed;
    root.classList.toggle('collapsed', collapsed);
    if (!collapsed) observeIcons();
  });
  api.onSettings(({ settings, theme }) => {
    if (!S) return;
    S.settings = settings;
    S.theme = theme;
    applyTheme();
    render();
  });

  load();
  // Respaldo por si el sistema no avisa de cambios en la carpeta de un portal
  setInterval(() => { if (S && S.fence.portal && !S.collapsed && !document.hidden) load(); }, 20000);
})();
