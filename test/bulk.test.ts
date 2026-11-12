import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkCriteria, peopleCriteria } from '../server/bulk.ts';

test('bulk mail is recognised by list headers and automated sender names', () => {
  const j = JSON.stringify(bulkCriteria);
  for (const h of ['List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted']) assert.match(j, new RegExp(h));
  for (const f of ['noreply', 'no-reply', 'notification']) assert.match(j, new RegExp(`"from":"${f}"`));
});

test('"from people" is exactly the opposite search', () => {
  assert.deepEqual(peopleCriteria, { not: bulkCriteria });
});
