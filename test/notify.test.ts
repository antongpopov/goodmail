import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxCounts, totalUnseen, newMail } from '../web/src/notify.ts';
import type { Folder } from '../web/src/api.ts';

const f = (path: string, unseen: number, total: number, specialUse = ''): Folder => ({ path, name: path, delimiter: '/', specialUse, unseen, total });

test('inboxCounts finds each mailbox\'s Inbox by special use or by name, and totalUnseen adds them up', () => {
  const c = inboxCounts({ main: [f('Sent', 0, 9), f('INBOX', 2, 15, '\\Inbox')], gm: [f('INBOX', 1, 6), f('[Gmail]/Spam', 5, 30)], empty: [f('Drafts', 0, 0)] });
  assert.deepEqual(c, { main: { unseen: 2, total: 15 }, gm: { unseen: 1, total: 6 } });
  assert.equal(totalUnseen(c), 3);
});

test('new mail = more messages AND more unread; reading, marking unread by hand and deleting are not new mail', () => {
  const was = { main: { unseen: 2, total: 15 }, gm: { unseen: 1, total: 6 } };
  assert.deepEqual(newMail(was, { main: { unseen: 3, total: 16 }, gm: { unseen: 1, total: 6 } }), { n: 1, ids: ['main'] });
  assert.deepEqual(newMail(was, { main: { unseen: 1, total: 15 }, gm: { unseen: 1, total: 6 } }).n, 0, 'read one');
  assert.deepEqual(newMail(was, { main: { unseen: 3, total: 15 }, gm: { unseen: 1, total: 6 } }).n, 0, 'marked one unread by hand');
  assert.deepEqual(newMail(was, { main: { unseen: 2, total: 14 }, gm: { unseen: 1, total: 6 } }).n, 0, 'deleted one');
  assert.deepEqual(newMail(was, { main: { unseen: 4, total: 15 }, gm: { unseen: 3, total: 8 } }), { n: 2, ids: ['gm'] }, 'counts only what really arrived');
});

test('a mailbox is quiet on the first look and when it was added later; two mailboxes add up', () => {
  const now = { main: { unseen: 3, total: 16 } };
  assert.equal(newMail(null, now).n, 0, 'first load');
  assert.equal(newMail({}, now).n, 0, 'mailbox not seen before');
  const both = newMail({ main: { unseen: 1, total: 10 }, gm: { unseen: 0, total: 5 } }, { main: { unseen: 2, total: 11 }, gm: { unseen: 2, total: 7 } });
  assert.deepEqual(both, { n: 3, ids: ['main', 'gm'] });
});
