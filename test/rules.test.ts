import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, toSieve, fromSieve } from '../server/rules.ts';

const rule = (over: any = {}) => ({
  id: 'a1', name: 'Newsletters', enabled: true, match: 'all',
  conditions: [{ field: 'from', op: 'contains', value: 'news@example.com' }],
  actions: [{ type: 'move', value: 'Newsletters' }], ...over,
});

test('a move rule compiles to fileinto', () => {
  const s = toSieve(normalizeRules([rule()]));
  assert.match(s, /require \["fileinto", "mailbox"\];/);
  assert.match(s, /if header :contains "From" "news@example\.com" \{/);
  assert.match(s, /fileinto :create "Newsletters";/);
});

test('rules round-trip through the marker comment', () => {
  const rules = normalizeRules([rule(), rule({ id: 'b2', name: 'Boss', conditions: [{ field: 'subject', op: 'is', value: 'Hi' }], actions: [{ type: 'flag' }, { type: 'read' }] })]);
  assert.deepEqual(fromSieve(toSieve(rules)), rules);
});

test('scripts we did not write are not parsed', () => {
  assert.equal(fromSieve('require "fileinto";\nfileinto "X";'), null);
});

test('quotes, backslashes and wildcards are escaped', () => {
  const s = toSieve(normalizeRules([rule({ conditions: [{ field: 'subject', op: 'begins', value: 'a "q" \\ * ?' }] })]));
  assert.ok(s.includes('"a \\"q\\" \\\\\\\\ \\\\* \\\\?*"'), s);
  assert.match(s, /:matches/);
});

test('any / all, not-contains and several headers', () => {
  const s = toSieve(normalizeRules([rule({ match: 'any', conditions: [{ field: 'recipient', op: 'contains', value: 'x' }, { field: 'list', op: 'not-contains', value: 'y' }] })]));
  assert.match(s, /anyof \(header :contains \["To", "Cc"\] "x", not header :contains "List-Id" "y"\)/);
});

test('flags ride on fileinto/keep, forward is a copy, discard stops', () => {
  const a = toSieve(normalizeRules([rule({ actions: [{ type: 'read' }, { type: 'move', value: 'A' }] })]));
  assert.match(a, /fileinto :create :flags \["\\\\Seen"\] "A";/);
  assert.match(a, /"imap4flags"/);
  const b = toSieve(normalizeRules([rule({ actions: [{ type: 'forward', value: 'Me@Example.com' }] })]));
  assert.match(b, /redirect :copy "me@example\.com";/);
  assert.match(b, /"copy"/);
  const c = toSieve(normalizeRules([rule({ actions: [{ type: 'discard' }] })]));
  assert.match(c, /discard;\r\n  stop;/);
});

test('disabled rules stay in the model but not in the script', () => {
  const rules = normalizeRules([rule({ enabled: false })]);
  const s = toSieve(rules);
  assert.ok(!s.includes('fileinto'));
  assert.equal(fromSieve(s)![0].enabled, false);
});

test('bad input is refused with a readable message', () => {
  assert.throws(() => normalizeRules([rule({ conditions: [] })]), /at least one condition/);
  assert.throws(() => normalizeRules([rule({ actions: [] })]), /at least one action/);
  assert.throws(() => normalizeRules([rule({ actions: [{ type: 'move' }] })]), /choose a folder/);
  assert.throws(() => normalizeRules([rule({ actions: [{ type: 'forward', value: 'nope' }] })]), /valid address/);
  assert.throws(() => normalizeRules([rule({ conditions: [{ field: 'header', header: 'X Bad', op: 'is', value: 'v' }] })]), /header name/);
  assert.throws(() => normalizeRules('x'), /list/);
});

test('control characters cannot break out of a string or comment', () => {
  const s = toSieve(normalizeRules([rule({ name: 'x\r\nfileinto "evil";', conditions: [{ field: 'subject', op: 'is', value: 'a\r\nb' }] })]));
  assert.ok(!/^fileinto "evil"/m.test(s));
  assert.ok(!/a\r\nb/.test(s));
});
