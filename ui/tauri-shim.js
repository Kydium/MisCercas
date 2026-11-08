'use strict';
// Puente entre la interfaz (que usa window.api) y el motor en Rust (Tauri).
(function () {
  const T = window.__TAURI__;
  const invoke = (cmd, args) => T.core.invoke(cmd, args || {});
  const params = new URLSearchParams(location.search);
  const myId = params.get('id');
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const withTheme = (p) => {
    const out = { ...p };
    out.theme = window.MCThemes.resolve(p.settings.theme, mq.matches);
    return out;
  };
  const on = (name, filterById) => (cb) => {
    T.event.listen(name, (ev) => {
      const p = ev.payload || {};
      if (filterById && p.id && p.id !== myId) return;
      cb(name === 'settings' ? withTheme(p) : p);
    });
  };

  window.api = {
    state: async () => {
      const s = await invoke('state_get', { id: myId });
      return s ? withTheme(s) : s;
    },
    patch: (patch) => invoke('fence_patch', { id: myId, patch }),
    fenceMenu: (args) => invoke('fence_menu', { id: myId, args: args || null }),
    itemMenu: (args) => invoke('item_menu', { id: myId, args: args || null }),
    portalList: () => invoke('portal_list', { id: myId }),
    itemsInfo: (paths) => invoke('items_info', { paths }),
    icon: (path, size, isDir) => invoke('icon_get', { path, size: size || null, isDir: !!isDir }),
    open: (path) => invoke('item_open', { path }),
    addItems: (paths, index) => invoke('item_add', { id: myId, paths, index: index == null ? null : index }),
    transfer: (args) => invoke('item_transfer', { id: myId, args }),
    releaseItem: (args) => invoke('item_release', { id: myId, args: args || null }),
    action: (name) => invoke('app_action', { id: myId, name }),
    pathOf: () => '',
    onReload: on('reload', true),
    onLayout: on('layout', true),
    onRenameTitle: on('rename-title', true),
    onSettings: on('settings', false),

    settingsGet: async () => {
      const p = await invoke('settings_get');
      return { ...withTheme(p), themes: window.MCThemes.THEMES, groups: window.MCThemes.GROUPS };
    },
    settingsSet: async (patch) => {
      const p = await invoke('settings_set', { patch });
      return { ...withTheme(p), themes: window.MCThemes.THEMES, groups: window.MCThemes.GROUPS, error: p.error || null };
    },
    dataAction: (name) => invoke('data_action', { name })
  };

  // Arrastrar la cerca por la barra y cambiar tamaño desde la esquina
  document.addEventListener('DOMContentLoaded', () => {
    for (const sel of ['#bar', '#title', '#badges', '#bar .spacer']) {
      document.querySelectorAll(sel).forEach((el) => el.setAttribute('data-tauri-drag-region', ''));
    }
    const grip = document.getElementById('grip');
    if (grip && T.window) {
      grip.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        T.window.getCurrentWindow().startResizeDragging('SouthEast');
      });
    }
    // Archivos soltados desde el Explorador
    if (myId && T.webview) {
      T.webview.getCurrentWebview().onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === 'drop' && p.paths && p.paths.length) window.api.addItems(p.paths, null);
      });
    }
  });
})();
