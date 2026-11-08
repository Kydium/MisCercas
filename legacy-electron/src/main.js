'use strict';
const { app, Notification } = require('electron');
const path = require('path');

app.setName('Mis Cercas');
app.setAppUserModelId('com.michael.miscercas');
// Misma carpeta de datos tanto en modo desarrollo como empaquetada (así no se pierden las cercas).
app.setPath('userData', process.env.MC_USER_DATA || path.join(app.getPath('appData'), 'mis-cercas'));
// Evita que Windows deje de pintar las cercas cuando quedan tapadas por otra ventana.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const log = require('./logger');
log.init(app.getPath('userData'));

let lastNotice = 0;
function reportCrash(err) {
  log.error('Error no controlado', err);
  if (Date.now() - lastNotice < 60000) return;
  lastNotice = Date.now();
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Mis Cercas',
        body: 'Ocurrió un error interno. Quedó anotado en el registro (menú del icono de la bandeja).'
      }).show();
    }
  } catch { /* sin notificaciones */ }
}
process.on('uncaughtException', reportCrash);
process.on('unhandledRejection', reportCrash);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const store = require('./store');
  const fences = require('./fences');
  const ipc = require('./ipc');
  const tray = require('./tray');
  const system = require('./system');

  app.on('second-instance', () => fences.setHidden(false));

  app.whenReady().then(() => {
    store.init(app.getPath('userData'));
    if (!store.fences().length) store.newFence({ title: 'Mi primera cerca' });
    fences.init();
    ipc.register({ toggle: () => fences.toggleAll() });
    tray.init();
    require('./desktopHide').init();
    if (!system.setHotkey(store.settings().hotkey, () => fences.toggleAll())) {
      log.warn('No se pudo registrar el atajo', store.settings().hotkey);
    }
    log.info('Mis Cercas iniciada', app.getVersion(), 'Electron', process.versions.electron);
  });

  app.on('before-quit', () => store.flush());
  app.on('will-quit', () => system.releaseHotkeys());
  // La aplicación sigue viva en la bandeja aunque no haya ventanas abiertas.
  app.on('window-all-closed', () => {});
}
