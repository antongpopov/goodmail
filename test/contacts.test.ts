import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.ts';

isolate();
const ct = await import('../server/contacts.ts');

const sample = () =>
  [
    ct.normalize({ name: 'Åsa Öberg', emails: ['Asa@Example.com', 'asa.work@example.com'], phones: ['+45 12 34 56 78'], company: 'Acme, Inc.', notes: 'Line one\nLine "two", with comma' }),
    ct.normalize({ name: 'Bo', emails: ['bo@example.com'] }),
  ];

test('normalize lowercases emails, trims and fills defaults', () => {
  const c = ct.normalize({ name: '  Bo  ', emails: ['BO@Example.com', ''], phones: undefined as any });
  assert.equal(c.name, 'Bo');
  assert.deepEqual(c.emails, ['bo@example.com']);
  assert.deepEqual(c.phones, []);
  assert.ok(c.id.length > 8);
});

test('vCard export → import keeps names, emails, phones, company and multi-line notes', () => {
  const out = ct.parseVCard(ct.toVCard(sample()));
  assert.equal(out.length, 2);
  const a = out.find((c) => c.name === 'Åsa Öberg')!;
  assert.deepEqual(a.emails, ['asa@example.com', 'asa.work@example.com']);
  assert.deepEqual(a.phones, ['+45 12 34 56 78']);
  assert.equal(a.company, 'Acme, Inc.');
  assert.equal(a.notes, 'Line one\nLine "two", with comma');
});

test('CSV export → import survives commas, quotes and newlines', () => {
  const out = ct.parseCsv(ct.toCsv(sample()));
  assert.equal(out.length, 2);
  const a = out.find((c) => c.name === 'Åsa Öberg')!;
  assert.equal(a.company, 'Acme, Inc.');
  assert.equal(a.notes, 'Line one\nLine "two", with comma');
  assert.ok(a.emails!.includes('asa@example.com'));
});

test('parsers tolerate empty or junk input', () => {
  assert.deepEqual(ct.parseVCard(''), []);
  assert.deepEqual(ct.parseCsv(''), []);
  assert.doesNotThrow(() => ct.parseVCard('BEGIN:VCARD\nFN:Only name'));
});
