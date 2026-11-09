import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.ts';

isolate();
const prefs = await import('../server/prefs.ts');
const U = 'user@example.com';

test('signatures are stored per account and can be emptied on purpose', async () => {
  assert.deepEqual(await prefs.loadPrefs(U), { signatures: {}, templates: [], name: '' });
  await prefs.setSignature(U, 'main', '<b>Anton</b>');
  const p = await prefs.setSignature(U, 'abc123', '');
  assert.deepEqual(p.signatures, { main: '<b>Anton</b>', abc123: '' });
  await assert.rejects(async () => prefs.setSignature(U, '../x', 'x'), /Unknown account/);
  await assert.rejects(async () => prefs.setSignature(U, 'main', 'x'.repeat(40_000)), /too long/);
});

test('templates: create, update in place, delete, validation', async () => {
  const a = await prefs.saveTemplate(U, { name: 'Opening hours', subject: 'Hours', html: '<p>Mon–Fri 9–17</p>' });
  assert.equal(a.templates.length, 1);
  const id = a.templates[0].id;
  const b = await prefs.saveTemplate(U, { id, name: 'Opening hours v2', html: '<p>Mon–Fri 8–16</p>' });
  assert.equal(b.templates.length, 1);
  assert.equal(b.templates[0].name, 'Opening hours v2');
  await assert.rejects(async () => prefs.saveTemplate(U, { name: '  ', html: 'x' }), /name/);
  assert.equal((await prefs.deleteTemplate(U, id)).templates.length, 0);
  // another user's data is separate
  assert.deepEqual((await prefs.loadPrefs('other@example.com')).signatures, {});
});

test('display name: stored per user, cleaned, falls back to what the server knows', async () => {
  const V = 'named@example.com';
  assert.equal(await prefs.nameFor(V, 'From Server'), 'From Server');
  assert.equal(await prefs.nameFor(V, ''), '');
  const p = await prefs.setName(V, '  Anton\tPopov  ');
  assert.equal(p.name, 'Anton Popov');
  assert.equal(await prefs.nameFor(V, 'From Server'), 'Anton Popov');
  assert.equal((await prefs.setName(V, 'x'.repeat(300))).name.length, 100);
  assert.equal(await prefs.nameFor(V, 'From Server'), 'x'.repeat(100));
  await prefs.setName(V, '');
  assert.equal(await prefs.nameFor(V, 'From Server'), 'From Server'); // clearing goes back to the default
});
