// Mail rules (ManageSieve) and password change — both only when the domain's config turns them on.
import crypto from 'node:crypto';
import { Router } from 'express';
import { auth, wrap, cookie, COOKIE } from '../http.ts';
import type { Authed } from '../http.ts';
import { serversFor, resetSender } from '../config.ts';
import type { ServerSettings } from '../config.ts';
import { withSieve } from '../managesieve.ts';
import type { SieveOptions } from '../managesieve.ts';
import { SCRIPT_NAME, normalizeRules, toSieve, fromSieve } from '../rules.ts';
import { runPasswordCommand, checkNewPassword } from '../password.ts';
import { connectImap, dropSession } from '../session.ts';
import { rekeyAccounts } from '../accounts.ts';
import { unseal } from '../vault.ts';
import * as mfa from '../mfa.ts';
import { issueLogin } from './auth.ts';

const r = Router();

const srvFor = async (req: Authed): Promise<ServerSettings> => (await serversFor(req.session.account.email)) || ({} as ServerSettings);

function sieveOpts(req: Authed, srv: ServerSettings): SieveOptions {
  const a = req.session.account;
  if (!srv.sieveHost) throw Object.assign(new Error('Mail rules are not set up on this server'), { status: 404 });
  return { host: srv.sieveHost, port: srv.sievePort || 4190, user: a.user, pass: a.pass, insecureTls: srv.insecureTls, ca: srv.ca };
}

/** Run a ManageSieve session and turn connection trouble into a readable 502. */
async function sieve<T>(req: Authed, fn: Parameters<typeof withSieve<T>>[1]) {
  const srv = await srvFor(req);
  try {
    return await withSieve(sieveOpts(req, srv), fn);
  } catch (e: any) {
    if (e.status) throw e;
    if (e.sieve) throw Object.assign(new Error(`The mail server rejected the rules: ${e.message}`), { status: 400 });
    console.warn('managesieve:', e?.message || e);
    throw Object.assign(new Error(e?.auth ? e.message : `Can't reach the rules service (${e?.code || e?.message || 'error'})`), { status: 502 });
  }
}

r.get(
  '/api/features',
  auth,
  wrap(async (req, res) => {
    const srv = await srvFor(req);
    res.json({ rules: !!srv.sieveHost, password: !!srv.passwordCmd, passwordMin: srv.passwordMin || 10, reset: !!resetSender() && !!srv.passwordCmd });
  }),
);

// ---------- rules ----------

r.get(
  '/api/rules',
  auth,
  wrap(async (req, res) => {
    const out = await sieve(req, async (s) => {
      const scripts = await s.list();
      const mine = scripts.find((x) => x.name === SCRIPT_NAME);
      const text = mine ? await s.get(SCRIPT_NAME) : undefined;
      const parsed = text === undefined ? null : fromSieve(text);
      const other = scripts.find((x) => x.active && x.name !== SCRIPT_NAME);
      // "foreign" = something we did not write is (or would be) in the way
      const foreign = !!other || (!!mine && text !== undefined && text.trim() !== '' && parsed === null);
      return { rules: parsed ?? [], foreign, active: scripts.find((x) => x.active)?.name || null };
    });
    res.json(out);
  }),
);

r.put(
  '/api/rules',
  auth,
  wrap(async (req, res) => {
    const rules = normalizeRules(req.body?.rules);
    const script = toSieve(rules);
    const replace = req.body?.replace === true;
    await sieve(req, async (s) => {
      const scripts = await s.list();
      const mine = scripts.find((x) => x.name === SCRIPT_NAME);
      const text = mine ? await s.get(SCRIPT_NAME) : undefined;
      const mineIsOurs = text === undefined || text.trim() === '' || fromSieve(text) !== null;
      const other = scripts.find((x) => x.active && x.name !== SCRIPT_NAME);
      if ((other || !mineIsOurs) && !replace) throw Object.assign(new Error('Another mail filter is in use for this mailbox'), { status: 409 });
      await s.check(script);
      if (!mineIsOurs && text) await s.put('goodmail-previous', text).catch(() => {}); // keep the hand-written one
      await s.put(SCRIPT_NAME, script);
      await s.activate(SCRIPT_NAME);
    });
    res.json({ ok: true });
  }),
);

// ---------- password ----------

const wrong = new Map<string, { n: number; t: number }>();

r.post(
  '/api/password',
  auth,
  wrap(async (req, res) => {
    const sess = req.session;
    const a = sess.account;
    const srv = await srvFor(req);
    if (!srv.passwordCmd) return res.status(404).json({ error: 'Changing the password here is not set up on this server' });
    const cur = String(req.body?.current || '');
    const next = String(req.body?.next || '');
    const w = wrong.get(sess.id);
    if (w && Date.now() - w.t < 15 * 60_000 && w.n >= 5) return res.status(429).json({ error: 'Too many attempts, try again in 15 minutes' });
    const given = Buffer.from(cur);
    const real = Buffer.from(a.pass);
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
      wrong.set(sess.id, { n: (w && Date.now() - w.t < 15 * 60_000 ? w.n : 0) + 1, t: w && Date.now() - w.t < 15 * 60_000 ? w.t : Date.now() });
      return res.status(403).json({ error: 'Wrong password' });
    }
    wrong.delete(sess.id);
    const bad = checkNewPassword(cur, next, srv.passwordMin || 10);
    if (bad) return res.status(400).json({ error: bad });

    await runPasswordCommand(srv.passwordCmd, { login: a.email, user: a.user, old: cur, next });

    // Prove the new password works before we trust it, then carry everything over to it.
    const account = { ...a, pass: next };
    try {
      const c = await connectImap(account);
      await c.logout().catch(() => {});
    } catch {
      return res.status(502).json({ error: 'The password was changed, but signing in with it failed. Please sign in again.' });
    }
    await rekeyAccounts(a.email, cur, next).catch((e) => console.warn('rekey:', e.message));
    await mfa.refreshPasskeyLogins(a.email, next).catch((e) => console.warn('passkeys:', e.message));
    const token = cookie(req, COOKIE);
    const remember = (unseal(token || '')?.exp ?? 0) - Date.now() > 13 * 3600_000;
    await dropSession(sess.id);
    await issueLogin(res, account, remember);
  }),
);

export default r;
