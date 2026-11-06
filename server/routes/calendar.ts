import { loadEvents, saveEvent, deleteEvents, importEvents, parseIcs, toIcs } from '../calendar.ts';
import { Router } from 'express';
import { auth, wrap } from '../http.ts';

const r = Router();

// ---------- calendar ----------

r.get(
  '/api/events',
  auth,
  wrap(async (req, res) => {
    res.json(await loadEvents(req.session.account.email));
  }),
);

r.post(
  '/api/events',
  auth,
  wrap(async (req, res) => {
    res.json(await saveEvent(req.session.account.email, req.body || {}));
  }),
);

r.post(
  '/api/events/delete',
  auth,
  wrap(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
    res.json({ total: await deleteEvents(req.session.account.email, ids) });
  }),
);

r.post(
  '/api/events/import',
  auth,
  wrap(async (req, res) => {
    const parsed = parseIcs(String(req.body?.text || ''), String(req.body?.tz || 'UTC'));
    if (!parsed.length) return res.status(400).json({ error: 'No events found in that file' });
    res.json(await importEvents(req.session.account.email, parsed));
  }),
);

r.get(
  '/api/events/export',
  auth,
  wrap(async (req, res) => {
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="calendar-${stamp}.ics"`);
    res.send(toIcs(await loadEvents(req.session.account.email)));
  }),
);

export default r;
