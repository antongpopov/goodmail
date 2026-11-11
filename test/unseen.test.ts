import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folders, noteUnseen } from '../server/imap.ts';
import type { Conn } from '../server/session.ts';

// A fake connection whose STATUS says what `status.unseen` says right now.
function fake(status: { unseen: number }) {
  const mk = () => [
    { path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set(), status: { unseen: 3, messages: 10 } },
    { path: '[Gmail]/Spam', name: 'Spam', delimiter: '/', flags: new Set(), status: { unseen: status.unseen, messages: 4 } },
  ];
  return { account: { email: 'x@example.com' }, imapList: async () => ({ list: async () => mk() }), imap: async () => ({ list: async () => mk() }) } as unknown as Conn;
}
const unseen = async (c: Conn, p: string) => (await folders(c, true)).find((f) => f.path === p)?.status?.unseen;

test('a folder whose unread search finds less than STATUS shows the search result', async () => {
  const st = { unseen: 1 };
  const c = fake(st);
  assert.equal(await unseen(c, '[Gmail]/Spam'), 1);
  noteUnseen(c, '[Gmail]/Spam', 0);
  assert.equal(await unseen(c, '[Gmail]/Spam'), 0, 'corrected right away');
  assert.equal(await unseen(c, '[Gmail]/Spam'), 0, 'and it stays corrected on the next refresh');
  assert.equal(await unseen(c, 'INBOX'), 3, 'other folders are untouched');
  st.unseen = 2; // new mail arrived: STATUS moved on, trust it again
  assert.equal(await unseen(c, '[Gmail]/Spam'), 2);
});

test('agreeing numbers leave nothing to correct', async () => {
  const c = fake({ unseen: 1 });
  await folders(c, true);
  noteUnseen(c, '[Gmail]/Spam', 1);
  assert.equal(await unseen(c, '[Gmail]/Spam'), 1);
});
