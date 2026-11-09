// Per-user writing preferences: a signature per account and a list of templates (canned replies).
// Stored in <data>/prefs/<sha256(login)>.json, so they follow the user to every device.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './vault.ts';

export interface Template { id: string; name: string; subject: string; html: string }
export interface Prefs {
  /** account id ("main" or an extra account's id) → signature HTML. An empty string means "no signature". */
  signatures: Record<string, string>;
  templates: Template[];
  /** Display name of the signed-in (main) account: the name in From and in {name} of the default signature. */
  name: string;
}

const MAX_SIG = 30_000;
const MAX_TPL = 50_000;
const MAX_TEMPLATES = 100;

const file = (login: string) => path.join(DATA, 'prefs', crypto.createHash('sha256').update(login.toLowerCase()).digest('hex') + '.json');
const queues = new Map<string, Promise<unknown>>();
function serial<T>(login: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(login) ?? Promise.resolve()).then(fn, fn);
  queues.set(login, next.catch(() => {}));
  return next;
}

export async function loadPrefs(login: string): Promise<Prefs> {
  try {
    const d = JSON.parse(await fs.readFile(file(login), 'utf8'));
    return { signatures: d.signatures || {}, templates: d.templates || [], name: typeof d.name === 'string' ? d.name : '' };
  } catch {
    return { signatures: {}, templates: [], name: '' };
  }
}

function update(login: string, fn: (p: Prefs) => void) {
  return serial(login, async () => {
    const p = await loadPrefs(login);
    fn(p);
    const f = file(login);
    await fs.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
    const tmp = `${f}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(p), { mode: 0o600 });
    await fs.rename(tmp, f);
    return p;
  });
}

const bad = (m: string) => Object.assign(new Error(m), { status: 400 });

export const setSignature = (login: string, account: string, html: string) => {
  if (!/^[\w-]{1,40}$/.test(account)) throw bad('Unknown account');
  if (html.length > MAX_SIG) throw bad('That signature is too long');
  return update(login, (p) => {
    p.signatures[account] = html;
  });
};

export const setName = (login: string, name: string) => {
  const clean = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);
  return update(login, (p) => {
    p.name = clean;
  });
};

/** The name to show and send as for the signed-in account: the one the user set, else what the server knows. */
export async function nameFor(login: string, fallback: string): Promise<string> {
  return (await loadPrefs(login)).name || fallback || '';
}

export const saveTemplate = (login: string, t: Partial<Template>) => {
  const name = String(t.name || '').trim().slice(0, 80);
  const html = String(t.html || '');
  if (!name) throw bad('Give the template a name');
  if (html.length > MAX_TPL) throw bad('That template is too long');
  return update(login, (p) => {
    const id = t.id && p.templates.some((x) => x.id === t.id) ? t.id : crypto.randomBytes(6).toString('hex');
    const rec = { id, name, subject: String(t.subject || '').slice(0, 200), html };
    const i = p.templates.findIndex((x) => x.id === id);
    if (i >= 0) p.templates[i] = rec;
    else {
      if (p.templates.length >= MAX_TEMPLATES) throw bad(`At most ${MAX_TEMPLATES} templates`);
      p.templates.push(rec);
    }
  });
};

export const deleteTemplate = (login: string, id: string) =>
  update(login, (p) => {
    p.templates = p.templates.filter((t) => t.id !== id);
  });
