import { listAccounts, addAccount, renameAccount, removeAccount, unlockWithOldPassword } from '../accounts.ts';
import { guessSettings } from '../autoconfig.ts';
import { Router } from 'express';
import { nameFor } from '../prefs.ts';
import { auth, wrap } from '../http.ts';

const r = Router();

// ---------- extra accounts (user-managed) ----------

r.get(
  '/api/accounts',
  auth,
  wrap(async (req, res) => {
    const a = req.session.account;
    res.json([{ id: 'main', email: a.email, name: await nameFor(a.email, a.name), provider: 'main', imapHost: a.imapHost, locked: false }, ...(await listAccounts(req.session))]);
  }),
);

r.post(
  '/api/accounts',
  auth,
  wrap(async (req, res) => {
    res.json(await addAccount(req.session, req.body || {}));
  }),
);

r.post(
  '/api/accounts/rename',
  auth,
  wrap(async (req, res) => {
    res.json(await renameAccount(req.session, String(req.body?.id || ''), String(req.body?.name ?? '')));
  }),
);

r.post(
  '/api/accounts/delete',
  auth,
  wrap(async (req, res) => {
    await removeAccount(req.session, String(req.body?.id || ''));
    res.json({ ok: true });
  }),
);

r.post(
  '/api/accounts/unlock',
  auth,
  wrap(async (req, res) => {
    res.json({ unlocked: await unlockWithOldPassword(req.session, String(req.body?.oldPassword || '')) });
  }),
);

r.post(
  '/api/accounts/guess',
  auth,
  wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid email' });
    res.json(await guessSettings(email, { skipDomainAutoconfig: true }));
  }),
);

export default r;
