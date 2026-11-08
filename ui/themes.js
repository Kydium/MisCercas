'use strict';
// Catálogo de temas. Cada tema define una paleta corta; el resto de variables CSS se deriva de ella.
// Se usa en el proceso principal (validar y resolver) y se envía ya resuelto a las ventanas.

const DEFAULT_FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
const MONO_FONT = '"Cascadia Mono", Consolas, "Courier New", monospace';
const RETRO_FONT = 'Tahoma, "MS Sans Serif", "Segoe UI", sans-serif';

const GROUPS = ['Claros', 'Oscuros', 'Color', 'Cristal'];

// Campos: bg (fondo), bg2 (segundo color para degradado), fg (texto), accent (acento recomendado),
// header: tint | glass | clear | custom, k (factor sobre la transparencia elegida por el usuario),
// y ajustes opcionales (tint, border, hdrText, hdrBg, hl, glow, font, hdrShadow).
// Cada tema se construye en dos acabados: "con relieve" (brillo, borde luminoso y sombra en el texto)
// y "plano" (colores lisos). Para el plano pueden darse flatBorder, divider y hdrBgFlat.
const DEFS = [
  /* ---- Claros ---- */
  { id: 'light', name: 'Claro', group: 'Claros', dark: false, bg: '#f8fafe', fg: '#1a2233', accent: '#4d8dff', hdrText: '#12203a' },
  { id: 'paper', name: 'Papel', group: 'Claros', dark: false, bg: '#f6ebd0', fg: '#2b2417', accent: '#b5651d', tint: 0.24, k: 1.15, border: 'rgba(90, 60, 20, 0.24)' },
  { id: 'sakura', name: 'Sakura', group: 'Claros', dark: false, bg: '#ffe0ec', fg: '#4a2535', accent: '#e05a8a', tint: 0.28, k: 1.15, border: 'rgba(180, 60, 100, 0.24)' },
  { id: 'mint', name: 'Menta', group: 'Claros', dark: false, bg: '#d9f6ea', fg: '#123a2e', accent: '#1fae7a', tint: 0.28, k: 1.15, border: 'rgba(20, 120, 80, 0.24)' },
  { id: 'sky', name: 'Cielo', group: 'Claros', dark: false, bg: '#d7eaff', fg: '#12304f', accent: '#2f86eb', tint: 0.28, k: 1.15, border: 'rgba(30, 100, 200, 0.24)' },
  { id: 'lavender', name: 'Lavanda', group: 'Claros', dark: false, bg: '#e7dfff', fg: '#2b2250', accent: '#7a5af5', tint: 0.28, k: 1.15, border: 'rgba(100, 70, 200, 0.24)' },
  { id: 'peach', name: 'Durazno', group: 'Claros', dark: false, bg: '#ffe5d3', fg: '#4a2a1a', accent: '#ee7a3c', tint: 0.28, k: 1.15, border: 'rgba(200, 100, 40, 0.24)' },

  /* ---- Oscuros ---- */
  { id: 'dark', name: 'Oscuro', group: 'Oscuros', dark: true, bg: '#141926', fg: '#f3f6fc', accent: '#4d8dff' },
  { id: 'midnight', name: 'Medianoche', group: 'Oscuros', dark: true, bg: '#080d2a', fg: '#e6ebfb', accent: '#6c8cff', k: 1.12 },
  { id: 'graphite', name: 'Grafito', group: 'Oscuros', dark: true, bg: '#1f2023', fg: '#ececee', accent: '#8fa8ff', tint: 0.42, k: 1.12 },
  { id: 'amoled', name: 'Negro puro', group: 'Oscuros', dark: true, bg: '#000000', fg: '#f2f2f2', accent: '#3ea6ff', border: 'rgba(255, 255, 255, 0.24)' },
  { id: 'forest', name: 'Bosque', group: 'Oscuros', dark: true, bg: '#0a2418', fg: '#e6f4ea', accent: '#4cc38a', tint: 0.42, k: 1.12 },
  { id: 'ocean', name: 'Océano', group: 'Oscuros', dark: true, bg: '#052a3d', fg: '#dff3fa', accent: '#2ec4d6', tint: 0.42, k: 1.12 },
  { id: 'wine', name: 'Vino', group: 'Oscuros', dark: true, bg: '#34101f', fg: '#fbe9ee', accent: '#e0577a', k: 1.12 },
  { id: 'mocha', name: 'Moka', group: 'Oscuros', dark: true, bg: '#2e1f16', fg: '#f3e8df', accent: '#d49a6a', tint: 0.4, k: 1.12 },
  { id: 'dracula', name: 'Drácula', group: 'Oscuros', dark: true, bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9', tint: 0.4, k: 1.12 },
  { id: 'nord', name: 'Nord', group: 'Oscuros', dark: true, bg: '#2e3440', fg: '#eceff4', accent: '#88c0d0', tint: 0.32, k: 1.12 },
  { id: 'solarized', name: 'Solarized', group: 'Oscuros', dark: true, bg: '#002b36', fg: '#eee8d5', accent: '#268bd2', k: 1.12 },
  { id: 'monokai', name: 'Monokai', group: 'Oscuros', dark: true, bg: '#272822', fg: '#f8f8f2', accent: '#a6e22e', tint: 0.28, k: 1.12 },
  { id: 'gruvbox', name: 'Gruvbox', group: 'Oscuros', dark: true, bg: '#282828', fg: '#ebdbb2', accent: '#fabd2f', tint: 0.26, hdrText: '#fbf1c7', k: 1.12 },
  { id: 'tokyo', name: 'Tokyo Night', group: 'Oscuros', dark: true, bg: '#1a1b26', fg: '#c0caf5', accent: '#7aa2f7', k: 1.12 },
  { id: 'catppuccin', name: 'Catppuccin', group: 'Oscuros', dark: true, bg: '#1e1e2e', fg: '#cdd6f4', accent: '#cba6f7', tint: 0.36, k: 1.12 },
  { id: 'rosepine', name: 'Rosé Pine', group: 'Oscuros', dark: true, bg: '#191724', fg: '#e0def4', accent: '#eb6f92', k: 1.12 },
  { id: 'github', name: 'GitHub', group: 'Oscuros', dark: true, bg: '#0d1117', fg: '#e6edf3', accent: '#2f81f7', k: 1.12 },

  /* ---- Color ---- */
  {
    id: 'cyber', name: 'Neón', group: 'Color', dark: true, bg: '#0c081c', fg: '#e8f7ff', accent: '#ff2bd6',
    border: 'rgba(0, 240, 255, 0.45)', glow: 'inset 0 0 22px rgba(255, 43, 214, 0.22)', tint: 0.42, k: 1.15
  },
  {
    id: 'matrix', name: 'Matrix', group: 'Color', dark: true, bg: '#000c04', fg: '#8dffb0', accent: '#00e05a', hdrText: '#c8ffd9',
    border: 'rgba(0, 255, 102, 0.38)', glow: 'inset 0 0 20px rgba(0, 255, 102, 0.12)', font: MONO_FONT, tint: 0.3, k: 1.15
  },
  { id: 'sunset', name: 'Atardecer', group: 'Color', dark: true, bg: '#2a1040', bg2: '#6a1f2c', fg: '#fff1e8', accent: '#ff7a45', tint: 0.46, k: 1.22 },
  { id: 'aurora', name: 'Aurora', group: 'Color', dark: true, bg: '#0a1c28', bg2: '#2b1043', fg: '#e6fff8', accent: '#5ef2c4', tint: 0.34, k: 1.22 },
  {
    id: 'contrast', name: 'Alto contraste', group: 'Color', dark: true, bg: '#000000', fg: '#ffffff', accent: '#ffd400',
    header: 'custom', hdrBg: '#ffd400', hdrText: '#000000', hdrShadow: 'none', border: 'rgba(255, 255, 255, 0.95)', k: 1.4
  },
  {
    id: 'retro95', name: 'Retro 95', group: 'Color', dark: false, bg: '#c0c0c0', fg: '#000000', accent: '#000080',
    header: 'custom', hdrBg: 'linear-gradient(90deg, #000080, #1084d0)', hdrBgFlat: '#000080', hdrText: '#ffffff', hdrShadow: 'none',
    border: 'rgba(255, 255, 255, 0.9)', hl: 'rgba(0, 0, 0, 0.35)', font: RETRO_FONT, k: 1.45
  },

  /* ---- Cristal: la barra de título también es translúcida ---- */
  {
    id: 'glass-dark', name: 'Cristal oscuro', group: 'Cristal', dark: true, bg: '#12161f', fg: '#f4f7ff', accent: '#7aa8ff',
    header: 'glass', k: 0.8, border: 'rgba(255, 255, 255, 0.3)', flatBorder: 'rgba(255, 255, 255, 0.16)', hl: 'rgba(255, 255, 255, 0.24)', hdrShadow: '0 1px 3px rgba(0, 0, 0, 0.6)'
  },
  {
    id: 'glass-light', name: 'Cristal claro', group: 'Cristal', dark: false, bg: '#ffffff', fg: '#0e1726', accent: '#3b82f6',
    header: 'glass', hdrK: 1.05, k: 0.78, border: 'rgba(255, 255, 255, 0.7)', flatBorder: 'rgba(0, 0, 0, 0.14)', hl: 'rgba(255, 255, 255, 0.85)', hdrShadow: 'none'
  },
  {
    id: 'frost', name: 'Escarcha', group: 'Cristal', dark: false, bg: '#cfe5ff', fg: '#0b2342', accent: '#2f8cff',
    header: 'glass', hdrK: 1.0, glassMin: 0.62, k: 0.8, border: 'rgba(255, 255, 255, 0.75)', flatBorder: 'rgba(15, 60, 130, 0.22)', hl: 'rgba(255, 255, 255, 0.9)', hdrShadow: 'none'
  },
  {
    id: 'smoke', name: 'Humo', group: 'Cristal', dark: true, bg: '#0b0d12', fg: '#f5f7fa', accent: '#9db4ff',
    header: 'clear', hdrClear: 0.34, clearMin: 0.46, k: 0.72, border: 'rgba(255, 255, 255, 0.26)', flatBorder: 'rgba(255, 255, 255, 0.14)', hl: 'rgba(255, 255, 255, 0.2)', hdrShadow: '0 1px 3px rgba(0, 0, 0, 0.75)'
  }
];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const NO_LAYER = 'linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0))';
const HALO = '0 0 3px rgba(255, 255, 255, 0.9), 0 0 6px rgba(255, 255, 255, 0.85), 0 0 10px rgba(255, 255, 255, 0.6)';

function build(d) {
  const dark = !!d.dark;
  const fg = rgb(d.fg).join(', ');
  const border = d.border || (dark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.16)');
  const hl = d.hl || (dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.6)');
  // Acabado "con relieve" (el original): brillo en la barra, línea luminosa arriba y sombra en el texto
  const vars = {
    '--surface': rgb(d.bg).join(', '),
    '--surface2': rgb(d.bg2 || d.bg).join(', '),
    '--text': d.fg,
    '--muted': `rgba(${fg}, 0.62)`,
    '--border': border,
    '--hover': dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.07)',
    '--tool-hover': dark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
    '--hdr-text': d.hdrText || (dark ? '#ffffff' : d.fg),
    '--hdr-shadow': d.hdrShadow || (dark ? '0 1px 2px rgba(0, 0, 0, 0.45)' : 'none'),
    '--hdr-halo': HALO,
    '--hdr-tint': String(d.tint != null ? d.tint : dark ? 0.5 : 0.26),
    '--hdr-bg': d.hdrBg || 'none',
    '--hdr-k': String(d.hdrK != null ? d.hdrK : 0.55),
    '--hdr-clear': String(d.hdrClear != null ? d.hdrClear : dark ? 0.16 : 0.5),
    '--glass-min': '0',
    '--clear-min': '0',
    '--shine': 'linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0))',
    '--gloss': 'linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.02))',
    '--rim': `inset 0 1px 0 ${hl}`,
    '--bar-line': border,
    '--label-shadow': dark ? '0 1px 2px rgba(0, 0, 0, 0.85)' : 'none',
    '--input-bg': dark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.85)',
    '--sel-a': dark ? '0.38' : '0.26',
    '--hl': hl,
    '--glow': d.glow || '0 0 0 0 transparent',
    '--font': d.font || DEFAULT_FONT
  };
  // Acabado "plano": colores lisos, sin degradados, sin borde luminoso y sin sombras en el título
  const flat = {
    ...vars,
    '--border': d.flatBorder || border,
    '--hdr-shadow': 'none',
    '--hdr-halo': 'none',
    // Sin sombra en el texto, la barra translúcida necesita un mínimo de opacidad para que el título se lea
    // sobre cualquier fondo de pantalla (aunque se baje mucho la transparencia general)
    '--glass-min': String(d.glassMin != null ? d.glassMin : 0.55),
    '--clear-min': String(d.clearMin != null ? d.clearMin : 0.4),
    '--hdr-bg': d.hdrBgFlat || vars['--hdr-bg'],
    '--shine': NO_LAYER,
    '--gloss': NO_LAYER,
    '--rim': '0 0 0 0 transparent',
    '--bar-line': d.divider || (dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)')
  };
  return {
    id: d.id,
    name: d.name,
    group: d.group,
    dark,
    accent: d.accent,
    header: d.header || 'tint',
    gradient: !!d.bg2,
    k: d.k || 1,
    vars,
    flat
  };
}

const THEMES = DEFS.map(build);
const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

const isTheme = (id) => id === 'auto' || BY_ID.has(id);

/** Tema ya resuelto. "auto" sigue el modo claro u oscuro de Windows. */
function resolve(id, systemDark) {
  const real = id === 'auto' ? (systemDark ? 'dark' : 'light') : id;
  return BY_ID.get(real) || BY_ID.get('dark');
}

window.MCThemes = { THEMES, GROUPS, isTheme, resolve };
