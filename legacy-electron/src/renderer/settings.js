(() => {
  'use strict';
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const ACCENTS = ['#4d8dff', '#2fbf71', '#8b5cf6', '#ff8a3d', '#ef4b5f', '#ec5fa8', '#14b8c4', '#8b95a7'];

  let P = null; // { settings, theme, themes, groups, autoStart, version, dataDir, hotkey }
  let toastTimer = null;
  let capturing = false;

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  const hotkeyText = (h) => h.replace(/CommandOrControl|Control/g, 'Ctrl').replace(/\+/g, ' + ');
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
  const onAccent = (hex) => {
    const [r, g, b] = hexToRgb(hex).split(',').map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#111111' : '#ffffff';
  };

  /* ---------- selector de tema ---------- */
  function buildThemes() {
    const sel = $('themeSelect');
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = 'Automático (según Windows)';
    sel.appendChild(auto);
    for (const g of P.groups) {
      const og = document.createElement('optgroup');
      og.label = g;
      for (const t of P.themes.filter((x) => x.group === g)) {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    sel.addEventListener('change', () => change({ theme: sel.value }));
  }

  /* ---------- pintar ---------- */
  function paint() {
    const s = P.settings;
    const th = P.theme;
    const accent = s.accentFollowsTheme ? th.accent : s.accent;
    root.dataset.theme = th.dark ? 'dark' : 'light';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--on-accent', onAccent(accent));
    $('version').textContent = `Versión ${P.version}`;
    $('dataDir').textContent = `Tus cercas se guardan en: ${P.dataDir}`;
    $('autoStart').checked = P.autoStart;
    $('animations').checked = s.animations;
    $('showLabels').checked = s.showLabels;
    $('defaultAutoRoll').checked = s.defaultAutoRoll;
    $('keepOnTop').checked = s.keepOnTop;
    $('snap').checked = s.snap;
    $('hideDesktop').checked = s.hideDesktop;
    $('opacity').value = Math.round(s.opacity * 100);
    $('opacityOut').textContent = `${Math.round(s.opacity * 100)} %`;
    $('radius').value = s.radius;
    $('radiusOut').textContent = `${s.radius} px`;
    if (!capturing) $('hotkey').textContent = hotkeyText(s.hotkey);
    for (const id of ['titlebar', 'finish', 'iconSize', 'openWith']) {
      for (const b of $(id).children) b.classList.toggle('on', String(s[id]) === b.dataset.v);
    }

    $('themeNote').textContent = s.theme === 'auto' ? `Automático: ahora usa «${th.name}»` : `Tema actual: ${th.name}`;
    $('themeSelect').value = s.theme;

    $('accentNote').textContent = s.accentFollowsTheme ? 'Lo elige el tema. Toca un color para fijar el tuyo.' : 'Color elegido por ti.';
    const pill = $('accent').firstChild;
    pill.classList.toggle('on', s.accentFollowsTheme);
    pill.firstChild.style.background = th.accent;
    for (const b of $('accent').children) {
      if (b !== pill) b.classList.toggle('on', !s.accentFollowsTheme && b.dataset.v.toLowerCase() === s.accent.toLowerCase());
    }
  }

  async function change(patch) {
    const r = await api.settingsSet(patch);
    if (r.error) toast(r.error);
    P = { ...P, ...r };
    paint();
  }

  /* ---------- controles ---------- */
  for (const id of ['autoStart', 'animations', 'showLabels', 'defaultAutoRoll', 'keepOnTop', 'snap', 'hideDesktop']) {
    $(id).addEventListener('change', (e) => change({ [id]: e.target.checked }));
  }
  for (const id of ['titlebar', 'finish', 'iconSize', 'openWith']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) change({ [id]: id === 'iconSize' ? Number(b.dataset.v) : b.dataset.v });
    });
  }
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'pill';
  pill.title = 'Usar el color que trae el tema';
  pill.append(document.createElement('i'), document.createTextNode('Del tema'));
  pill.addEventListener('click', () => change({ accentFollowsTheme: true }));
  $('accent').appendChild(pill);
  for (const c of ACCENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = c;
    b.title = c;
    b.style.background = c;
    b.addEventListener('click', () => change({ accent: c, accentFollowsTheme: false }));
    $('accent').appendChild(b);
  }
  let sliderTimer = null;
  const slider = (id, key, scale, out, unit) => {
    $(id).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      $(out).textContent = `${v} ${unit}`;
      clearTimeout(sliderTimer);
      sliderTimer = setTimeout(() => change({ [key]: v / scale }), 60);
    });
  };
  slider('opacity', 'opacity', 100, 'opacityOut', '%');
  slider('radius', 'radius', 1, 'radiusOut', 'px');

  /* ---------- atajo de teclado ---------- */
  const SPECIAL = {
    Space: 'Space', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down',
    ArrowLeft: 'Left', ArrowRight: 'Right', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
    Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\'
  };
  function keyName(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    return SPECIAL[code] || null;
  }
  const hk = $('hotkey');
  const stopCapture = () => { capturing = false; hk.classList.remove('capturing'); if (P) hk.textContent = hotkeyText(P.settings.hotkey); };
  hk.addEventListener('click', () => {
    capturing = true;
    hk.classList.add('capturing');
    hk.textContent = 'Pulsa la combinación…';
    hk.focus();
  });
  hk.addEventListener('blur', stopCapture);
  hk.addEventListener('keydown', (e) => {
    if (!capturing) return;
    e.preventDefault();
    if (e.key === 'Escape') { stopCapture(); return; }
    const key = keyName(e.code);
    if (!key) return; // solo se pulsó un modificador
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    if (!mods.length) { toast('Incluye al menos Ctrl, Alt o Mayús en la combinación.'); return; }
    stopCapture();
    change({ hotkey: [...mods, key].join('+') });
  });

  /* ---------- datos ---------- */
  for (const b of document.querySelectorAll('[data-act]')) {
    b.addEventListener('click', async () => {
      const r = await api.dataAction(b.dataset.act);
      if (r && r.error) toast(r.error);
      else if (r && r.ok && ['export', 'import', 'reset'].includes(b.dataset.act)) {
        toast(b.dataset.act === 'export' ? 'Configuración exportada.' : 'Listo.');
      }
      if (r && r.ok) { P = await api.settingsGet(); paint(); }
    });
  }

  api.onSettings(({ settings, theme }) => {
    if (!P) return;
    P.settings = settings;
    P.theme = theme;
    paint();
  });

  api.settingsGet().then((p) => { P = p; buildThemes(); paint(); });
})();
