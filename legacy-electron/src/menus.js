'use strict';
const { Menu, dialog, shell, clipboard } = require('electron');
const store = require('./store');
const fences = require('./fences');

const COLORS = [
  ['Automático', null], ['Azul', '#4d8dff'], ['Verde', '#2fbf71'], ['Violeta', '#8b5cf6'],
  ['Naranja', '#ff8a3d'], ['Rojo', '#ef4b5f'], ['Rosa', '#ec5fa8'], ['Gris', '#8b95a7']
];
const FILTER_LABELS = {
  all: 'Todo', folders: 'Carpetas', shortcuts: 'Accesos directos', docs: 'Documentos',
  images: 'Imágenes', media: 'Audio y vídeo', archives: 'Comprimidos', apps: 'Programas'
};
const PORTAL_SORTS = { name: 'Nombre', date: 'Fecha de modificación', size: 'Tamaño', type: 'Tipo' };
const FENCE_SORTS = { manual: 'Manual (arrastrar)', name: 'Nombre', type: 'Tipo' };

async function chooseFolder(win, cb) {
  const opts = { properties: ['openDirectory'] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (!r.canceled && r.filePaths[0]) cb(r.filePaths[0]);
}

function newFenceItems(near) {
  return [
    { label: 'Cerca vacía', click: () => fences.addFence({ near }) },
    { type: 'separator' },
    { label: 'Portal: Escritorio', click: () => fences.addFence({ template: 'desktop', near }) },
    { label: 'Portal: Descargas', click: () => fences.addFence({ template: 'downloads', near }) },
    { label: 'Portal: Documentos', click: () => fences.addFence({ template: 'documents', near }) },
    { label: 'Portal: Imágenes', click: () => fences.addFence({ template: 'pictures', near }) },
    { label: 'Portal: elegir carpeta…', click: () => chooseFolder(null, (dir) => fences.addFence({ template: 'folder', dir, near })) }
  ];
}

function popup(menu, id, win) {
  fences.menuOpened(id);
  menu.popup({ window: win, callback: () => fences.menuClosed(id) });
}

function confirmDelete(win, f) {
  dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Eliminar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Eliminar cerca',
    message: `¿Eliminar la cerca "${f.title}"?`,
    detail: 'Tus archivos no se borran; solo se elimina la cerca.'
  }).then((r) => { if (r.response === 0) fences.deleteFence(f.id); });
}

function showFenceMenu(id) {
  const f = store.fence(id);
  const win = fences.getWin(id);
  if (!f || !win) return;
  const set = (p) => fences.patch(id, p, { notify: true });
  const radio = (label, checked, click) => ({ label, type: 'radio', checked, click });

  const t = [
    { label: 'Nueva cerca', submenu: newFenceItems(id) },
    { type: 'separator' },
    { label: 'Cambiar nombre…', click: () => { win.focus(); fences.send(id, 'rename-title'); } },
    { label: f.rolled ? 'Desenrollar' : 'Enrollar', enabled: !f.autoRoll, click: () => set({ rolled: !f.rolled }) },
    { label: 'Enrollar al salir el ratón', type: 'checkbox', checked: f.autoRoll, click: (i) => set({ autoRoll: i.checked }) },
    {
      label: 'Alinear y ordenar',
      submenu: [
        { label: 'Igualar tamaño de todas a esta', click: () => fences.alignTo(id, 'size') },
        { label: 'Igualar solo el ancho', click: () => fences.alignTo(id, 'width') },
        { label: 'Igualar solo el alto', click: () => fences.alignTo(id, 'height') },
        { type: 'separator' },
        { label: 'Alinear las demás por la izquierda', click: () => fences.alignTo(id, 'left') },
        { label: 'Alinear las demás por arriba', click: () => fences.alignTo(id, 'top') },
        { label: 'Alinear las demás por la derecha', click: () => fences.alignTo(id, 'right') },
        { label: 'Alinear las demás por abajo', click: () => fences.alignTo(id, 'bottom') },
        { type: 'separator' },
        { label: 'Apilar las demás en columna debajo de esta', click: () => fences.alignTo(id, 'column') },
        { label: 'Ordenar todas en cuadrícula', click: () => fences.tidy(id) },
        { type: 'separator' },
        { label: 'Imán entre cercas', type: 'checkbox', checked: store.settings().snap, click: (i) => { store.setSettings({ snap: i.checked }); fences.broadcastSettings(); } }
      ]
    },
    { label: 'Bloquear posición y tamaño', type: 'checkbox', checked: f.locked, click: (i) => set({ locked: i.checked }) },
    { label: 'Mantener encima de otras ventanas', type: 'checkbox', checked: f.pinned, click: (i) => set({ pinned: i.checked }) },
    { type: 'separator' },
    { label: 'Color', submenu: COLORS.map(([label, c]) => radio(label, f.color === c, () => set({ color: c }))) },
    {
      label: 'Vista',
      submenu: [
        radio('Cuadrícula', f.view === 'grid', () => set({ view: 'grid' })),
        radio('Lista', f.view === 'list', () => set({ view: 'list' }))
      ]
    }
  ];

  if (f.portal) {
    const portal = f.portal;
    t.push(
      { label: 'Ordenar por', submenu: Object.entries(PORTAL_SORTS).map(([k, label]) => radio(label, portal.sort === k, () => set({ portal: { ...portal, sort: k } }))) },
      { label: 'Mostrar', submenu: Object.entries(FILTER_LABELS).map(([k, label]) => radio(label, portal.filter === k, () => set({ portal: { ...portal, filter: k } }))) },
      { label: 'Mostrar archivos ocultos', type: 'checkbox', checked: portal.showHidden, click: (i) => set({ portal: { ...portal, showHidden: i.checked } }) },
      { label: 'Abrir carpeta', click: () => shell.openPath(portal.dirs[0]) },
      { label: 'Quitar portal (volver a cerca normal)', click: () => set({ portal: null }) }
    );
  } else {
    t.push(
      { label: 'Ordenar por', submenu: Object.entries(FENCE_SORTS).map(([k, label]) => radio(label, f.sort === k, () => set({ sort: k }))) },
      { label: 'Convertir en portal de carpeta…', click: () => chooseFolder(win, (dir) => set({ portal: { dirs: [dir] } })) },
      { label: 'Vaciar cerca', enabled: f.items.length > 0, click: () => set({ items: [] }) }
    );
  }

  t.push(
    { type: 'separator' },
    { label: 'Duplicar cerca', click: () => fences.duplicate(id) },
    { label: 'Eliminar cerca…', click: () => confirmDelete(win, f) },
    { type: 'separator' },
    { label: 'Configuración…', click: () => require('./settingsWindow').open() }
  );
  popup(Menu.buildFromTemplate(t), id, win);
}

/** Menú de un elemento. Devuelve la acción que debe ejecutar la ventana ('open', 'rename', 'restore', 'remove') o null. */
function showItemMenu(sender, ctx) {
  const id = fences.idFor(sender);
  const f = store.fence(id);
  const win = fences.getWin(id);
  if (!f || !win || !ctx || typeof ctx.path !== 'string') return Promise.resolve(null);

  return new Promise((resolve) => {
    const t = [
      { label: 'Abrir', click: () => resolve('open') },
      { label: 'Mostrar en carpeta', click: () => { shell.showItemInFolder(ctx.path); resolve(null); } },
      { label: 'Copiar ruta', click: () => { clipboard.writeText(ctx.path); resolve(null); } }
    ];
    if (!f.portal) {
      const item = f.items[ctx.index];
      t.push({ type: 'separator' }, { label: 'Cambiar nombre mostrado…', click: () => resolve('rename') });
      if (item && item.n) t.push({ label: 'Restaurar nombre original', click: () => resolve('restore') });
      const others = store.fences().filter((o) => o.id !== id && !o.portal);
      if (others.length) {
        t.push({ label: 'Mover a', submenu: others.map((o) => ({ label: o.title, click: () => { fences.transferItem(id, o.id, ctx.path); resolve(null); } })) });
      }
      const back = store.settings().hideDesktop && require('./desktopHide').inDesktop(ctx.path);
      t.push({ label: back ? 'Sacar de la cerca (vuelve al Escritorio)' : 'Quitar de la cerca', click: () => resolve('remove') });
    }
    fences.menuOpened(id);
    Menu.buildFromTemplate(t).popup({
      window: win,
      // el cierre puede notificarse antes que el clic; esperamos un instante antes de resolver con null
      callback: () => { fences.menuClosed(id); setTimeout(() => resolve(null), 150); }
    });
  });
}

module.exports = { newFenceItems, showFenceMenu, showItemMenu, chooseFolder };
