import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.ts';

isolate();
const tk = await import('../server/tasks.ts');

test('normalizeTask: needs a title, trims, defaults to the Tasks list', () => {
  assert.throws(() => tk.normalizeTask({ title: '  ' }), /title/);
  const t = tk.normalizeTask({ title: ' Buy milk ', list: 'nope', due: 'tomorrow', repeat: 'HOURLY' as any });
  assert.equal(t.title, 'Buy milk');
  assert.equal(t.list, 'tasks');
  assert.equal(t.due, '');
  assert.equal(t.repeat, '');
  assert.equal(t.done, false);
});

test('nextDue: month and year ends are clamped', () => {
  assert.equal(tk.nextDue('2026-01-31', 'MONTHLY', '2026-01-01'), '2026-02-28');
  assert.equal(tk.nextDue('2028-02-29', 'YEARLY', '2028-01-01'), '2029-02-28');
  assert.equal(tk.nextDue('2026-12-31', 'DAILY', '2026-01-01'), '2027-01-01');
  assert.equal(tk.nextDue('', 'WEEKLY', '2026-11-10'), '2026-11-17');
});

test('save, list, complete a repeating task, delete a list with its tasks', async () => {
  const acct = 'a@example.com';
  const list = await tk.saveList(acct, { name: 'Work' });
  const { task } = await tk.saveTask(acct, { title: 'Report', list: list.id, due: '2026-11-10', repeat: 'WEEKLY', steps: [{ text: 'draft', done: true } as any] });
  let d = await tk.loadTasks(acct);
  assert.equal(d.tasks.length, 1);
  const r = await tk.saveTask(acct, { ...task, done: true }, '2026-11-10');
  assert.ok(r.task.done && r.task.doneAt > 0);
  assert.equal(r.next?.due, '2026-11-17');
  assert.equal(r.next?.done, false);
  assert.equal(r.next?.steps[0].done, false);
  d = await tk.loadTasks(acct);
  assert.equal(d.tasks.length, 2);
  // re-saving an already completed task does not spawn another occurrence
  await tk.saveTask(acct, { ...r.task, notes: 'x' }, '2026-11-10');
  assert.equal((await tk.loadTasks(acct)).tasks.length, 2);
  d = await tk.deleteList(acct, list.id);
  assert.deepEqual(d.lists, []);
  assert.equal(d.tasks.length, 0);
});
