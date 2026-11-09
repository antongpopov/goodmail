import { dateOrder } from './i18n.ts';

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "9/11/2026", "09.11.26", "2026-11-09", "9/11" → "YYYY-MM-DD" (in the order of the chosen date format), or null. */
export function parseDate(text: string): string | null {
  const parts = text.trim().split(/[^0-9]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  let d: number, m: number, y: number;
  if (parts.length === 3 && parts[0].length === 4) [y, m, d] = nums;
  else {
    const order = dateOrder().filter((k) => parts.length === 3 || k !== 'y');
    const pick = (k: string) => nums[order.indexOf(k as 'd')];
    d = pick('d');
    m = pick('m');
    y = parts.length === 3 ? pick('y') : new Date().getFullYear();
  }
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? iso(dt) : null;
}

