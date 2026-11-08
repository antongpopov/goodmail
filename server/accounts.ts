// Extra mail accounts a user adds themselves (iCloud, Gmail, any IMAP server).
// Stored in <data>/accounts/<sha256(login)>.json; passwords are encrypted with a key derived from the
// server key AND the user's own login password, so the file alone is useless.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { DATA, encryptWith, decryptWith, userKey } from './vault.ts';
import { Conn, connectImap } from './session.ts';
import type { Account, Session } from './session.ts';

export interface StoredAccount {
  id: string;
  email: string;
  name: string;
  user: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  provider: string;
  secret: string; // encrypted password
  added: number;
}

export const MAX_ACCOUNTS = 10;
const IMAP_PORTS = new Set([993, 143]);
const SMTP_PORTS = new Set([465, 587, 25, 2525]);
// Development only: lets user-added accounts point at local test servers (any host, any port, self-signed certs).
const ALLOW_PRIVATE = process.env.GOODMAIL_DEV_ANY_HOST === 'true';

const DIR = path.join(DATA, 'accounts');
const fileFor = (login: string) => path.join(DIR, crypto.createHash('sha256').update(login.toLowerCase()).digest('hex') + '.json');

const queues = new Map<string, Promise<unknown>>();
function serial<T>(login: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(login) ?? Promise.resolve()).then(fn, fn);
  queues.set(login, next.catch(() => {}));
  return next;
}

async function load(login: string): Promise<StoredAccount[]> {
  try {
    return JSON.parse(await fs.readFile(fileFor(login), 'utf8')) as StoredAccount[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function store(login: string, list: StoredAccount[]) {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  const file = fileFor(login);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list), { mode: 0o600 });
  await fs.rename(tmp, file);
}

function isPrivate(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Refuse anything that isn't a public mail server, so the feature can't be used to probe the host's own network. */
async function checkHost(host: string, port: number, ports: Set<number>, what: string) {
  if (!/^[a-z0-9.-]+$/i.test(host) || host.length > 253) throw Object.assign(new Error(`${what} server name looks wrong`), { status: 400 });
  if (!ALLOW_PRIVATE && !ports.has(port)) throw Object.assign(new Error(`${what} port must be one of ${[...ports].join(', ')}`), { status: 400 });
  if (ALLOW_PRIVATE) return;
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw Object.assign(new Error(`Can't find the ${what} server ${host}`), { status: 400 });
  }
  if (!addrs.length || addrs.some((a) => isPrivate(a.address)))
    throw Object.assign(new Error(`${what} server ${host} is on a private network`), { status: 400 });
}

const toAccount = (a: StoredAccount, pass: string): Account => ({
  email: a.email,
  name: a.name,
  user: a.user,
  pass,
  imapHost: a.imapHost,
  imapPort: a.imapPort,
  imapSecure: a.imapSecure,
  smtpHost: a.smtpHost,
  smtpPort: a.smtpPort,
  smtpSecure: a.smtpSecure,
  insecureTls: ALLOW_PRIVATE,
});

export const publicView = (a: StoredAccount, locked: boolean) => ({
  id: a.id,
  email: a.email,
  name: a.name,
  provider: a.provider,
  imapHost: a.imapHost,
  locked,
});

/** Attach the user's saved accounts to a session (on login or when rebuilt from the cookie). */
export async function attachAccounts(s: Session) {
  if (!s.userKey) return;
  const list = await load(s.account.email);
  const ids = new Set(list.map((a) => a.id));
  for (const id of [...s.extra.keys()]) if (!ids.has(id)) s.extra.delete(id); // removed on another device
  for (const a of list) {
    const pass = decryptWith(s.userKey, a.secret);
    if (pass !== undefined && !s.extra.has(a.id)) s.extra.set(a.id, new Conn(toAccount(a, pass)));
  }
}

export async function listAccounts(s: Session) {
  await attachAccounts(s); // pick up accounts added on another device
  return (await load(s.account.email)).map((a) => publicView(a, !s.extra.has(a.id)));
}

export async function addAccount(s: Session, body: Record<string, unknown>) {
  if (!s.userKey) throw Object.assign(new Error('Please sign in again to add accounts'), { status: 401 });
  const email = String(body.email || '').trim().toLowerCase();
  const pass = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !pass) throw Object.assign(new Error('Email address and password are required'), { status: 400 });
  if (email === s.account.email.toLowerCase()) throw Object.assign(new Error('That is the account you are signed in with'), { status: 400 });
  const imapPort = Number(body.imapPort) || 993;
  const smtpPort = Number(body.smtpPort) || 465;
  const imapHost = String(body.imapHost || '').trim().toLowerCase();
  const smtpHost = String(body.smtpHost || imapHost).trim().toLowerCase();
  await checkHost(imapHost, imapPort, IMAP_PORTS, 'IMAP');
  await checkHost(smtpHost, smtpPort, SMTP_PORTS, 'SMTP');
  const id = String(body.id || '') || crypto.randomBytes(6).toString('hex');
  const stored: StoredAccount = {
    id,
    email,
    name: String(body.name || '').trim().slice(0, 100),
    user: String(body.user || email).trim(),
    imapHost,
    imapPort,
    imapSecure: imapPort === 993,
    smtpHost,
    smtpPort,
    smtpSecure: smtpPort === 465,
    provider: String(body.provider || 'imap').slice(0, 20),
    secret: encryptWith(s.userKey, pass),
    added: Date.now(),
  };
  const account = toAccount(stored, pass);
  // Prove the credentials work before saving anything.
  try {
    const c = await connectImap(account);
    await c.logout().catch(() => {});
  } catch (err: any) {
    const msg = err?.authenticationFailed
      ? 'The server rejected the email/password. Most providers need an app password here, not your normal password.'
      : `Can't connect to ${imapHost}:${imapPort} (${err?.code || err?.message || 'error'})`;
    throw Object.assign(new Error(msg), { status: 400 });
  }
  await serial(s.account.email, async () => {
    const list = await load(s.account.email);
    const i = list.findIndex((a) => a.id === id || a.email === email);
    if (i < 0 && list.length >= MAX_ACCOUNTS) throw Object.assign(new Error(`At most ${MAX_ACCOUNTS} extra accounts`), { status: 400 });
    if (i >= 0) {
      stored.id = list[i].id;
      list[i] = stored;
    } else list.push(stored);
    await store(s.account.email, list);
  });
  await s.extra.get(stored.id)?.closeImap();
  s.extra.set(stored.id, new Conn(account));
  return publicView(stored, false);
}

export async function removeAccount(s: Session, id: string) {
  await serial(s.account.email, async () => {
    await store(s.account.email, (await load(s.account.email)).filter((a) => a.id !== id));
  });
  await s.extra.get(id)?.closeImap();
  s.extra.delete(id);
}

/**
 * After the user changed their sign-in password, saved accounts can't be decrypted with the new key.
 * Given the PREVIOUS password, re-encrypt every locked account under the current key and unlock it.
 */
export async function unlockWithOldPassword(s: Session, oldPassword: string) {
  if (!s.userKey) throw Object.assign(new Error('Please sign in again to add accounts'), { status: 401 });
  const oldKey = userKey(s.account.email, oldPassword);
  let unlocked = 0;
  await serial(s.account.email, async () => {
    const list = await load(s.account.email);
    for (const a of list) {
      if (decryptWith(s.userKey!, a.secret) !== undefined) continue; // already readable
      const pass = decryptWith(oldKey, a.secret);
      if (pass === undefined) continue;
      a.secret = encryptWith(s.userKey!, pass);
      s.extra.set(a.id, new Conn(toAccount(a, pass)));
      unlocked++;
    }
    if (unlocked) await store(s.account.email, list);
  });
  if (!unlocked) throw Object.assign(new Error('That password did not unlock any account'), { status: 400 });
  return unlocked;
}

/** After a password change: move the saved accounts from the old key to the key of the new password. */
export async function rekeyAccounts(login: string, oldPass: string, newPass: string) {
  const oldKey = userKey(login, oldPass);
  const newKey = userKey(login, newPass);
  await serial(login, async () => {
    const list = await load(login);
    let changed = false;
    for (const a of list) {
      const pass = decryptWith(oldKey, a.secret);
      if (pass === undefined) continue;
      a.secret = encryptWith(newKey, pass);
      changed = true;
    }
    if (changed) await store(login, list);
  });
}
