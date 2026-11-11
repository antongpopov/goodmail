import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSelected, someSelected, toggleAll, toggleGroup } from '../web/src/selection.ts';

const rows = (...u: number[]) => u.map((uid) => ({ uid }));

test('allSelected / someSelected tell none, some and all apart', () => {
  const items = rows(1, 2, 3);
  assert.deepEqual([allSelected(new Set(), items), someSelected(new Set(), items)], [false, false]);
  assert.deepEqual([allSelected(new Set([2]), items), someSelected(new Set([2]), items)], [false, true]);
  assert.deepEqual([allSelected(new Set([1, 2, 3]), items), someSelected(new Set([1, 2, 3]), items)], [true, false]);
  assert.equal(allSelected(new Set(), []), false, 'an empty list is never "all selected"');
});

test('toggleAll selects everything, then clears', () => {
  const items = rows(1, 2, 3);
  const on = toggleAll(new Set([2]), items);
  assert.deepEqual([...on].sort(), [1, 2, 3]);
  assert.equal(toggleAll(on, items).size, 0);
});

test('toggleGroup touches only that group and keeps the rest of the selection', () => {
  const today = rows(1, 2);
  const sel = toggleGroup(new Set([9]), today);
  assert.deepEqual([...sel].sort(), [1, 2, 9]);
  assert.deepEqual([...toggleGroup(sel, today)].sort(), [9], 'a second click removes only that group');
  assert.deepEqual([...toggleGroup(new Set([1]), today)].sort(), [1, 2], 'a half-selected group gets completed first');
});
