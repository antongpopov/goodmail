import type { Addr } from './api.ts';
import { t, L, timeOpts } from './i18n.ts';

const PALETTE = ['#c239b3', '#e3008c', '#d13438', '#ca5010', '#986f0b', '#498205', '#038387', '#0078d4', '#5c2e91', '#8764b8', '#4f6bed', '#007f7f'];

export function avatarColor(seed: string) {
  let h = 0;
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function initials(a: Addr) {
  const src = (a.name || a.address.split('@')[0] || '?').replace(/[^\p{L}\p{N} .-]/gu, '').trim();
  const parts = src.split(/[\s.\-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 1).toUpperCase();
}

export const displayName = (a: Addr) => a.name || a.address;
export const fullAddr = (a: Addr) => (a.name ? `${a.name} <${a.address}>` : a.address);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).valueOf();

export function listTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days === 0) return d.toLocaleTimeString(L(), { hour: '2-digit', minute: '2-digit', ...timeOpts() });
  if (days === 1) return t('Yesterday');
  if (days < 7) return d.toLocaleDateString(L(), { weekday: 'short', hour: '2-digit', minute: '2-digit', ...timeOpts() });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(L(), { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(L(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fullTime(ts: number) {
  return new Date(ts).toLocaleString(L(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...timeOpts() });
}

/** Outlook-style date buckets for the message list. */
export function bucket(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return t('Today');
  if (days === 1) return t('Yesterday');
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  if (days <= dow) return t('This week');
  if (days <= dow + 7) return t('Last week');
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return t('Earlier this month');
  return d.toLocaleDateString(L(), { month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function textToHtml(s: string) {
  return escapeHtml(s)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>');
}

/** Parse "A <a@x>, b@y; c@z" into a clean comma-joined list for nodemailer. */
export function parseRecipients(s: string) {
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ');
}

export function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`gm:${key}`);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function save(key: string, v: unknown) {
  try {
    localStorage.setItem(`gm:${key}`, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}
