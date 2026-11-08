import type { Response } from 'express';
import type { ImapFlow } from 'imapflow';
import { Session, addSession, dropSession, connectImap } from '../session.ts';
import { attachAccounts } from '../accounts.ts';
import type { Account } from '../session.ts';
import { appTitle, appTitles, titleFor, titlesFor, normalizeLogin, resetSender } from '../config.ts';
import { seal, userKey } from '../vault.ts';
import * as mfa from '../mfa.ts';
import { Router } from 'express';
import { COOKIE, YEAR, SECURE_COOKIE, cookie, tokenId, accountFor, auth, wrap } from '../http.ts';
import type { Authed } from '../http.ts';

const r = Router();

// ---------- auth ----------

export const attempts = new Map<string, { n: number; t: number }>();
export function throttled(ip: string) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.t > 15 * 60_000) {
    attempts.set(ip, { n: 1, t: now });
    return false;
  }
  a.n++;
  return a.n > 10;
}

r.get('/api/config', (_req, res) => {
  res.json({ appName: appTitle(), appNames: appTitles(), reset: !!resetSender(), source: process.env.GOODMAIL_SOURCE_URL || 'https://github.com/antongpopov/goodmail' });
});

r.post(
  '/api/login',
  wrap(async (req, res) => {
    if (throttled(req.ip || '?')) return res.status(429).json({ error: 'Too many attempts, try again in 15 minutes' });
    const b = req.body || {};
    const email = normalizeLogin(String(b.email || ''));
    const pass = String(b.password || '');
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !pass) return res.status(400).json({ error: 'Enter your email address and password' });
    const account = await accountFor(email, pass);
    if (!account) return res.status(403).json({ error: `This server doesn't handle mail for ${email.split('@')[1]}` });
    let client: ImapFlow;
    try {
      client = await connectImap(account);
    } catch (err: any) {
      console.warn(`login failed for ${email} at ${account.imapHost}:${account.imapPort}:`, err?.responseText || err?.message);
      const msg = err?.authenticationFailed ? 'Wrong email address or password' : `Can't reach the mail server (${err?.code || err?.message || 'error'})`;
      return res.status(401).json({ error: msg });
    }
    await client.logout().catch(() => {});
    attempts.delete(req.ip || '?');
    const remember = b.remember !== false;
    // Password is right. With 2FA set up, hand out a short-lived ticket instead of the session cookie.
    const m = await mfa.loadMfa(email);
    if (mfa.mfaEnabled(m)) {
      const ticket = mfa.newTicket({ email, pass, remember });
      return res.json({
        mfa: { ticket, totp: !!m.totp, passkey: m.passkeys.length > 0, email: m.email ? mfa.maskEmail(m.email) : null, recovery: m.recovery.length > 0 },
      });
    }
    void mfa.refreshPasskeyLogins(email, pass).catch(() => {});
    await issueLogin(res, account, remember);
  }),
);

export async function issueLogin(res: Response, account: Account, remember: boolean) {
  const token = seal({ email: account.email, pass: account.pass, exp: Date.now() + (remember ? YEAR : 12 * 3600) * 1000 });
  const sess = new Session(account, tokenId(token));
  sess.userKey = userKey(account.email, account.pass);
  await attachAccounts(sess).catch((e) => console.warn('extra accounts:', e.message));
  addSession(sess);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${remember ? `; Max-Age=${YEAR}` : ''}${SECURE_COOKIE ? '; Secure' : ''}`,
  );
  res.json({ email: account.email, name: account.name, imapHost: account.imapHost, appName: titleFor(account.email), appNames: titlesFor(account.email) });
}

r.post('/api/logout', async (req, res) => {
  const token = cookie(req, COOKIE);
  if (token) await dropSession(tokenId(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

r.get('/api/me', auth, (req, res) => {
  const a = (req as Authed).session.account;
  res.json({ email: a.email, name: a.name, imapHost: a.imapHost, appName: titleFor(a.email), appNames: titlesFor(a.email) });
});

export default r;
