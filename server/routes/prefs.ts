import { Router } from 'express';
import { auth, wrap } from '../http.ts';
import { serversFor } from '../config.ts';
import * as prefs from '../prefs.ts';

const r = Router();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The server's default signature for this user's domain, as HTML ({name}, {email} filled in). */
async function defaultSignature(email: string, name: string) {
  const text = (await serversFor(email))?.signature;
  if (!text) return '';
  return esc(text.replace(/\{name\}/g, name || email).replace(/\{email\}/g, email)).replace(/\r?\n/g, '<br>');
}

r.get(
  '/api/prefs',
  auth,
  wrap(async (req, res) => {
    const a = req.session.account;
    res.json({ ...(await prefs.loadPrefs(a.email)), defaultSignature: await defaultSignature(a.email, a.name) });
  }),
);

r.put(
  '/api/prefs/signature',
  auth,
  wrap(async (req, res) => {
    const account = String(req.body?.account || 'main');
    // only the user's own accounts
    if (!req.session.acct(account)) return res.status(404).json({ error: 'That account is no longer available — refresh the page' });
    res.json(await prefs.setSignature(req.session.account.email, account, String(req.body?.html ?? '')));
  }),
);

r.post(
  '/api/prefs/templates',
  auth,
  wrap(async (req, res) => {
    res.json(await prefs.saveTemplate(req.session.account.email, req.body || {}));
  }),
);

r.post(
  '/api/prefs/templates/delete',
  auth,
  wrap(async (req, res) => {
    res.json(await prefs.deleteTemplate(req.session.account.email, String(req.body?.id || '')));
  }),
);

export default r;
