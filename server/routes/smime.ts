// S/MIME settings: your certificate, the CA certificate, correspondents' certificates.
import crypto from 'node:crypto';
import { Router } from 'express';
import { auth, wrap } from '../http.ts';
import type { Authed } from '../http.ts';
import { smimeConfig } from '../config.ts';
import * as sm from '../smime.ts';

const r = Router();

function needPassword(req: Authed) {
  const given = Buffer.from(String(req.body?.password || ''));
  const real = Buffer.from(req.session.account.pass);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) throw Object.assign(new Error('Wrong password'), { status: 403 });
}
const userKey = (req: Authed) => {
  if (!req.session.userKey) throw Object.assign(new Error('Please sign in again'), { status: 401 });
  return req.session.userKey;
};
const view = (rec: sm.UserCert | undefined) => (rec ? { ...sm.describe(rec.cert), kind: rec.issuer, added: rec.added } : null);

r.get(
  '/api/smime',
  auth,
  wrap(async (req, res) => {
    const cfg = smimeConfig();
    if (!cfg) return res.json({ enabled: false });
    const rec = await sm.loadUserCert(req.session.account.email);
    const ca = cfg.ca === 'auto' ? await sm.caCertificate() : undefined;
    res.json({
      enabled: true,
      available: await sm.available(),
      canIssue: cfg.ca === 'auto',
      cert: view(rec),
      ca: ca ? sm.describe(ca) : null,
      contacts: await sm.listCerts(req.session.account.email),
    });
  }),
);

/** The CA certificate, public: correspondents download it to trust mail from this install. */
r.get(
  '/api/smime/ca.crt',
  wrap(async (_req, res) => {
    const ca = smimeConfig() && (await sm.caCertificate());
    if (!ca) return res.status(404).json({ error: 'not found' });
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="mail-ca.crt"');
    res.send(ca);
  }),
);

r.post(
  '/api/smime/enable',
  auth,
  wrap(async (req, res) => {
    if (!smimeConfig()) return res.status(404).json({ error: 'S/MIME is not turned on on this server' });
    if (!(await sm.available())) return res.status(501).json({ error: 'S/MIME needs the openssl command on the server' });
    const a = req.session.account;
    if (await sm.loadUserCert(a.email)) return res.status(409).json({ error: 'You already have a certificate' });
    res.json(view(await sm.issue(a.email, a.name || a.email, userKey(req))));
  }),
);

r.post(
  '/api/smime/import',
  auth,
  wrap(async (req, res) => {
    if (!smimeConfig()) return res.status(404).json({ error: 'S/MIME is not turned on on this server' });
    const p12 = Buffer.from(String(req.body?.file || ''), 'base64');
    if (!p12.length || p12.length > 200_000) return res.status(400).json({ error: 'Choose a .p12 or .pfx file' });
    res.json(view(await sm.importP12(req.session.account.email, p12, String(req.body?.filePassword || ''), userKey(req))));
  }),
);

r.post(
  '/api/smime/export',
  auth,
  wrap(async (req, res) => {
    needPassword(req);
    const rec = await sm.loadUserCert(req.session.account.email);
    if (!rec) return res.status(404).json({ error: 'You have no certificate yet' });
    const p12 = await sm.exportP12(rec, userKey(req), String(req.body?.filePassword || ''));
    res.setHeader('Content-Type', 'application/x-pkcs12');
    res.setHeader('Content-Disposition', 'attachment; filename="mail-certificate.p12"');
    res.send(p12);
  }),
);

r.post(
  '/api/smime/remove',
  auth,
  wrap(async (req, res) => {
    needPassword(req);
    await sm.removeUserCert(req.session.account.email);
    res.json({ ok: true });
  }),
);

// correspondents' certificates (to encrypt to them)
r.post(
  '/api/smime/certs',
  auth,
  wrap(async (req, res) => {
    const text = Buffer.from(String(req.body?.file || ''), 'base64').toString('latin1');
    const pem = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
    if (!pem) return res.status(400).json({ error: 'Choose a certificate file in PEM format (.pem, .crt or .cer)' });
    const added = await sm.rememberCert(req.session.account.email, pem);
    res.json({ added, contacts: await sm.listCerts(req.session.account.email) });
  }),
);

r.post(
  '/api/smime/certs/delete',
  auth,
  wrap(async (req, res) => {
    await sm.forgetCert(req.session.account.email, String(req.body?.email || ''));
    res.json({ contacts: await sm.listCerts(req.session.account.email) });
  }),
);

/** Which of these addresses can we encrypt to? */
r.post(
  '/api/smime/lookup',
  auth,
  wrap(async (req, res) => {
    const list: string[] = (Array.isArray(req.body?.addresses) ? req.body.addresses : []).map((a: unknown) => String(a).toLowerCase()).slice(0, 50);
    const out: Record<string, boolean> = {};
    for (const a of list) out[a] = !!(await sm.certFor(req.session.account.email, a));
    res.json({ can: out, mine: !!(await sm.loadUserCert(req.session.account.email)) });
  }),
);

export default r;
