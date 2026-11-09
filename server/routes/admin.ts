// Administration of mailboxes and aliases for domain administrators. The configured command (admincmdN=)
// decides who is an administrator and for which domains, on every call; this file only validates the shape
// of the request and passes on the address the user signed in with.
import { Router } from 'express';
import { auth, wrap } from '../http.ts';
import type { Authed } from '../http.ts';
import { serversFor } from '../config.ts';
import { runAdminCommand } from '../admin.ts';
import type { AdminOp } from '../admin.ts';

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
    res.json(await call(req, 'mailbox.update', args));
  }),
);

r.post(
  '/api/admin/mailbox/delete',
  auth,
  wrap(async (req, res) => res.json(await call(req, 'mailbox.delete', { address: str((req.body || {}).address) }))),
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

export default r;
