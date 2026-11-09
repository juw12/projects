/**
 * Theme color palettes. Each theme exposes the colors used by the renderer
 * for backgrounds, accents, and text. Settings UI consumes themeId and
 * applies it via CSS variables on :root.
 */

export interface Theme {
  id: 'minimal' | 'neon' | 'synthwave';
  name: string;
  bg: string;
  bgAccent: string;
  fg: string;
  fgMuted: string;
  accent: string;
  accentSoft: string;
  border: string;
}

export const THEMES: Record<Theme['id'], Theme> = {
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    bg: '#0e0e10',
    bgAccent: '#16161a',
    fg: '#f4f4f5',
    fgMuted: '#9ca3af',
    accent: '#e4e4e7',
    accentSoft: '#27272a',
    border: '#27272a',
  },
  neon: {
    id: 'neon',
    name: 'Neon',
    bg: '#06080d',
    bgAccent: '#0c1118',
    fg: '#e8fff3',
    fgMuted: '#7d8a99',
    accent: '#5af2a0',
    accentSoft: '#1a3a2a',
    border: '#1a2620',
  },
  synthwave: {
    id: 'synthwave',
    name: 'Synthwave',
    bg: '#120b25',
    bgAccent: '#1c1140',
    fg: '#fff0fa',
    fgMuted: '#9a7ec9',
    accent: '#ff3df0',
    accentSoft: '#3b1655',
    border: '#2d1d54',
  },
};

export function applyTheme(id: Theme['id']): void {
  const t = THEMES[id];
  const root = document.documentElement;
  root.style.setProperty('--bg', t.bg);
  root.style.setProperty('--bg-accent', t.bgAccent);
  root.style.setProperty('--fg', t.fg);
  root.style.setProperty('--fg-muted', t.fgMuted);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-soft', t.accentSoft);
  root.style.setProperty('--border', t.border);
}
