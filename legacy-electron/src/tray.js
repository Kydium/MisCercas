'use strict';
const { Tray, Menu, app, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const store = require('./store');
const fences = require('./fences');
const menus = require('./menus');
const system = require('./system');
const log = require('./logger');
const settingsWindow = require('./settingsWindow');

const ASSETS = path.join(__dirname, '..', 'assets');
const iconFile = path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
let tray = null;

const hotkeyLabel = () => store.settings().hotkey.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl');

function about() {
  dialog.showMessageBox({
    type: 'info',
    title: 'Acerca de Mis Cercas',
    message: `Mis Cercas ${app.getVersion()}`,
    detail: `Organiza tu escritorio con cercas, portales de carpeta y disposiciones guardadas.\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    icon: nativeImage.createFromPath(path.join(ASSETS, 'icon.png')),
    buttons: ['Aceptar'],
    noLink: true
  });
}

function build() {
  const snaps = store.snapshots();
  const snapshotMenu = [{ label: 'Guardar disposición actual', click: () => fences.saveSnapshot() }];
  if (snaps.length) {
    snapshotMenu.push(
      { type: 'separator' },
      ...snaps.map((s) => ({ label: `Restaurar: ${s.name}`, click: () => fences.restoreSnapshot(s.id) })),
      { type: 'separator' },
      { label: 'Eliminar', submenu: snaps.map((s) => ({ label: s.name, click: () => fences.deleteSnapshot(s.id) })) }
    );
  }
  return Menu.buildFromTemplate([
    { label: `${fences.isHidden() ? 'Mostrar' : 'Ocultar'} cercas  (${hotkeyLabel()})`, click: () => fences.toggleAll() },
    { label: 'Nueva cerca', submenu: menus.newFenceItems() },
    { label: 'Disposiciones', submenu: snapshotMenu },
    { label: 'Ordenar cercas en cuadrícula (mismo tamaño)', click: () => fences.tidy() },
    { label: 'Ocultar del Escritorio lo que está en cercas', type: 'checkbox', checked: store.settings().hideDesktop, click: (i) => { store.setSettings({ hideDesktop: i.checked }); fences.broadcastSettings(); } },
    { label: 'Reubicar cercas en pantalla', click: () => fences.arrange() },
    { type: 'separator' },
    { label: 'Configuración…', click: () => settingsWindow.open() },
    { label: 'Iniciar con Windows', type: 'checkbox', checked: system.getAutoStart(), click: (i) => system.setAutoStart(i.checked) },
    { type: 'separator' },
    { label: 'Abrir carpeta de datos', click: () => shell.openPath(app.getPath('userData')) },
    { label: 'Ver registro de errores', click: () => { if (log.file) shell.showItemInFolder(log.file); } },
    { label: 'Acerca de Mis Cercas', click: about },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() }
  ]);
}

function init() {
  try {
    tray = new Tray(nativeImage.createFromPath(iconFile));
    tray.setToolTip('Mis Cercas');
    tray.on('click', () => fences.toggleAll());
    if (process.platform === 'win32') tray.on('right-click', () => tray.popUpContextMenu(build()));
    else tray.setContextMenu(build());
  } catch (e) {
    log.warn('No se pudo crear el icono de la bandeja', e.message);
  }
}

module.exports = { init };
