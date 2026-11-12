import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warmExtras } from '../server/warm.ts';
import type { Conn, Session } from '../server/session.ts';

function extra(name: string, log: string[], fail = false) {
  const client = { mailbox: { uidValidity: 1, exists: 3 }, getMailboxLock: async (f: string) => { log.push(`${name}:${f}`); if (fail) throw new Error('no route'); return { release: () => {} }; } };
  return { account: { email: name }, imapIdle: async () => client, releaseIdle: () => {} } as unknown as Conn;
}

test('warmExtras opens the Inbox of the other mailboxes, one after the other, at most three', async () => {
  const log: string[] = [];
  const s = { extra: new Map([...'abcd'].map((n) => [n, extra(n, log)])) } as unknown as Session;
  await warmExtras(s);
  assert.deepEqual(log, ['a:INBOX', 'b:INBOX', 'c:INBOX']);
});

test('a mailbox that cannot be reached is skipped silently', async () => {
  const log: string[] = [];
  const s = { extra: new Map([['bad', extra('bad', log, true)], ['good', extra('good', log)]]) } as unknown as Session;
  await assert.doesNotReject(warmExtras(s));
  assert.deepEqual(log, ['bad:INBOX', 'good:INBOX']);
});

test('no extra mailboxes: nothing to do', async () => {
  await assert.doesNotReject(warmExtras({ extra: new Map() } as unknown as Session));
});
