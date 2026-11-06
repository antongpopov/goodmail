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
