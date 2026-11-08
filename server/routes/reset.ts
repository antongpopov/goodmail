// "Forgot password": a code goes to a second address the user saved earlier (never the mailbox itself —
// that is exactly what they can't open), then a new password is set through the same command as a normal change.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { Router } from 'express';
import { auth, wrap } from '../http.ts';
import { appTitle, normalizeLogin, resetSender, serversFor, titleFor } from '../config.ts';
import * as mfa from '../mfa.ts';
import { Conn } from '../session.ts';
import { checkNewPassword, runPasswordCommand } from '../password.ts';
import { accountFor } from '../http.ts';

const r = Router();

const CODE_TTL = 15 * 60_000;
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const addrOk = (a: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a);

async function send(to: string, subject: string, text: string) {
  const s = resetSender();
  if (!s) throw new Error('reset mail is not configured');
  const t = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    requireTLS: !s.secure,
    auth: s.pass ? { user: s.user, pass: s.pass } : undefined,
    tls: { rejectUnauthorized: !s.insecureTls },
  });
  await t.sendMail({ from: s.from, to, subject, text });
}

/** Is "forgot password" usable for this address: configured sender and a password command for its domain. */
async function offered(email: string) {
  return !!resetSender() && !!(await serversFor(email))?.passwordCmd;
}

// ---------- saving the reset address (signed in) ----------

r.post(
  '/api/mfa/reset-email/start',
  auth,
  wrap(async (req, res) => {
    const a = req.session.account;
    if (!(await offered(a.email))) return res.status(404).json({ error: 'Password reset is not set up on this server' });
    const to = String(req.body?.address || '').trim().toLowerCase();
    if (!addrOk(to)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (to === a.email.toLowerCase()) return res.status(400).json({ error: 'Use a different address than this mailbox' });
    const p = mfa.pendingFor(req.session.id);
    p.resetAddr = to;
    p.resetCode = mfa.sixDigits();
    p.resetCodeExp = Date.now() + 10 * 60_000;
    p.attempts = 0;
    // from the user's own mailbox, like the other setup codes: proves the address is reachable
    await new Conn(a).smtp().sendMail({
      from: a.email,
      to,
      subject: `${appTitle()} code: ${p.resetCode}`,
      text: `Your confirmation code is ${p.resetCode}\n\nEnter it to use this address for resetting the password of ${a.email}. It is valid for 10 minutes.`,
    });
    res.json({ ok: true });
  }),
);

r.post(
  '/api/mfa/reset-email/confirm',
  auth,
  wrap(async (req, res) => {
    const p = mfa.pendingFor(req.session.id);
    if (!p.resetAddr || !p.resetCodeExp || p.resetCodeExp < Date.now() || ++p.attempts > 6) return res.status(400).json({ error: 'Start again' });
    if (!mfa.sameCode(p.resetCode, String(req.body?.code || ''))) return res.status(400).json({ error: 'That code is not right' });
    const m = await mfa.updateMfa(req.session.account.email, (m) => {
      m.resetEmail = p.resetAddr;
    });
    p.resetAddr = p.resetCode = undefined;
    res.json(mfa.publicStatus(m));
  }),
);

r.post(
  '/api/mfa/reset-email/remove',
  auth,
  wrap(async (req, res) => {
    const given = Buffer.from(String(req.body?.password || ''));
    const real = Buffer.from(req.session.account.pass);
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) return res.status(403).json({ error: 'Wrong password' });
    const m = await mfa.updateMfa(req.session.account.email, (m) => {
      delete m.resetEmail;
    });
    res.json(mfa.publicStatus(m));
  }),
);

// ---------- forgot password (signed out) ----------

interface Reset {
  email: string;
  codeHash: string | null; // null: nothing was sent (unknown user) — the ticket still looks the same
  exp: number;
  tries: number;
}
const resets = new Map<string, Reset>();
const byIp = new Map<string, number[]>();
const byAddr = new Map<string, number[]>();
const hitLimit = (m: Map<string, number[]>, key: string, max: number, windowMs: number) => {
  const now = Date.now();
  const l = (m.get(key) || []).filter((t) => now - t < windowMs);
  l.push(now);
  m.set(key, l);
  return l.length > max;
};
const hash = (code: string) => crypto.createHash('sha256').update(code.trim()).digest('hex');

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of resets) if (v.exp < now) resets.delete(k);
}, 60_000).unref();

r.post(
  '/api/reset/start',
  wrap(async (req, res) => {
    const email = normalizeLogin(String(req.body?.email || ''), req.hostname);
    if (!addrOk(email)) return res.status(400).json({ error: 'Enter your email address' });
    if (hitLimit(byIp, req.ip || '?', 8, 60 * 60_000) || hitLimit(byAddr, email, 3, 60 * 60_000))
      return res.status(429).json({ error: 'Too many attempts, try again later' });
    // Same answer whether or not this address can be reset, so the form can't be used to find out who has a mailbox here.
    const ticket = crypto.randomBytes(18).toString('base64url');
    const entry: Reset = { email, codeHash: null, exp: Date.now() + CODE_TTL, tries: 0 };
    resets.set(ticket, entry);
    res.json({ ticket });
    try {
      if (!(await offered(email))) return;
      const m = await mfa.loadMfa(email);
      if (!m.resetEmail) return;
      const code = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
      entry.codeHash = hash(code);
      await send(
        m.resetEmail,
        `${titleFor(email)}: password reset code`,
        `Someone asked to reset the password of ${email}.\n\nYour code is ${code}\n\nIt is valid for 15 minutes. If this was not you, ignore this message — nothing changes without the code.`,
      );
    } catch (e: any) {
      entry.codeHash = null;
      console.warn('reset mail:', e?.message || e);
    }
  }),
);

r.post(
  '/api/reset/finish',
  wrap(async (req, res) => {
    const e = resets.get(String(req.body?.ticket || ''));
    const bad = () => res.status(400).json({ error: 'That code is not right, or it has expired. Start again.' });
    if (!e || e.exp < Date.now() || ++e.tries > 5) {
      if (e) resets.delete(String(req.body?.ticket));
      return bad();
    }
    const code = String(req.body?.code || '').replace(/\s/g, '');
    if (!e.codeHash || !same(hash(code), e.codeHash)) return bad();
    const srv = await serversFor(e.email);
    if (!srv?.passwordCmd) return bad();
    const next = String(req.body?.next || '');
    const problem = checkNewPassword('', next, srv.passwordMin || 10);
    if (problem) return res.status(400).json({ error: problem }); // ticket stays valid so they can try another password
    const account = await accountFor(e.email, next);
    if (!account) return bad();
    resets.delete(String(req.body?.ticket));
    await runPasswordCommand(srv.passwordCmd, { login: e.email, user: account.user, old: '', next, reset: true });
    // Tell the mailbox owner, in case this was not them.
    send(e.email, `${titleFor(e.email)}: your password was reset`, `The password of ${e.email} was just reset using the reset address saved in your account.\n\nIf this was not you, contact your administrator right away.`).catch(() => {});
    res.json({ ok: true });
  }),
);

export default r;
