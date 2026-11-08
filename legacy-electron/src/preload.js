'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => {
  ipcRenderer.on(channel, (_e, payload) => cb(payload));
};

contextBridge.exposeInMainWorld('api', {
  /* cercas */
  state: call('state:get'),
  patch: call('fence:patch'),
  fenceMenu: call('fence:menu'),
  itemMenu: call('item:menu'),
  portalList: call('portal:list'),
  itemsInfo: call('items:info'),
  icon: call('icon:get'),
  open: call('item:open'),
  addItems: call('item:add'),
  transfer: call('item:transfer'),
  releaseItem: call('item:release'),
  action: call('app:action'),
  pathOf: (file) => webUtils.getPathForFile(file),
  onReload: on('reload'),
  onLayout: on('layout'),
  onRenameTitle: on('rename-title'),
  onSettings: on('settings'),

  /* configuración */
  settingsGet: call('settings:get'),
  settingsSet: call('settings:set'),
  dataAction: call('data:action')
});
