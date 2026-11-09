// Tiny i18n: t('English text', { vars }) → translation for the chosen language, falling back to English.
// The English text is the key, so untranslated strings still read fine. Dictionaries live in ./locales.
import { da } from './locales/da.ts';
import { de } from './locales/de.ts';
import { sv } from './locales/sv.ts';
import { nb } from './locales/nb.ts';
import { fr } from './locales/fr.ts';
import { es } from './locales/es.ts';

export type Dict = Record<string, string>;

export const LANGUAGES: { id: string; name: string; dict: Dict }[] = [
  { id: 'en', name: 'English', dict: {} },
  { id: 'da', name: 'Dansk', dict: da },
  { id: 'de', name: 'Deutsch', dict: de },
  { id: 'sv', name: 'Svenska', dict: sv },
  { id: 'nb', name: 'Norsk', dict: nb },
  { id: 'fr', name: 'Français', dict: fr },
  { id: 'es', name: 'Español', dict: es },
];

function detect(): string {
  try {
    const saved = JSON.parse(localStorage.getItem('gm:lang') || 'null');
    if (saved && LANGUAGES.some((l) => l.id === saved)) return saved;
  } catch {
    /* private mode */
  }
  for (const tag of navigator.languages || [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    const id = base === 'no' || base === 'nn' ? 'nb' : base;
    if (LANGUAGES.some((l) => l.id === id)) return id;
  }
  return 'en';
}

let lang = detect();
let dict: Dict = LANGUAGES.find((l) => l.id === lang)!.dict;
document.documentElement.lang = lang;

export const currentLang = () => lang;
/** The app name in the user's language when the server config has a title.<lang> for it, else the default name. */
export const localTitle = (name: string, names?: Record<string, string>) => names?.[lang] || name;
/** Clock preference: 'auto' follows the language/browser, '12' = am/pm, '24' = 24-hour. */
export type Clock = 'auto' | '12' | '24';
export function clockPref(): Clock {
  try {
    const v = JSON.parse(localStorage.getItem('gm:clock') || 'null');
    return v === '12' || v === '24' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function setClock(v: Clock) {
  try {
    localStorage.setItem('gm:clock', JSON.stringify(v));
  } catch {
    /* ignore */
  }
  location.reload();
}
/** Intl options for the chosen clock; merge into any toLocale*String call that shows an hour. */
export const timeOpts = (): Intl.DateTimeFormatOptions => {
  const c = clockPref();
  if (c === '12') return { hour12: true };
  if (c === '24') return { hourCycle: 'h23' };
  // automatic: keep the browser's / language's own clock even when the date order comes from another locale
  return { hour12: !!new Intl.DateTimeFormat(LT(), { hour: 'numeric' }).resolvedOptions().hour12 };
};
/** Date format preference: 'auto' follows the language/browser. */
export type DateFmt = 'auto' | 'dmy' | 'mdy' | 'ymd';
export function dateFmtPref(): DateFmt {
  try {
    const v = JSON.parse(localStorage.getItem('gm:datefmt') || 'null');
    return v === 'dmy' || v === 'mdy' || v === 'ymd' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function setDateFmt(v: DateFmt) {
  try {
    localStorage.setItem('gm:datefmt', JSON.stringify(v));
  } catch {
    /* ignore */
  }
  location.reload();
}
const NUMERIC_LOCALE: Record<Exclude<DateFmt, 'auto'>, string> = { dmy: 'en-GB', mdy: 'en-US', ymd: 'en-CA' };
/** BCP-47 locale for Intl date formatting: the language, and for English the day/month order the user picked. */
export const L = () => {
  if (lang !== 'en') return lang;
  const f = dateFmtPref();
  return f === 'auto' ? navigator.language || 'en' : NUMERIC_LOCALE[f];
};
/** BCP-47 locale for times (the clock setting is applied on top, see timeOpts). */
export const LT = () => (lang === 'en' ? navigator.language || 'en' : lang);
/** "09/11/2026" in the chosen order (any language); format 'auto' uses the language's own. */
export function numericDate(d: Date) {
  const f = dateFmtPref();
  return d.toLocaleDateString(f === 'auto' ? L() : NUMERIC_LOCALE[f], { day: '2-digit', month: '2-digit', year: 'numeric' });
}
/** Order of day / month / year in numericDate(), e.g. ['d','m','y']. */
export function dateOrder(): ('d' | 'm' | 'y')[] {
  const f = dateFmtPref();
  const parts = new Intl.DateTimeFormat(f === 'auto' ? L() : NUMERIC_LOCALE[f], { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(2000, 10, 22));
  return parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => (p.type === 'day' ? 'd' : p.type === 'month' ? 'm' : 'y'));
}

export function setLang(id: string) {
  try {
    localStorage.setItem('gm:lang', JSON.stringify(id));
  } catch {
    /* ignore */
  }
  location.reload(); // simplest way to re-render every string and date
}

export function t(key: string, vars?: Record<string, string | number>) {
  let s = dict[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// Server error messages arrive in English; translate the known ones (with their variable parts).
const ERR_PATTERNS: [RegExp, string][] = [
  [/^This server doesn't handle mail for (.+)$/, "This server doesn't handle mail for {x}"],
  [/^Can't reach the mail server \((.+)\)$/, "Can't reach the mail server ({x})"],
  [/^Can't connect to (.+)$/, "Can't connect to {x}"],
  [/^At most (\d+) extra accounts$/, 'At most {x} extra accounts'],
  [/^The new password needs at least (\d+) characters$/, 'The new password needs at least {x} characters'],
  [/^Can't reach the rules service \((.+)\)$/, "Can't reach the rules service ({x})"],
  [/^That code is not right, or it has expired/, 'That code is not right, or it has expired. Start again.'],
  [/^no (\w+) folder on this server$/, 'There is no {x} folder on this server'],
  [/^Wrong (?:email address|username) or password/, 'Wrong email address or password'],
  [/^The server rejected the email\/password/, 'The server rejected the email/password. Most providers need an app password here, not your normal password.'],
];
export function tErr(msg: string) {
  if (dict[msg]) return dict[msg];
  for (const [re, key] of ERR_PATTERNS) {
    const m = re.exec(msg);
    if (m) return t(key, { x: m[1] });
  }
  return msg;
}

/** Weekday names starting Monday, in the chosen language. */
export function weekdays(style: 'narrow' | 'short' | 'long') {
  const monday = new Date(2024, 0, 1); // a Monday
  return Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(L(), { weekday: style })).map((d) =>
    style === 'narrow' ? d.toUpperCase() : d.replace(/\.$/, ''),
  ).filter(() => monday);
}
