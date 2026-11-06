import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.ts';

isolate();
const { spamInfo, parseHeaderLines } = await import('../server/spam.ts');

test('parseHeaderLines: lowercases keys, keeps order, unfolds continuation lines, tolerates empty input', () => {
  const lines = parseHeaderLines(Buffer.from('X-Spamd-Result: default: False [1.20 / 15.00];\r\n   BAYES_HAM(-3.00)[99%];\r\nX-Spam-Status: No, score=0.1\r\n\r\n'));
  assert.deepEqual(lines.map((l) => l.key), ['x-spamd-result', 'x-spam-status']);
  assert.match(lines[0].line, /\[1\.20 \/ 15\.00\];\s+BAYES_HAM/);
  assert.deepEqual(parseHeaderLines(undefined), []);
  assert.deepEqual(parseHeaderLines(''), []);
});

test('spamInfo reads rspamd score and reject threshold', () => {
  const s = spamInfo(parseHeaderLines('X-Spamd-Result: default: False [9.10 / 15.00];\r\n'))!;
  assert.equal(s.engine, 'rspamd');
  assert.equal(s.score, 9.1);
  assert.equal(s.reject, 15);
  assert.equal(s.threshold, 6); // rspamd default when the config sets none
});

test('spamInfo reads negative rspamd scores and SpamAssassin headers', () => {
  assert.equal(spamInfo(parseHeaderLines('X-Spamd-Result: default: False [-3.50 / 15.00];'))!.score, -3.5);
  const sa = spamInfo(parseHeaderLines('X-Spam-Status: No, score=1.7 required=5.0 tests=A,B autolearn=ham'))!;
  assert.equal(sa.engine, 'spamassassin');
  assert.equal(sa.score, 1.7);
  assert.equal(sa.threshold, 5);
});

test('spamInfo: the TOPMOST header wins (a forged one lower down is ignored); no headers -> null', () => {
  const s = spamInfo(parseHeaderLines('X-Spamd-Result: default: False [2.00 / 15.00];\r\nX-Spamd-Result: default: False [-99.00 / 15.00];\r\n'))!;
  assert.equal(s.score, 2);
  assert.equal(spamInfo([]), null);
  assert.equal(spamInfo(parseHeaderLines('X-Spam-Status: garbage')), null);
});
