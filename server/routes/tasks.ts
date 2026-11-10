import { loadTasks, saveTask, deleteTasks, saveList, deleteList } from '../tasks.ts';
import { Router } from 'express';
import { auth, wrap } from '../http.ts';

const r = Router();

r.get('/api/tasks', auth, wrap(async (req, res) => {
  res.json(await loadTasks(req.session.account.email));
}));

r.post('/api/tasks', auth, wrap(async (req, res) => {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.today)) ? String(req.body.today) : undefined;
  res.json(await saveTask(req.session.account.email, req.body?.task || {}, today));
}));

r.post('/api/tasks/delete', auth, wrap(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
  res.json({ total: await deleteTasks(req.session.account.email, ids) });
}));

r.post('/api/tasks/lists', auth, wrap(async (req, res) => {
  res.json(await saveList(req.session.account.email, req.body || {}));
}));

r.post('/api/tasks/lists/delete', auth, wrap(async (req, res) => {
  res.json(await deleteList(req.session.account.email, String(req.body?.id || '')));
}));

export default r;
