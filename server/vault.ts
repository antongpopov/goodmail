// Long-lived login cookies: the credentials themselves, sealed with AES-256-GCM under a
// server-side key. Nothing is stored on disk except that key, and sessions survive restarts.
// Rotating the key (delete data/secret.key or change GOODMAIL_SECRET) signs everyone out.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DATA = path.resolve(process.env.GOODMAIL_DATA || 'data');

function loadKey(): Buffer {
  if (process.env.GOODMAIL_SECRET) return crypto.createHash('sha256').update(process.env.GOODMAIL_SECRET).digest();
  const file = path.join(DATA, 'secret.key');
  try {
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  } catch {
    fs.mkdirSync(DATA, { recursive: true });
    const k = crypto.randomBytes(32);
    fs.writeFileSync(file, k.toString('base64') + '\n', { mode: 0o600 });
    console.log(`vault: generated new key at ${file}`);
    return k;
  }
}

const KEY = loadKey();

export interface Sealed { email: string; pass: string; exp: number }

export function seal(v: Sealed): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

export function unseal(token: string): Sealed | undefined {
  try {
    const buf = Buffer.from(token, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const v = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')) as Sealed;
    return v.exp > Date.now() ? v : undefined;
  } catch {
    return undefined;
  }
}
