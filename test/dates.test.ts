import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserStub } from './helpers.ts';

browserStub();
const store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) };
const { parseDate } = await import('../web/src/dateparse.ts');
const { numericDate, dateOrder } = await import('../web/src/i18n.ts');

test('day-first format: typing and showing', () => {
  store['gm:datefmt'] = JSON.stringify('dmy');
  assert.deepEqual(dateOrder(), ['d', 'm', 'y']);
  assert.equal(numericDate(new Date(2026, 10, 9)), '09/11/2026');
  assert.equal(parseDate('9/11/2026'), '2026-11-09');
  assert.equal(parseDate('09.11.26'), '2026-11-09');
  assert.equal(parseDate('2026-11-09'), '2026-11-09');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('nonsense'), null);
  assert.match(parseDate('9/11')!, /^\d{4}-11-09$/);
});

test('month-first and ISO formats', () => {
  store['gm:datefmt'] = JSON.stringify('mdy');
  assert.equal(numericDate(new Date(2026, 10, 9)), '11/09/2026');
  assert.equal(parseDate('11/9/2026'), '2026-11-09');
  store['gm:datefmt'] = JSON.stringify('ymd');
  assert.equal(numericDate(new Date(2026, 10, 9)), '2026-11-09');
});
