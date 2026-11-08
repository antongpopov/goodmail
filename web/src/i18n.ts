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
/** BCP-47 locale for Intl date/number formatting in the chosen language. */
export const L = () => (lang === 'en' ? navigator.language || 'en' : lang);

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
