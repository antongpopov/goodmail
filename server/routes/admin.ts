// Administration of mailboxes and aliases for domain administrators. The configured command (admincmdN=)
// decides who is an administrator and for which domains, on every call; this file only validates the shape
// of the request and passes on the address the user signed in with.
import { Router } from 'express';
import { auth, wrap } from '../http.ts';
import type { Authed } from '../http.ts';
import { serversFor } from '../config.ts';
import { runAdminCommand } from '../admin.ts';
import type { AdminOp } from '../admin.ts';
import { loadMfa, mfaEnabled } from '../mfa.ts';

const r = Router();

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);

async function call(req: Authed, op: AdminOp, args: Record<string, unknown> = {}) {
  const srv = (await serversFor(req.session.account.email)) || undefined;
  if (!srv?.adminCmd) throw Object.assign(new Error('Administration is not set up on this server'), { status: 404 });
  return runAdminCommand(srv.adminCmd, op, req.session.account.email.toLowerCase(), args);
}

r.get('/api/admin/me', auth, wrap(async (req, res) => res.json(await call(req, 'whoami'))));

r.get('/api/admin/domain', auth, wrap(async (req, res) => res.json(await call(req, 'domain.get', { domain: str(req.query.domain) }))));

r.post(
  '/api/admin/mailbox',
  auth,
  wrap(async (req, res) => {
    const b = req.body || {};
    res.json(await call(req, 'mailbox.create', { address: str(b.address), name: str(b.name, 80), password: str(b.password, 200) }));
  }),
);

r.post(
  '/api/admin/mailbox/update',
  auth,
  wrap(async (req, res) => {
    const b = req.body || {};
    const args: Record<string, unknown> = { address: str(b.address) };
    if ('name' in b) args.name = str(b.name, 80) ?? '';
    if ('active' in b) args.active = b.active === true;
    if ('password' in b) args.password = str(b.password, 200) ?? '';
    if ('forwards' in b) {
      args.forwards = (Array.isArray(b.forwards) ? b.forwards : []).slice(0, 60).map((x: unknown) => str(x, 320) ?? '').filter(Boolean);
      args.keep = b.keep !== false;
    }
    res.json(await call(req, 'mailbox.update', args));
  }),
);

r.post(
  '/api/admin/mailbox/delete',
  auth,
  wrap(async (req, res) => res.json(await call(req, 'mailbox.delete', { address: str((req.body || {}).address), files: (req.body || {}).files === true }))),
);

r.post(
  '/api/admin/alias',
  auth,
  wrap(async (req, res) => {
    const b = req.body || {};
    const goto = Array.isArray(b.goto) ? b.goto.map((x: unknown) => str(x, 320) || '').slice(0, 60) : str(b.goto, 4000);
    res.json(await call(req, 'alias.save', { address: str(b.address), goto, active: b.active !== false }));
  }),
);

r.post(
  '/api/admin/alias/delete',
  auth,
  wrap(async (req, res) => res.json(await call(req, 'alias.delete', { address: str((req.body || {}).address) }))),
);

// ---------- main administrator only (the command refuses anyone else) ----------

// For each administrator: has this person set up two-step sign-in in goodmail? (They are asked to, see the warnings.)
r.get(
  '/api/admin/domains',
  auth,
  wrap(async (req, res) => {
    const out = (await call(req, 'domain.list')) as { domains: { admins: { address: string; mfa?: boolean }[] }[] };
    for (const d of out.domains) for (const a of d.admins) a.mfa = mfaEnabled(await loadMfa(a.address));
    res.json(out);
  }),
);

r.post(
  '/api/admin/domain',
  auth,
  wrap(async (req, res) => {
    const b = req.body || {};
    const args: Record<string, unknown> = { domain: str(b.domain) };
    if ('description' in b) args.description = str(b.description, 255) ?? '';
    if ('active' in b) args.active = b.active === true;
    if ('mailboxes' in b) args.mailboxes = Number(b.mailboxes);
    if ('aliases' in b) args.aliases = Number(b.aliases);
    res.json(await call(req, 'domain.save', args));
  }),
);

r.post(
  '/api/admin/domain/delete',
  auth,
  wrap(async (req, res) => res.json(await call(req, 'domain.delete', { domain: str((req.body || {}).domain) }))),
);

r.post(
  '/api/admin/domain/admins',
  auth,
  wrap(async (req, res) => {
    const b = req.body || {};
    const admins = Array.isArray(b.admins) ? b.admins.map((x: unknown) => str(x, 320) || '').slice(0, 40) : str(b.admins, 4000);
    res.json(await call(req, 'admins.set', { domain: str(b.domain), admins }));
  }),
);

export default r;
