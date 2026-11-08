// S/MIME (RFC 8551): sign, encrypt, verify and decrypt mail, plus a small certificate authority so every
// user on an install can get a working certificate without buying one.
//
// The cryptography is done by the `openssl cms` command rather than a JavaScript library: that gives real-world
// interoperability (Apple Mail / Outlook mail uses RSA PKCS#1 v1.5 key transport, which Web Crypto and recent Node
// no longer offer). Keys are kept encrypted at rest — user keys under a key derived from the server key AND the
// user's own mail password (like the saved extra accounts), the CA key under the server key — and are written to
// a private temporary directory only for the duration of one openssl call.
import { spawn } from 'node:child_process';
import crypto, { X509Certificate } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { DATA, encryptWith, decryptWith, serverEncrypt, serverDecrypt } from './vault.ts';
import { smimeConfig } from './config.ts';

const BIN = process.env.GOODMAIL_OPENSSL || 'openssl';
const DIR = () => path.join(DATA, 'smime');
const sha = (s: string) => crypto.createHash('sha256').update(s.toLowerCase()).digest('hex');

// ---------- running openssl ----------

interface Ran { code: number; out: Buffer; err: string }

function run(args: string[], o: { input?: Buffer | string; env?: Record<string, string>; cwd?: string } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const p = spawn(BIN, args, { cwd: o.cwd, env: { PATH: process.env.PATH, ...o.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 30_000);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => {
      clearTimeout(timer);
      resolve({ code: 127, out: Buffer.alloc(0), err: 'openssl is not installed' });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out: Buffer.concat(out), err });
    });
    p.stdin.on('error', () => {});
    p.stdin.end(o.input);
  });
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gm-smime-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

let availability: Promise<boolean> | undefined;
/** True when the openssl command exists and has `cms`. */
export function available(): Promise<boolean> {
  availability ??= run(['cms', '-help']).then((r) => r.code !== 127 && /encrypt/.test(r.out.toString() + r.err));
  return availability;
}

const fail = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const saneName = (s: string) => s.replace(/[^\p{L}\p{N} .@_-]/gu, '').trim().slice(0, 64);
const saneEmail = (s: string) => {
  const e = s.trim().toLowerCase();
  if (!/^[a-z0-9._+-]+@[a-z0-9.-]+$/.test(e)) throw fail('That is not a valid email address');
  return e;
};

// ---------- the certificate authority ----------

interface CaFile { cert: string; key: string /* encrypted with the server key */ }
const caFile = () => path.join(DIR(), 'ca.json');

async function atomicWrite(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function loadCa(): Promise<CaFile | undefined> {
  try {
    return JSON.parse(await fs.readFile(caFile(), 'utf8')) as CaFile;
  } catch {
    return undefined;
  }
}

let caCreating: Promise<CaFile> | undefined;
/** The CA, created on first use when `smimeca=auto`. */
export async function ensureCa(): Promise<CaFile | undefined> {
  const cfg = smimeConfig();
  if (!cfg) return undefined;
  const existing = await loadCa();
  if (existing || cfg.ca === 'off') return existing;
  caCreating ??= withTmp(async (d) => {
    const cn = saneName(cfg.caName) || 'goodmail CA';
    await fs.writeFile(
      `${d}/ca.cnf`,
      `[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=v3\n[dn]\nCN=${cn}\n[v3]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n`,
    );
    const r = await run(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-keyout', `${d}/ca.key`, '-out', `${d}/ca.crt`, '-days', '3650', '-sha256', '-config', `${d}/ca.cnf`]);
    if (r.code !== 0) throw fail(`Could not create the certificate authority: ${r.err.split('\n')[0]}`, 500);
    const ca: CaFile = { cert: await fs.readFile(`${d}/ca.crt`, 'utf8'), key: serverEncrypt(await fs.readFile(`${d}/ca.key`, 'utf8')) };
    await atomicWrite(caFile(), JSON.stringify(ca));
    return ca;
  }).finally(() => {
    caCreating = undefined;
  });
  return caCreating;
}

export async function caCertificate() {
  return (await ensureCa())?.cert;
}

// ---------- user certificates ----------

export interface UserCert {
  email: string;
  cert: string; // PEM, leaf
  chain: string[]; // PEMs, intermediates / the CA
  key: string; // PEM private key, encrypted with the user's key
  issuer: 'local' | 'imported';
  added: number;
}
const userFile = (email: string) => path.join(DIR(), 'users', sha(email) + '.json');

export async function loadUserCert(email: string): Promise<UserCert | undefined> {
  try {
    return JSON.parse(await fs.readFile(userFile(email), 'utf8')) as UserCert;
  } catch {
    return undefined;
  }
}
export async function removeUserCert(email: string) {
  await fs.rm(userFile(email), { force: true });
}

export interface CertInfo { emails: string[]; name: string; issuer: string; fingerprint: string; notBefore: string; notAfter: string; expired: boolean }
export function describe(pem: string): CertInfo {
  const x = new X509Certificate(pem);
  const emails = [...(x.subjectAltName || '').matchAll(/email:([^,\s]+)/gi)].map((m) => m[1].toLowerCase());
  const subj = x.subject.split('\n');
  const field = (k: string) => subj.find((l) => l.startsWith(k + '='))?.slice(k.length + 1) || '';
  const e2 = field('emailAddress').toLowerCase();
  if (e2 && !emails.includes(e2)) emails.push(e2);
  const iss = x.issuer.split('\n').find((l) => l.startsWith('CN='))?.slice(3) || x.issuer.replace(/\n/g, ', ');
  return {
    emails,
    name: field('CN'),
    issuer: iss,
    fingerprint: x.fingerprint256,
    notBefore: new Date(x.validFrom).toISOString(),
    notAfter: new Date(x.validTo).toISOString(),
    expired: Date.now() > new Date(x.validTo).getTime(),
  };
}

/** Make a fresh key pair and a certificate for `email`, signed by our CA. */
export async function issue(email: string, name: string, userKey: Buffer): Promise<UserCert> {
  const cfg = smimeConfig();
  const ca = await ensureCa();
  if (!cfg || !ca) throw fail('This server does not issue certificates', 404);
  email = saneEmail(email);
  const cn = saneName(name) || email;
  return withTmp(async (d) => {
    await fs.writeFile(`${d}/ca.crt`, ca.cert);
    await fs.writeFile(`${d}/ca.key`, serverDecrypt(ca.key) || '', { mode: 0o600 });
    await fs.writeFile(`${d}/req.cnf`, `[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=${cn}\nemailAddress=${email}\n`);
    await fs.writeFile(
      `${d}/ext.cnf`,
      `basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=emailProtection\nsubjectAltName=email:${email}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n`,
    );
    let r = await run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${d}/u.key`, '-out', `${d}/u.csr`, '-config', `${d}/req.cnf`, '-sha256']);
    if (r.code !== 0) throw fail(`Could not create a key: ${r.err.split('\n')[0]}`, 500);
    r = await run(['x509', '-req', '-in', `${d}/u.csr`, '-CA', `${d}/ca.crt`, '-CAkey', `${d}/ca.key`, '-set_serial', '0x' + crypto.randomBytes(16).toString('hex'), '-days', String(cfg.days), '-sha256', '-extfile', `${d}/ext.cnf`, '-out', `${d}/u.crt`]);
    if (r.code !== 0) throw fail(`Could not sign the certificate: ${r.err.split('\n')[0]}`, 500);
    const rec: UserCert = {
      email,
      cert: await fs.readFile(`${d}/u.crt`, 'utf8'),
      chain: [ca.cert],
      key: encryptWith(userKey, await fs.readFile(`${d}/u.key`, 'utf8')),
      issuer: 'local',
      added: Date.now(),
    };
    await atomicWrite(userFile(email), JSON.stringify(rec));
    return rec;
  });
}

const pbe = ['-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1'];

/** A .p12 the user can install in Apple Mail / Outlook / Thunderbird. */
export async function exportP12(rec: UserCert, userKey: Buffer, password: string): Promise<Buffer> {
  const key = decryptWith(userKey, rec.key);
  if (!key) throw fail('Please sign in again');
  if (password.length < 6) throw fail('Choose a password of at least 6 characters for the file');
  return withTmp(async (d) => {
    await fs.writeFile(`${d}/k.pem`, key, { mode: 0o600 });
    await fs.writeFile(`${d}/c.pem`, rec.cert);
    await fs.writeFile(`${d}/chain.pem`, rec.chain.join('\n'));
    const env = { GM_P12: password };
    const args = ['pkcs12', '-export', '-inkey', `${d}/k.pem`, '-in', `${d}/c.pem`, '-certfile', `${d}/chain.pem`, '-out', `${d}/o.p12`, '-passout', 'env:GM_P12', '-name', rec.email];
    let r = await run([...args, ...pbe], { env });
    if (r.code !== 0) r = await run(args, { env }); // an openssl without those switches
    if (r.code !== 0) throw fail('Could not create the file', 500);
    return fs.readFile(`${d}/o.p12`);
  });
}

/** Use a certificate the user already has (from a real CA). */
export async function importP12(email: string, p12: Buffer, password: string, userKey: Buffer): Promise<UserCert> {
  email = saneEmail(email);
  return withTmp(async (d) => {
    await fs.writeFile(`${d}/in.p12`, p12);
    const env = { GM_P12: password };
    const extract = async (extra: string[]) => {
      const base = ['pkcs12', '-in', `${d}/in.p12`, '-passin', 'env:GM_P12'];
      let r = await run([...base, ...extra], { env });
      if (r.code !== 0 && /unsupported|legacy|RC2|rc2/i.test(r.err)) r = await run([...base, '-legacy', ...extra], { env });
      return r;
    };
    const k = await extract(['-nocerts', '-nodes']);
    if (k.code !== 0) throw fail(/mac verify|password/i.test(k.err) ? 'Wrong password for that file' : 'That file is not a usable .p12 / .pfx');
    const c = await extract(['-clcerts', '-nokeys']);
    const ch = await extract(['-cacerts', '-nokeys']);
    const pems = (b: Buffer) => b.toString().match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
    const key = k.out.toString().match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/)?.[0];
    const leaf = pems(c.out)[0];
    if (!key || !leaf) throw fail('That file has no certificate with a private key');
    const info = describe(leaf);
    if (!info.emails.includes(email)) throw fail(`That certificate is for ${info.emails.join(', ') || 'another address'}, not ${email}`);
    // the key must belong to the certificate
    await fs.writeFile(`${d}/k.pem`, key, { mode: 0o600 });
    await fs.writeFile(`${d}/c.pem`, leaf);
    const [a, b] = await Promise.all([run(['pkey', '-in', `${d}/k.pem`, '-pubout']), run(['x509', '-in', `${d}/c.pem`, '-noout', '-pubkey'])]);
    if (a.code !== 0 || a.out.toString().trim() !== b.out.toString().trim()) throw fail('The key does not belong to that certificate');
    const rec: UserCert = { email, cert: leaf, chain: pems(ch.out), key: encryptWith(userKey, key), issuer: 'imported', added: Date.now() };
    await atomicWrite(userFile(email), JSON.stringify(rec));
    return rec;
  });
}

// ---------- other people's certificates ----------

const contactsFile = (owner: string) => path.join(DIR(), 'contacts', sha(owner) + '.json');
async function loadContacts(owner: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(contactsFile(owner), 'utf8'));
  } catch {
    return {};
  }
}
/** Remember a correspondent's certificate (harvested from a signed message, or imported by hand). */
export async function rememberCert(owner: string, pem: string) {
  const info = describe(pem);
  if (info.expired || !info.emails.length) return false;
  const all = await loadContacts(owner);
  let changed = false;
  for (const e of info.emails) {
    if (all[e] !== pem) {
      all[e] = pem;
      changed = true;
    }
  }
  if (changed) await atomicWrite(contactsFile(owner), JSON.stringify(all));
  return changed;
}
export async function forgetCert(owner: string, email: string) {
  const all = await loadContacts(owner);
  delete all[email.toLowerCase()];
  await atomicWrite(contactsFile(owner), JSON.stringify(all));
}
export async function listCerts(owner: string) {
  const all = await loadContacts(owner);
  return Object.entries(all).map(([email, pem]) => ({ email, ...describe(pem) }));
}
/** A certificate to encrypt to: one this user saved, else a local user's own public certificate. */
export async function certFor(owner: string, email: string): Promise<string | undefined> {
  const e = email.toLowerCase();
  const saved = (await loadContacts(owner))[e];
  if (saved && !describe(saved).expired) return saved;
  const local = await loadUserCert(e);
  return local && !describe(local.cert).expired ? local.cert : undefined;
}

// ---------- MIME helpers ----------

/** Split a raw message into its header lines (unfolded groups) and body. */
export function splitMessage(raw: Buffer | string): { headers: string[]; body: string } {
  const s = (typeof raw === 'string' ? raw : raw.toString('latin1')).replace(/\r?\n/g, '\r\n');
  const i = s.indexOf('\r\n\r\n');
  const head = i < 0 ? s : s.slice(0, i);
  const body = i < 0 ? '' : s.slice(i + 4);
  const headers: string[] = [];
  for (const line of head.split('\r\n')) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1] += '\r\n' + line;
    else headers.push(line);
  }
  return { headers, body };
}
const isEntityHeader = (h: string) => /^content-/i.test(h);

/** The part that gets signed / encrypted: the Content-* headers and the body. The other headers stay outside. */
function entityOf(raw: Buffer): { outer: string[]; entity: string } {
  const { headers, body } = splitMessage(raw);
  return { outer: headers.filter((h) => !isEntityHeader(h) && !/^mime-version:/i.test(h)), entity: headers.filter(isEntityHeader).join('\r\n') + '\r\n\r\n' + body };
}
const crlf = (b: Buffer) => b.toString('latin1').replace(/\r?\n/g, '\r\n');
const join = (outer: string[], smime: string) => Buffer.from(outer.join('\r\n') + '\r\n' + crlf(Buffer.from(smime, 'latin1')), 'latin1');

// ---------- sign / encrypt ----------

export interface Protect {
  sign?: { rec: UserCert; userKey: Buffer };
  encryptTo?: string[]; // PEM certificates
}

/** Turn a finished message into a signed and/or encrypted one. */
export async function protect(raw: Buffer, o: Protect): Promise<Buffer> {
  if (!(await available())) throw fail('S/MIME needs the openssl command on the server', 501);
  let { outer, entity } = entityOf(raw);
  let last = '';
  if (o.sign) {
    const key = decryptWith(o.sign.userKey, o.sign.rec.key);
    if (!key) throw fail('Please sign in again');
    if (describe(o.sign.rec.cert).expired) throw fail('Your S/MIME certificate has expired');
    last = await withTmp(async (d) => {
      await fs.writeFile(`${d}/in.txt`, entity, 'latin1');
      await fs.writeFile(`${d}/k.pem`, key, { mode: 0o600 });
      await fs.writeFile(`${d}/c.pem`, o.sign!.rec.cert);
      await fs.writeFile(`${d}/chain.pem`, o.sign!.rec.chain.join('\n') || o.sign!.rec.cert);
      const r = await run(['cms', '-sign', '-in', `${d}/in.txt`, '-signer', `${d}/c.pem`, '-inkey', `${d}/k.pem`, '-certfile', `${d}/chain.pem`, '-md', 'sha256', '-outform', 'SMIME', '-out', `${d}/out.eml`]);
      if (r.code !== 0) throw fail(`Signing failed: ${r.err.split('\n')[0]}`, 500);
      return crlf(await fs.readFile(`${d}/out.eml`));
    });
    if (!o.encryptTo?.length) return join(outer, last);
    // sign first, then encrypt the signed entity (without the outer MIME-Version line)
    entity = last.replace(/^MIME-Version:[^\r\n]*\r\n/i, '');
  }
  if (o.encryptTo?.length) {
    const enc = await withTmp(async (d) => {
      await fs.writeFile(`${d}/in.txt`, entity, 'latin1');
      const certs: string[] = [];
      for (const [i, pem] of o.encryptTo!.entries()) {
        await fs.writeFile(`${d}/r${i}.pem`, pem);
        certs.push(`${d}/r${i}.pem`);
      }
      const r = await run(['cms', '-encrypt', '-in', `${d}/in.txt`, '-outform', 'SMIME', '-aes256', '-out', `${d}/out.eml`, ...certs]);
      if (r.code !== 0) throw fail(`Encrypting failed: ${r.err.split('\n')[0]}`, 500);
      return crlf(await fs.readFile(`${d}/out.eml`));
    });
    return join(outer, enc);
  }
  return raw;
}

// ---------- verify / decrypt ----------

export type SignatureStatus = 'ok' | 'untrusted' | 'expired' | 'mismatch' | 'invalid';
export interface Signature {
  status: SignatureStatus;
  signer?: CertInfo;
  pem?: string;
}

async function trustBundle(dir: string): Promise<string> {
  const parts: string[] = [];
  const ca = await loadCa();
  if (ca) parts.push(ca.cert);
  const extra = smimeConfig()?.trust;
  if (extra) parts.push(await fs.readFile(extra, 'utf8').catch(() => ''));
  parts.push(tls.rootCertificates.join('\n'));
  const f = `${dir}/trust.pem`;
  await fs.writeFile(f, parts.join('\n'));
  return f;
}

/** Check a signed message (detached multipart/signed or opaque application/pkcs7-mime). Returns the signed content for opaque ones. */
export async function verify(raw: Buffer, fromAddress?: string): Promise<Signature & { content?: Buffer }> {
  if (!(await available())) return { status: 'invalid' };
  return withTmp(async (d) => {
    await fs.writeFile(`${d}/in.eml`, raw);
    const trust = await trustBundle(d);
    const base = ['cms', '-verify', '-inform', 'SMIME', '-in', `${d}/in.eml`, '-signer', `${d}/signer.pem`, '-out', `${d}/content`];
    let status: SignatureStatus = 'ok';
    let r = await run([...base, '-CAfile', trust, '-no-CApath', '-purpose', 'smimesign']);
    if (r.code !== 0) {
      r = await run([...base, '-CAfile', trust, '-no-CApath', '-purpose', 'smimesign', '-no_check_time']);
      status = 'expired';
    }
    if (r.code !== 0) {
      r = await run([...base, '-noverify']);
      status = 'untrusted';
    }
    if (r.code !== 0) return { status: 'invalid' as const };
    const pem = await fs.readFile(`${d}/signer.pem`, 'utf8').catch(() => '');
    const leaf = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
    if (!leaf) return { status: 'invalid' as const };
    const signer = describe(leaf);
    if (status === 'ok' && fromAddress && !signer.emails.includes(fromAddress.toLowerCase())) status = 'mismatch';
    const content = await fs.readFile(`${d}/content`).catch(() => undefined);
    return { status, signer, pem: leaf, content };
  });
}

/** Decrypt a message with the user's key. Returns the inner MIME entity, or undefined when it isn't addressed to this certificate. */
export async function decrypt(raw: Buffer, rec: UserCert, userKey: Buffer): Promise<Buffer | undefined> {
  if (!(await available())) return undefined;
  const key = decryptWith(userKey, rec.key);
  if (!key) return undefined;
  return withTmp(async (d) => {
    await fs.writeFile(`${d}/in.eml`, raw);
    await fs.writeFile(`${d}/k.pem`, key, { mode: 0o600 });
    await fs.writeFile(`${d}/c.pem`, rec.cert);
    const r = await run(['cms', '-decrypt', '-inform', 'SMIME', '-in', `${d}/in.eml`, '-recip', `${d}/c.pem`, '-inkey', `${d}/k.pem`, '-out', `${d}/inner`]);
    if (r.code !== 0) return undefined;
    return fs.readFile(`${d}/inner`);
  });
}

/** "signed" / "encrypted" / "opaque-signed" for the top-level content type of a message, or null. */
export function kindOf(contentType: string, params: Record<string, string> = {}): 'signed' | 'enveloped' | 'opaque' | null {
  const ct = contentType.toLowerCase();
  if (ct === 'multipart/signed' && /pkcs7-signature/i.test(params.protocol || '')) return 'signed';
  if (ct === 'application/pkcs7-mime' || ct === 'application/x-pkcs7-mime') {
    const t = (params['smime-type'] || '').toLowerCase();
    if (t === 'signed-data') return 'opaque';
    if (t === 'enveloped-data' || !t) return 'enveloped';
  }
  return null;
}

/** The original message's own headers (From, To, Subject …) in front of a decrypted / unwrapped inner entity. */
export function rebuild(raw: Buffer, inner: Buffer): Buffer {
  const { headers } = splitMessage(raw);
  const outer = headers.filter((h) => !isEntityHeader(h) && !/^mime-version:/i.test(h));
  const innerText = inner.toString('latin1');
  const hasHeaders = /^[A-Za-z-]+:/.test(innerText);
  return Buffer.from(outer.join('\r\n') + '\r\nMIME-Version: 1.0\r\n' + (hasHeaders ? '' : 'Content-Type: text/plain\r\n\r\n') + crlf(inner), 'latin1');
}

export const smimeOn = () => !!smimeConfig();
