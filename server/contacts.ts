// Per-account address book: one JSON file per mailbox in <data>/contacts/, plus vCard / CSV conversion.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './vault.ts';

export interface Contact {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  company: string;
  notes: string;
  updated: number;
}

const DIR = path.join(DATA, 'contacts');
const fileFor = (account: string) =>
  path.join(DIR, crypto.createHash('sha256').update(account.toLowerCase()).digest('hex') + '.json');

// Serialize writes per account so concurrent edits can't clobber each other.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(account) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(account, next.catch(() => {}));
  return next;
}

export async function loadContacts(account: string): Promise<Contact[]> {
  try {
    return JSON.parse(await fs.readFile(fileFor(account), 'utf8')) as Contact[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function store(account: string, list: Contact[]) {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  const file = fileFor(account);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list), { mode: 0o600 });
  await fs.rename(tmp, file);
}

const clean = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
const cleanList = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : [v]).map((x) => clean(x, 320)).filter(Boolean))].slice(0, 20);

export function normalize(c: Partial<Contact>): Contact {
  return {
    id: clean(c.id, 64) || crypto.randomUUID(),
    name: clean(c.name, 200),
    emails: cleanList(c.emails).map((e) => e.toLowerCase()),
    phones: cleanList(c.phones),
    company: clean(c.company, 200),
    notes: clean(c.notes, 5000),
    updated: Date.now(),
  };
}

const sortKey = (c: Contact) => (c.name || c.emails[0] || '').toLowerCase();
const sorted = (l: Contact[]) => l.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

export const saveContact = (account: string, input: Partial<Contact>) =>
  serial(account, async () => {
    const list = await loadContacts(account);
    const c = normalize(input);
    if (!c.name && !c.emails.length) throw Object.assign(new Error('A contact needs a name or an email address'), { status: 400 });
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = c;
    else list.push(c);
    await store(account, sorted(list));
    return c;
  });

export const deleteContacts = (account: string, ids: string[]) =>
  serial(account, async () => {
    const drop = new Set(ids);
    const list = (await loadContacts(account)).filter((c) => !drop.has(c.id));
    await store(account, list);
    return list.length;
  });

/** Add imported contacts, merging into existing ones that share an email address. */
export const importContacts = (account: string, incoming: Partial<Contact>[]) =>
  serial(account, async () => {
    const list = await loadContacts(account);
    const byEmail = new Map<string, Contact>();
    for (const c of list) for (const e of c.emails) byEmail.set(e, c);
    let added = 0;
    let merged = 0;
    for (const raw of incoming) {
      const c = normalize({ ...raw, id: undefined });
      if (!c.name && !c.emails.length) continue;
      const existing = c.emails.map((e) => byEmail.get(e)).find(Boolean);
      if (existing) {
        existing.name ||= c.name;
        existing.company ||= c.company;
        existing.notes ||= c.notes;
        existing.emails = [...new Set([...existing.emails, ...c.emails])];
        existing.phones = [...new Set([...existing.phones, ...c.phones])];
        existing.updated = Date.now();
        merged++;
      } else {
        list.push(c);
        added++;
      }
      const target = existing ?? c;
      for (const e of c.emails) byEmail.set(e, target);
    }
    if (list.length > 20000) throw Object.assign(new Error('Address book is limited to 20,000 contacts'), { status: 400 });
    await store(account, sorted(list));
    return { added, merged, total: list.length };
  });

// ---------------- vCard ----------------

function unescapeV(s: string) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
function escapeV(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

function decodeValue(value: string, params: string) {
  if (/ENCODING=(QUOTED-PRINTABLE|Q)\b/i.test(params)) {
    const bytes = Buffer.from(
      value.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
      'latin1',
    );
    const cs = /CHARSET=([^;:]+)/i.exec(params)?.[1] || 'utf-8';
    try {
      return new TextDecoder(cs).decode(bytes);
    } catch {
      return bytes.toString('utf8');
    }
  }
  return value;
}

export function parseVCard(text: string): Partial<Contact>[] {
  // Unfold continuation lines (RFC 6350 §3.2) and QP soft line breaks.
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').replace(/=\n/g, '').split('\n');
  const out: Partial<Contact>[] = [];
  let cur: { fn: string; n: string; emails: string[]; phones: string[]; org: string; note: string } | null = null;
  for (const line of lines) {
    const m = /^(?:[\w-]+\.)?([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const prop = m[1].toUpperCase();
    const params = m[2];
    const value = decodeValue(m[3], params);
    if (prop === 'BEGIN' && /^vcard$/i.test(value)) cur = { fn: '', n: '', emails: [], phones: [], org: '', note: '' };
    else if (prop === 'END' && cur) {
      const [last = '', first = '', middle = ''] = cur.n.split(/(?<!\\);/).map(unescapeV);
      const name = cur.fn || [first, middle, last].filter(Boolean).join(' ');
      out.push({ name, emails: cur.emails, phones: cur.phones, company: cur.org, notes: cur.note });
      cur = null;
    } else if (cur) {
      if (prop === 'FN') cur.fn = unescapeV(value).trim();
      else if (prop === 'N') cur.n = value;
      else if (prop === 'EMAIL') cur.emails.push(unescapeV(value).replace(/^mailto:/i, '').trim());
      else if (prop === 'TEL') cur.phones.push(unescapeV(value).replace(/^tel:/i, '').trim());
      else if (prop === 'ORG') cur.org = unescapeV(value.split(/(?<!\\);/)[0]).trim();
      else if (prop === 'NOTE') cur.note = unescapeV(value).trim();
    }
  }
  return out;
}

export function toVCard(list: Contact[]) {
  const fold = (l: string) => {
    const parts: string[] = [];
    let rest = l;
    while (Buffer.byteLength(rest) > 75) {
      let cut = 74;
      while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
      parts.push(rest.slice(0, cut));
      rest = ' ' + rest.slice(cut);
    }
    parts.push(rest);
    return parts.join('\r\n');
  };
  return list
    .map((c) => {
      const words = c.name.split(/\s+/).filter(Boolean);
      const last = words.length > 1 ? words[words.length - 1] : '';
      const first = words.length > 1 ? words.slice(0, -1).join(' ') : words[0] || '';
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${escapeV(c.name || c.emails[0] || '')}`,
        `N:${escapeV(last)};${escapeV(first)};;;`,
        ...c.emails.map((e, i) => `EMAIL;TYPE=INTERNET${i === 0 ? ',PREF' : ''}:${e}`),
        ...c.phones.map((p) => `TEL;TYPE=VOICE:${escapeV(p)}`),
        ...(c.company ? [`ORG:${escapeV(c.company)}`] : []),
        ...(c.notes ? [`NOTE:${escapeV(c.notes)}`] : []),
        `UID:${c.id}`,
        'END:VCARD',
      ];
      return lines.map(fold).join('\r\n');
    })
    .join('\r\n') + '\r\n';
}

// ---------------- CSV ----------------

function parseCsvRows(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  // Pick the delimiter that appears most in the header line (Excel in DK/DE exports with ';').
  const head = t.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** Understands Google, Outlook, Apple/Thunderbird-style headers and our own export. */
export function parseCsv(text: string): Partial<Contact>[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const idx = (re: RegExp) => h.map((x, i) => (re.test(x) ? i : -1)).filter((i) => i >= 0);
  const nameI = idx(/^(name|full name|display name|navn|vollständiger name)$/);
  const firstI = idx(/^(first name|given name|fornavn|vorname)$/);
  const middleI = idx(/^(middle name|additional name)$/);
  const lastI = idx(/^(last name|family name|surname|efternavn|nachname)$/);
  const emailI = idx(/e-?mail(?!.*(type|label|display))/);
  const phoneI = idx(/(phone|mobile|telefon|tlf)(?!.*(type|label))/);
  const orgI = idx(/^(company|organization|organisation|organization 1 - name|organization name|firma|virksomhed)$/);
  const noteI = idx(/^(notes?|noter|notizen)$/);
  const get = (r: string[], is: number[]) => is.map((i) => (r[i] || '').trim()).filter(Boolean);
  return rows.slice(1).map((r) => {
    const name = get(r, nameI)[0] || [get(r, firstI)[0], get(r, middleI)[0], get(r, lastI)[0]].filter(Boolean).join(' ');
    return {
      name,
      // Google packs several addresses into one cell separated by " ::: "
      emails: get(r, emailI).flatMap((e) => e.split(/\s*:::\s*|\s*;\s*/)).filter((e) => e.includes('@')),
      phones: get(r, phoneI).flatMap((p) => p.split(/\s*:::\s*/)),
      company: get(r, orgI)[0] || '',
      notes: get(r, noteI)[0] || '',
    };
  });
}

export function toCsv(list: Contact[]) {
  const q = (v: string) => (/[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const maxE = Math.max(1, ...list.map((c) => c.emails.length));
  const maxP = Math.max(1, ...list.map((c) => c.phones.length));
  const head = ['Name', ...Array.from({ length: maxE }, (_, i) => `E-mail ${i + 1}`), ...Array.from({ length: maxP }, (_, i) => `Phone ${i + 1}`), 'Company', 'Notes'];
  const rows = list.map((c) => [
    c.name,
    ...Array.from({ length: maxE }, (_, i) => c.emails[i] || ''),
    ...Array.from({ length: maxP }, (_, i) => c.phones[i] || ''),
    c.company,
    c.notes,
  ]);
  return '\uFEFF' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
