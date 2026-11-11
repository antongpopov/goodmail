import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFolder, isStaleView } from '../server/imap.ts';
import type { Conn } from '../server/session.ts';

function fake() {
  const log: string[] = [];
  const client = { mailbox: { uidValidity: 1, exists: 5 }, getMailboxLock: async () => ({ release: () => log.push('unlock') }), noop: async () => void log.push('noop') };
  const conn = { account: { email: 'x@example.com' }, imapIdle: async () => client, releaseIdle: () => log.push('release') } as unknown as Conn;
  return { conn, log };
}
const expunged = Object.assign(new Error('Command failed'), { serverResponseCode: 'EXPUNGEISSUED' });

test('isStaleView recognises the server complaining about expunged messages', () => {
  assert.equal(isStaleView(expunged), true);
  assert.equal(isStaleView(new Error('Some of the requested messages no longer exist')), true);
  assert.equal(isStaleView(new Error('connection reset')), false);
  assert.equal(isStaleView(null), false);
});

test('a read that hits a stale view does one NOOP and runs again', async () => {
  const { conn, log } = fake();
  let n = 0;
  const r = await withFolder(conn, 'INBOX', async () => { if (++n === 1) throw expunged; return 'ok'; }, true);
  assert.deepEqual([r, n, log.filter((l) => l === 'noop').length], ['ok', 2, 1]);
  assert.deepEqual(log.slice(-2), ['unlock', 'release'], 'lock and pool slot are released once');
});

test('only one retry, other errors and anything that changes mail are never retried', async () => {
  let a = 0;
  await assert.rejects(withFolder(fake().conn, 'INBOX', async () => { a++; throw expunged; }, true));
  assert.equal(a, 2);
  let b = 0;
  await assert.rejects(withFolder(fake().conn, 'INBOX', async () => { b++; throw new Error('boom'); }, true));
  assert.equal(b, 1);
  let w = 0;
  await assert.rejects(withFolder(fake().conn, 'INBOX', async () => { w++; throw expunged; }, false));
  assert.equal(w, 1);
});
