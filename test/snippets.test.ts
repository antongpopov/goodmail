import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMessages, fillSnippets, snippetCache } from '../server/imap.ts';
import { throttledHost, type Conn } from '../server/session.ts';
import type { ImapFlow } from 'imapflow';

// A minimal fake IMAP client: the list FETCH returns two plain-text messages, the preview FETCH returns their first bytes.
function fake() {
  const log: string[] = [];
  const msg = (uid: number) => ({ uid, flags: new Set<string>(), size: 10, internalDate: new Date(2026, 0, uid), envelope: { subject: `s${uid}`, from: [{ address: 'a@example.com' }], date: new Date(2026, 0, uid) }, bodyStructure: { type: 'text/plain', part: '1' }, headers: Buffer.from('') });
  const c = {
    mailbox: { uidValidity: 7, exists: 2 },
    fetch(_range: unknown, query: any) {
      const wantsBody = !!query.bodyParts;
      log.push(wantsBody ? 'preview-fetch' : 'list-fetch');
      const items = wantsBody ? [{ uid: 1, bodyParts: new Map([['1', Buffer.from('hello there')]]) }, { uid: 2, bodyParts: new Map([['1', Buffer.from('second one')]]) }] : [msg(1), msg(2)];
      return (async function* () { yield* items; })();
    },
  };
  return { c: c as unknown as ImapFlow, log, s: { account: { email: 'x@example.com', imapHost: 'imap.gmail.com' } } as unknown as Conn };
}

test('only Gmail hosts count as throttled', () => {
  assert.deepEqual(['imap.gmail.com', 'imap.googlemail.com', 'mx.euroteam.com', 'notgmail.com'].map((h) => throttledHost({ imapHost: h })), [true, true, false, false]);
});

test('a lazy list returns at once with snippetPending and no preview fetch; fillSnippets then fetches them in one command', async () => {
  snippetCache.clear();
  const { c, log, s } = fake();
  const list = await listMessages(s, c, 'INBOX', [1, 2], true, true);
  assert.deepEqual(log, ['list-fetch'], 'one command for the list, none for the previews');
  assert.deepEqual(list.map((m) => (m as any).snippetPending), [true, true]);
  assert.deepEqual(list.map((m) => m.snippet), ['', '']);
  const out = await fillSnippets(s, c, 'INBOX', [1, 2]);
  assert.deepEqual(log, ['list-fetch', 'preview-fetch'], 'both previews in a single FETCH');
  assert.deepEqual(out, { 1: 'hello there', 2: 'second one' });
  // listed again: the previews are cached now, nothing is pending and nothing more is fetched
  const again = await listMessages(s, c, 'INBOX', [1, 2], true, true);
  assert.deepEqual(again.map((m) => [m.snippet, (m as any).snippetPending]), [['second one', undefined], ['hello there', undefined]]);
});

test('without lazy, previews are fetched inline exactly as before', async () => {
  snippetCache.clear();
  const { c, log, s } = fake();
  const list = await listMessages(s, c, 'INBOX', [1, 2], true);
  assert.deepEqual(log, ['list-fetch', 'preview-fetch']);
  assert.deepEqual(list.map((m) => (m as any).snippetPending), [undefined, undefined]);
});
