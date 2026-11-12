import type { Request, Response, NextFunction } from 'express';
import { Session, addSession, getSession } from './session.ts';
import { attachAccounts } from './accounts.ts';
import { warmExtras } from './warm.ts';
import type { Account } from './session.ts';
import crypto from 'node:crypto';
import { serversFor } from './config.ts';
import { unseal, userKey } from './vault.ts';
import { Conn } from './session.ts';

export const PORT = Number(process.env.PORT || 3000);
export const PAGE = 50;
export const COOKIE = 'gm_auth';
export const YEAR = 365 * 24 * 3600;
export const SECURE_COOKIE = process.env.GOODMAIL_INSECURE_COOKIE !== 'true' && process.env.NODE_ENV === 'production';

// ---------- helpers ----------

export function cookie(req: Request, name: string) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export type Authed = Request & { session: Session };

/** The mailbox a mail request is about: ?account= / body.account, default the login mailbox. */
export function conn(req: Authed): Conn {
  const id = String((req.method === 'GET' ? req.query.account : req.body?.account) || 'main');
  const c = req.session.acct(id);
  if (!c) throw Object.assign(new Error('That account is no longer available — refresh the page'), { status: 404 });
  return c;
}

export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  // Browsers can't send custom headers cross-site without a CORS preflight we never approve.
  if (req.method !== 'GET' && req.get('x-goodmail') !== '1') return res.status(403).json({ error: 'csrf' });
  next();
}

export const tokenId = (t: string) => crypto.createHash('sha256').update(t).digest('base64url');

export async function accountFor(email: string, pass: string): Promise<Account | undefined> {
  const srv = await serversFor(email);
  if (!srv) return undefined;
  const { login, ...rest } = srv;
  return { email, name: '', user: login === 'local' ? email.split('@')[0] : email, pass, ...rest };
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  const token = cookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: 'not logged in' });
  const id = tokenId(token);
  let s = getSession(id);
  if (!s) {
    // Unknown to this process (restart, or idle-expired): rebuild from the sealed cookie.
    const v = unseal(token);
    const account = v && (await accountFor(v.email, v.pass).catch(() => undefined));
    if (!account) return res.status(401).json({ error: 'not logged in' });
    s = new Session(account, id);
    s.userKey = userKey(v!.email, v!.pass);
    await attachAccounts(s).catch((e) => console.warn('extra accounts:', e.message));
    addSession(s);
    void warmExtras(s); // restart / idle expiry: get the other mailboxes connected before the first click on them
  }
  (req as Authed).session = s;
  next();
}

export const wrap =
  (fn: (req: Authed, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
    fn(req as Authed, res).catch((err: any) => {
      console.error(err);
      if (!res.headersSent)
        res.status(err?.status || 500).json({ error: err?.responseText || err?.message || 'server error' });
    });
