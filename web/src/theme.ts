import { store, save } from './util.ts';

export type Theme = 'auto' | 'light' | 'dark';

/** Auto = no data-theme attribute, so the CSS follows prefers-color-scheme. */
export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', t === 'auto' ? 'light dark' : t);
}

export const loadTheme = () => store<Theme>('theme', 'auto');
export function setTheme(t: Theme) {
  save('theme', t);
  applyTheme(t);
}

// Accent colors (light-mode and dark-mode shades), Outlook-style.
export const ACCENTS: { id: string; name: string; light: string; dark: string }[] = [
  { id: 'blue', name: 'Blue', light: '#0f6cbd', dark: '#2886de' },
  { id: 'teal', name: 'Teal', light: '#03787c', dark: '#2aa0a4' },
  { id: 'green', name: 'Green', light: '#107c10', dark: '#3fa33f' },
  { id: 'purple', name: 'Purple', light: '#5c2e91', dark: '#9a72d0' },
  { id: 'pink', name: 'Pink', light: '#b4009e', dark: '#d660c9' },
  { id: 'red', name: 'Red', light: '#c50f1f', dark: '#e3505a' },
  { id: 'orange', name: 'Orange', light: '#c4501a', dark: '#e6733a' },
  { id: 'graphite', name: 'Graphite', light: '#4a5056', dark: '#8d959e' },
];

export const isCustomAccent = (id: string) => /^#[0-9a-f]{6}$/i.test(id);

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}
const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

/** Shades for a colour picked freely: white text must stay readable on it in light mode, and it must stand out on dark surfaces. */
export function customShades(hex: string) {
  const [h, s, l] = hexToHsl(hex);
  return { light: hsl(h, s, Math.min(l, 0.4)), dark: hsl(h, s, Math.max(l, 0.58)) };
}

export function applyAccent(id: string) {
  const a = isCustomAccent(id) ? customShades(id) : (ACCENTS.find((x) => x.id === id) ?? ACCENTS[0]);
  const st = document.documentElement.style;
  st.setProperty('--accent', a.light);
  st.setProperty('--accent-dark', a.dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.light);
}
export const loadAccent = () => store<string>('accent', 'blue');
export function setAccent(id: string) {
  save('accent', id);
  applyAccent(id);
}
