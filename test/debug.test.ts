import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOODMAIL_DEBUG = 'true';
const { debugLog, debugEventsFor, debugReset, imapTracer } = await import('../server/debug.ts');

test('a finished IMAP command becomes one event with its duration and the throttle flag', () => {
  debugReset();
  const trace = imapTracer('me@example.com');
  trace({ cid: 'a', src: 'c', msg: '7 EXAMINE INBOX' });
  trace({ cid: 'a', src: 's', msg: '* 6 EXISTS' }); // untagged lines are ignored
  trace({ cid: 'a', src: 's', msg: '7 OK [READ-ONLY] INBOX selected. (Success) [THROTTLED]' });
  const [e, ...rest] = debugEventsFor({ sid: '', accounts: ['me@example.com'] }, 0);
  assert.equal(rest.length, 0);
  assert.deepEqual([e.src, e.text, e.throttled, e.account], ['imap', 'EXAMINE INBOX → OK', true, 'me@example.com']);
  assert.ok(typeof e.ms === 'number' && e.ms >= 0);
});

test('credentials never reach the log: LOGIN, AUTHENTICATE and its base64 line are skipped', () => {
  debugReset();
  const trace = imapTracer('me@example.com');
  trace({ cid: 'a', src: 'c', msg: '3 LOGIN me@example.com secret-password' });
  trace({ cid: 'a', src: 's', msg: '3 OK Logged in' });
  trace({ cid: 'a', src: 'c', msg: '4 AUTHENTICATE PLAIN' });
  trace({ cid: 'a', src: 'c', msg: 'AGEuZy5wb3BvdkBnbWFpbC5jb20AKCogdmFsdWUgaGlkZGVuICop' });
  trace({ cid: 'a', src: 's', msg: '4 OK Success' });
  trace({ cid: 'a', src: 'c', msg: '5 NOOP', hidden: true });
  assert.deepEqual(debugEventsFor({ sid: '', accounts: ['me@example.com'] }, 0), []);
});

test('a refused command is flagged as an error', () => {
  debugReset();
  const trace = imapTracer('me@example.com');
  trace({ cid: 'a', src: 'c', msg: '9 SELECT Nope' });
  trace({ cid: 'a', src: 's', msg: '9 NO [NONEXISTENT] Unknown Mailbox' });
  assert.equal(debugEventsFor({ sid: '', accounts: ['me@example.com'] }, 0)[0].level, 'error');
});

test('each user sees only their own events, and only the ones newer than `since`', () => {
  debugReset();
  debugLog({ src: 'http', account: '', sid: 'S1', text: 'GET /api/folders' });
  debugLog({ src: 'imap', account: 'a@example.com', sid: '', text: 'LIST' });
  debugLog({ src: 'imap', account: 'b@example.com', sid: '', text: 'LIST' });
  debugLog({ src: 'http', account: '', sid: 'S2', text: 'GET /api/messages' });
  const mine = debugEventsFor({ sid: 'S1', accounts: ['a@example.com'] }, 0);
  assert.deepEqual(mine.map((e) => e.text), ['GET /api/folders', 'LIST']);
  assert.deepEqual(debugEventsFor({ sid: 'S1', accounts: ['a@example.com'] }, mine[0].n).map((e) => e.text), ['LIST']);
  assert.deepEqual(debugEventsFor({ sid: 'nobody', accounts: [] }, 0), []);
});
