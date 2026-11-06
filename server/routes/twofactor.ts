import type { Request } from 'express';
import { connectImap } from '../session.ts';
import type { Account } from '../session.ts';
import crypto from 'node:crypto';
import { appTitle } from '../config.ts';
import { serverEncrypt, serverDecrypt } from '../vault.ts';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import * as mfa from '../mfa.ts';
import { Conn } from '../session.ts';
import { Router } from 'express';
import { accountFor, auth, wrap } from '../http.ts';
import type { Authed } from '../http.ts';

import { issueLogin } from './auth.ts';
import { throttled } from './auth.ts';
import { attempts } from './auth.ts';
const r = Router();

// ---------- two-factor ----------

/** WebAuthn is bound to the site's host name. Behind a proxy this needs trust proxy + ProxyPreserveHost. */
function rp(req: Request) {
  const origin = process.env.GOODMAIL_ORIGIN || `${req.protocol}://${req.get('host')}`;
  return { origin, rpID: new URL(origin).hostname };
}

/** Mail a 6-digit code from the user's own mailbox (their SMTP) to the given address. */
async function mailCode(account: Account, to: string, code: string, purpose: 'signin' | 'setup') {
  const text =
    purpose === 'signin'
      ? `Your goodmail sign-in code is ${code}\n\nIt is valid for 10 minutes. If you did not try to sign in to ${account.email}, change your mail password.`
      : `Your goodmail confirmation code is ${code}\n\nEnter it to use this address as the backup for signing in to ${account.email}.`;
  await new Conn(account).smtp().sendMail({ from: account.email, to, subject: `goodmail code: ${code}`, text });
}

function ticketFrom(req: Request) {
  const t = mfa.getTicket(String(req.body?.ticket || ''));
  if (!t) throw Object.assign(new Error('Sign-in expired, please start again'), { status: 401 });
  return t;
}

r.post(
  '/api/login/mfa/email',
  wrap(async (req, res) => {
    const t = ticketFrom(req);
    const m = await mfa.loadMfa(t.email);
    if (!m.email) return res.status(400).json({ error: 'No backup email set up' });
    if (t.emailSentAt && Date.now() - t.emailSentAt < 30_000) return res.status(429).json({ error: 'Please wait a moment before requesting another code' });
    const account = await accountFor(t.email, t.pass);
    if (!account) return res.status(401).json({ error: 'Sign-in expired, please start again' });
    t.emailCode = mfa.sixDigits();
    t.emailCodeExp = Date.now() + 10 * 60_000;
    t.emailSentAt = Date.now();
    await mailCode(account, m.email, t.emailCode, 'signin');
    res.json({ ok: true, to: mfa.maskEmail(m.email) });
  }),
);

r.post(
  '/api/login/mfa/passkey-options',
  wrap(async (req, res) => {
    const t = ticketFrom(req);
    const m = await mfa.loadMfa(t.email);
    const opts = await generateAuthenticationOptions({
      rpID: rp(req).rpID,
      allowCredentials: m.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
      userVerification: 'preferred',
    });
    t.challenge = opts.challenge;
    res.json(opts);
  }),
);

r.post(
  '/api/login/mfa',
  wrap(async (req, res) => {
    const id = String(req.body?.ticket || '');
    const t = ticketFrom(req);
    if (++t.attempts > 8) {
      mfa.dropTicket(id);
      return res.status(429).json({ error: 'Too many attempts, please sign in again' });
    }
    const method = String(req.body?.method || '');
    const code = String(req.body?.code || '');
    let ok = false;
    await mfa.updateMfa(t.email, async (m) => {
      if (method === 'totp' && m.totp) {
        const secret = mfa.openTotp(m.totp.secret);
        const step = secret ? mfa.checkTotp(secret, code, m.totp.last ?? -1) : null;
        if (step !== null) {
          m.totp.last = step;
          ok = true;
        }
      } else if (method === 'recovery') {
        ok = mfa.useRecoveryCode(m, code);
      } else if (method === 'email') {
        ok = !!t.emailCodeExp && t.emailCodeExp > Date.now() && mfa.sameCode(t.emailCode, code);
      } else if (method === 'passkey' && t.challenge) {
        const resp = req.body?.response;
        const pk = m.passkeys.find((p) => p.id === resp?.id);
        if (pk) {
          const { origin, rpID } = rp(req);
          const v = await verifyAuthenticationResponse({
            response: resp,
            expectedChallenge: t.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter, transports: pk.transports },
          }).catch(() => ({ verified: false }) as const);
          if (v.verified) {
            pk.counter = v.authenticationInfo.newCounter;
            ok = true;
          }
        }
      }
    });
    if (!ok) return res.status(401).json({ error: method === 'passkey' ? 'Passkey not recognised' : 'That code is not right' });
    mfa.dropTicket(id);
    void mfa.refreshPasskeyLogins(t.email, t.pass).catch(() => {});
    const account = await accountFor(t.email, t.pass);
    if (!account) return res.status(401).json({ error: 'Sign-in expired, please start again' });
    await issueLogin(res, account, t.remember);
  }),
);

// Security settings (signed in). Removing protection needs the mail password again.
function needPassword(req: Authed) {
  const given = Buffer.from(String(req.body?.password || ''));
  const real = Buffer.from(req.session.account.pass);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real))
    throw Object.assign(new Error('Wrong password'), { status: 403 });
}
/** The first method added also creates recovery codes; they are shown once. */
function ensureRecovery(m: mfa.MfaData) {
  if (m.recovery.length) return undefined;
  const r = mfa.newRecoveryCodes();
  m.recovery = r.hashed;
  return r.plain;
}
function afterRemove(m: mfa.MfaData) {
  if (!mfa.mfaEnabled(m)) m.recovery = [];
}

r.get(
  '/api/mfa',
  auth,
  wrap(async (req, res) => {
    res.json(mfa.publicStatus(await mfa.loadMfa(req.session.account.email)));
  }),
);

r.post(
  '/api/mfa/totp/start',
  auth,
  wrap(async (req, res) => {
    const p = mfa.pendingFor(req.session.id);
    p.totpSecret = mfa.newTotpSecret();
    res.json({ secret: p.totpSecret, uri: mfa.otpauthUri(p.totpSecret, req.session.account.email, appTitle()) });
  }),
);

r.post(
  '/api/mfa/totp/confirm',
  auth,
  wrap(async (req, res) => {
    const p = mfa.pendingFor(req.session.id);
    const step = p.totpSecret ? mfa.checkTotp(p.totpSecret, String(req.body?.code || '')) : null;
    if (step === null) return res.status(400).json({ error: 'That code is not right' });
    let recovery: string[] | undefined;
    const m = await mfa.updateMfa(req.session.account.email, (m) => {
      m.totp = { secret: mfa.sealTotp(p.totpSecret!), last: step };
      recovery = ensureRecovery(m);
    });
    p.totpSecret = undefined;
    res.json({ ...mfa.publicStatus(m), recovery });
  }),
);

r.post(
  '/api/mfa/passkey/options',
  auth,
  wrap(async (req, res) => {
    const m = await mfa.loadMfa(req.session.account.email);
    const opts = await generateRegistrationOptions({
      rpName: appTitle(),
      rpID: rp(req).rpID,
      userName: req.session.account.email,
      attestationType: 'none',
      // stable per-user handle so a discoverable passkey maps back to this account
      userID: new Uint8Array(crypto.createHash('sha256').update(req.session.account.email.toLowerCase()).digest()),
      excludeCredentials: m.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: req.body?.passwordless
        ? { residentKey: 'required', userVerification: 'required' }
        : { residentKey: 'preferred', userVerification: 'preferred' },
    });
    mfa.pendingFor(req.session.id).challenge = opts.challenge;
    res.json(opts);
  }),
);

r.post(
  '/api/mfa/passkey/verify',
  auth,
  wrap(async (req, res) => {
    const p = mfa.pendingFor(req.session.id);
    if (!p.challenge) return res.status(400).json({ error: 'Start again' });
    const { origin, rpID } = rp(req);
    const v = await verifyRegistrationResponse({ response: req.body?.response, expectedChallenge: p.challenge, expectedOrigin: origin, expectedRPID: rpID }).catch(
      (e) => {
        throw Object.assign(new Error(`Passkey could not be verified (${e.message})`), { status: 400 });
      },
    );
    p.challenge = undefined;
    if (!v.verified) return res.status(400).json({ error: 'Passkey could not be verified' });
    const c = v.registrationInfo.credential;
    if (req.body?.passwordless) await mfa.setIndex(c.id, req.session.account.email);
    let recovery: string[] | undefined;
    const m = await mfa.updateMfa(req.session.account.email, (m) => {
      m.passkeys = m.passkeys.filter((x) => x.id !== c.id);
      m.passkeys.push({
        id: c.id,
        publicKey: Buffer.from(c.publicKey).toString('base64url'),
        counter: c.counter,
        transports: c.transports,
        name: String(req.body?.name || 'Passkey').slice(0, 60),
        added: Date.now(),
        ...(req.body?.passwordless ? { login: serverEncrypt(req.session.account.pass) } : {}),
      });
      recovery = ensureRecovery(m);
    });
    res.json({ ...mfa.publicStatus(m), recovery });
  }),
);

r.post(
  '/api/mfa/email/start',
  auth,
  wrap(async (req, res) => {
    const to = String(req.body?.address || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (to === req.session.account.email.toLowerCase()) return res.status(400).json({ error: 'Use a different address than this mailbox' });
    const p = mfa.pendingFor(req.session.id);
    p.emailAddr = to;
    p.emailCode = mfa.sixDigits();
    p.emailCodeExp = Date.now() + 10 * 60_000;
    p.attempts = 0;
    await mailCode(req.session.account, to, p.emailCode, 'setup');
    res.json({ ok: true });
  }),
);

r.post(
  '/api/mfa/email/confirm',
  auth,
  wrap(async (req, res) => {
    const p = mfa.pendingFor(req.session.id);
    if (!p.emailAddr || !p.emailCodeExp || p.emailCodeExp < Date.now() || ++p.attempts > 6) return res.status(400).json({ error: 'Start again' });
    if (!mfa.sameCode(p.emailCode, String(req.body?.code || ''))) return res.status(400).json({ error: 'That code is not right' });
    let recovery: string[] | undefined;
    const m = await mfa.updateMfa(req.session.account.email, (m) => {
      m.email = p.emailAddr;
      recovery = ensureRecovery(m);
    });
    p.emailAddr = p.emailCode = undefined;
    res.json({ ...mfa.publicStatus(m), recovery });
  }),
);

r.post(
  '/api/mfa/remove',
  auth,
  wrap(async (req, res) => {
    needPassword(req);
    const what = String(req.body?.what || '');
    const m = await mfa.updateMfa(req.session.account.email, (m) => {
      if (what === 'totp') delete m.totp;
      else if (what === 'email') delete m.email;
      else if (what === 'passkey') m.passkeys = m.passkeys.filter((p) => p.id !== String(req.body?.id || ''));
      afterRemove(m);
    });
    if (what === 'passkey') await mfa.setIndex(String(req.body?.id || ''), null);
    res.json(mfa.publicStatus(m));
  }),
);

r.post(
  '/api/mfa/passkey/passwordless',
  auth,
  wrap(async (req, res) => {
    const id = String(req.body?.id || '');
    const on = !!req.body?.on;
    const m = await mfa.updateMfa(req.session.account.email, (m) => {
      const p = m.passkeys.find((x) => x.id === id);
      if (!p) throw Object.assign(new Error('Passkey not recognised'), { status: 404 });
      if (on) p.login = serverEncrypt(req.session.account.pass);
      else delete p.login;
    });
    await mfa.setIndex(id, on ? req.session.account.email : null);
    res.json(mfa.publicStatus(m));
  }),
);

// Passwordless: the passkey alone (with Face ID / fingerprint / PIN) signs in.
r.post(
  '/api/login/passkey/options',
  wrap(async (req, res) => {
    const opts = await generateAuthenticationOptions({ rpID: rp(req).rpID, userVerification: 'required' });
    res.json({ options: opts, challengeId: mfa.newLoginChallenge(opts.challenge) });
  }),
);

r.post(
  '/api/login/passkey',
  wrap(async (req, res) => {
    if (throttled(req.ip || '?')) return res.status(429).json({ error: 'Too many attempts, try again in 15 minutes' });
    const challenge = mfa.takeLoginChallenge(String(req.body?.challengeId || ''));
    const resp = req.body?.response;
    if (!challenge || !resp?.id) return res.status(401).json({ error: 'Sign-in expired, please start again' });
    const email = await mfa.loginForCredential(resp.id);
    if (!email) return res.status(401).json({ error: 'This passkey is not set up for signing in without a password' });
    let pass: string | undefined;
    const { origin, rpID } = rp(req);
    await mfa.updateMfa(email, async (m) => {
      const pk = m.passkeys.find((p) => p.id === resp.id && p.login);
      if (!pk) return;
      const v = await verifyAuthenticationResponse({
        response: resp,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter, transports: pk.transports },
      }).catch(() => ({ verified: false }) as const);
      if (v.verified) {
        pk.counter = v.authenticationInfo.newCounter;
        pass = serverDecrypt(pk.login!);
      }
    });
    if (!pass) return res.status(401).json({ error: 'Passkey not recognised' });
    const account = await accountFor(email, pass);
    if (!account) return res.status(403).json({ error: `This server doesn't handle mail for ${email.split('@')[1]}` });
    try {
      const c = await connectImap(account);
      await c.logout().catch(() => {});
    } catch (err: any) {
      const msg = err?.authenticationFailed
        ? 'Your mail password has changed. Sign in with your password once, then the passkey works again.'
        : `Can't reach the mail server (${err?.code || err?.message || 'error'})`;
      return res.status(401).json({ error: msg });
    }
    attempts.delete(req.ip || '?');
    await issueLogin(res, account, req.body?.remember !== false);
  }),
);

r.post(
  '/api/mfa/recovery',
  auth,
  wrap(async (req, res) => {
    needPassword(req);
    const r = mfa.newRecoveryCodes();
    const m = await mfa.updateMfa(req.session.account.email, (m) => {
      if (!mfa.mfaEnabled(m)) throw Object.assign(new Error('Set up a sign-in method first'), { status: 400 });
      m.recovery = r.hashed;
    });
    res.json({ ...mfa.publicStatus(m), recovery: r.plain });
  }),
);

export default r;
