import { loadContacts, saveContact, deleteContacts, importContacts, parseVCard, parseCsv, toVCard, toCsv } from '../contacts.ts';
import { Router } from 'express';
import { auth, wrap } from '../http.ts';

const r = Router();

// ---------- address book ----------

r.get(
  '/api/contacts',
  auth,
  wrap(async (req, res) => {
    res.json(await loadContacts(req.session.account.email));
  }),
);

r.post(
  '/api/contacts',
  auth,
  wrap(async (req, res) => {
    res.json(await saveContact(req.session.account.email, req.body || {}));
  }),
);

r.post(
  '/api/contacts/delete',
  auth,
  wrap(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
    res.json({ total: await deleteContacts(req.session.account.email, ids) });
  }),
);

r.post(
  '/api/contacts/import',
  auth,
  wrap(async (req, res) => {
    const text = String(req.body?.text || '');
    const isVcf = req.body?.format === 'vcf' || /BEGIN:VCARD/i.test(text.slice(0, 2000));
    const parsed = isVcf ? parseVCard(text) : parseCsv(text);
    if (!parsed.length) return res.status(400).json({ error: 'No contacts found in that file' });
    res.json(await importContacts(req.session.account.email, parsed));
  }),
);

r.get(
  '/api/contacts/export',
  auth,
  wrap(async (req, res) => {
    const list = await loadContacts(req.session.account.email);
    const csv = req.query.format === 'csv';
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', csv ? 'text/csv; charset=utf-8' : 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${stamp}.${csv ? 'csv' : 'vcf'}"`);
    res.send(csv ? toCsv(list) : toVCard(list));
  }),
);

export default r;
