// Two-factor sign-in: authenticator app (TOTP, RFC 6238), passkeys (WebAuthn), a code mailed to a backup
// address, and one-time recovery codes. Stored per user in <data>/mfa/<sha256(login)>.json.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA, serverEncrypt, serverDecrypt } from './vault.ts';

export interface StoredPasskey {
  id: string; // base64url credential id
  publicKey: string; // base64url COSE key
  counter: number;
  transports?: string[];
  name: string;
  added: number;
  /** Passwordless sign-in: the user's mail password, encrypted with the server key. Absent = second factor only. */
  login?: string;
}

export interface MfaData {
  totp?: { secret: string; last?: number }; // secret encrypted with the server key; last = last accepted time step
  passkeys: StoredPasskey[];
  email?: string; // verified backup address
  recovery: string[]; // sha256 hashes of unused recovery codes
  /** Verified address for "forgot password" mails. Separate from the mailbox itself, which can't be reached when the password is lost. */
  resetEmail?: string;
}

const DIR = path.join(DATA, 'mfa');
const fileFor = (login: string) => path.join(DIR, crypto.createHash('sha256').update(login.toLowerCase()).digest('hex') + '.json');

const queues = new Map<string, Promise<unknown>>();
function serial<T>(login: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(login) ?? Promise.resolve()).then(fn, fn);
  queues.set(login, next.catch(() => {}));
  return next;
}

export async function loadMfa(login: string): Promise<MfaData> {
  try {
    return { passkeys: [], recovery: [], ...JSON.parse(await fs.readFile(fileFor(login), 'utf8')) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { passkeys: [], recovery: [] };
    throw err;
  }
}

/** Read-modify-write under a per-user lock. */
export function updateMfa(login: string, fn: (d: MfaData) => void | Promise<void>) {
  return serial(login, async () => {
    const d = await loadMfa(login);
    await fn(d);
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
    const file = fileFor(login);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(d), { mode: 0o600 });
    await fs.rename(tmp, file);
    return d;
  });
}

export const mfaEnabled = (d: MfaData) => !!(d.totp || d.passkeys.length || d.email);

export function maskEmail(e: string) {
  const [u, dom] = e.split('@');
  return `${u.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 1)))}@${dom}`;
}

export function publicStatus(d: MfaData) {
  return {
    enabled: mfaEnabled(d),
    totp: !!d.totp,
    passkeys: d.passkeys.map((p) => ({ id: p.id, name: p.name, added: p.added, passwordless: !!p.login })),
    email: d.email || null,
    resetEmail: d.resetEmail || null,
    recoveryLeft: d.recovery.length,
  };
}

// ---------- TOTP ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf: Buffer) {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g)!.map((c) => B32[parseInt(c.padEnd(5, '0'), 2)]).join('');
}
function unbase32(s: string) {
  const bits = s.toUpperCase().replace(/[^A-Z2-7]/g, '').split('').map((c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
function hotp(key: Buffer, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function newTotpSecret() {
  return base32(crypto.randomBytes(20));
}
export function otpauthUri(secret: string, account: string, issuer: string) {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
/** Returns the matched time step (±1 window), or null. `after` rejects replays of an already-used step. */
export function checkTotp(secret: string, code: string, after = -1): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = unbase32(secret);
  const now = Math.floor(Date.now() / 30_000);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= after) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(c))) return step;
  }
  return null;
}
export const sealTotp = (secret: string) => serverEncrypt(secret);
export const openTotp = (stored: string) => serverDecrypt(stored);

// ---------- recovery codes ----------

const hashCode = (c: string) => crypto.createHash('sha256').update(c.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
export function newRecoveryCodes() {
  const plain = Array.from({ length: 10 }, () => {
    const s = base32(crypto.randomBytes(7)).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { plain, hashed: plain.map(hashCode) };
}
/** Consumes the code if valid. */
export function useRecoveryCode(d: MfaData, code: string) {
  const h = hashCode(code);
  const i = d.recovery.indexOf(h);
  if (i < 0) return false;
  d.recovery.splice(i, 1);
  return true;
}

// ---------- short-lived state (memory only) ----------

/** A password-verified login waiting for its second factor. */
export interface Ticket {
  email: string;
  pass: string;
  remember: boolean;
  exp: number;
  attempts: number;
  challenge?: string; // WebAuthn
  emailCode?: string;
  emailCodeExp?: number;
  emailSentAt?: number;
}
const tickets = new Map<string, Ticket>();
export function newTicket(t: Omit<Ticket, 'exp' | 'attempts'>) {
  const id = crypto.randomBytes(24).toString('base64url');
  tickets.set(id, { ...t, exp: Date.now() + 10 * 60_000, attempts: 0 });
  return id;
}
export function getTicket(id: string) {
  const t = tickets.get(id);
  if (!t || t.exp < Date.now()) {
    tickets.delete(id);
    return undefined;
  }
  return t;
}
export const dropTicket = (id: string) => tickets.delete(id);

/** Setup in progress (adding a method), keyed by session id. */
export interface Pending {
  totpSecret?: string;
  challenge?: string;
  emailAddr?: string;
  resetAddr?: string;
  resetCode?: string;
  resetCodeExp?: number;
  emailCode?: string;
  emailCodeExp?: number;
  attempts: number;
}
const pending = new Map<string, Pending>();
export function pendingFor(sessionId: string) {
  let p = pending.get(sessionId);
  if (!p) pending.set(sessionId, (p = { attempts: 0 }));
  return p;
}

export const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const sameCode = (a: string | undefined, b: string) =>
  !!a && a.length === b.trim().length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b.trim()));

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k);
}, 60_000).unref();

// ---------- passwordless passkeys ----------
// A discoverable passkey identifies the user by its credential id, so keep a small id → login index.

const INDEX = path.join(DIR, 'passkey-index.json');
let indexCache: Record<string, string> | null = null;
async function readIndex() {
  if (indexCache) return indexCache;
  try {
    indexCache = JSON.parse(await fs.readFile(INDEX, 'utf8')) as Record<string, string>;
  } catch {
    indexCache = {};
  }
  return indexCache;
}
export function setIndex(credId: string, login: string | null) {
  return serial('\u0000index', async () => {
    const idx = await readIndex();
    if (login) idx[credId] = login.toLowerCase();
    else delete idx[credId];
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
    const tmp = `${INDEX}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(idx), { mode: 0o600 });
    await fs.rename(tmp, INDEX);
  });
}
export async function loginForCredential(credId: string) {
  return (await readIndex())[credId];
}
/** After a normal password sign-in, keep passwordless passkeys working if the password changed. */
export async function refreshPasskeyLogins(login: string, pass: string) {
  const d = await loadMfa(login);
  if (!d.passkeys.some((p) => p.login && serverDecrypt(p.login) !== pass)) return;
  await updateMfa(login, (m) => {
    for (const p of m.passkeys) if (p.login) p.login = serverEncrypt(pass);
  });
}

/** Pending discoverable-login challenges (no user known yet). */
const loginChallenges = new Map<string, { challenge: string; exp: number }>();
export function newLoginChallenge(challenge: string) {
  const id = crypto.randomBytes(18).toString('base64url');
  loginChallenges.set(id, { challenge, exp: Date.now() + 5 * 60_000 });
  return id;
}
export function takeLoginChallenge(id: string) {
  const c = loginChallenges.get(id);
  loginChallenges.delete(id);
  return c && c.exp > Date.now() ? c.challenge : undefined;
}
