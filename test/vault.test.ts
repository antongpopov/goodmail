import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.ts';

isolate();
const v = await import('../server/vault.ts');

test('seal/unseal round-trips and preserves the payload', () => {
  const tok = v.seal({ email: 'a@example.com', pass: 'p4ss', exp: Date.now() + 60_000 });
  const back = v.unseal(tok);
  assert.equal(back?.email, 'a@example.com');
  assert.equal(back?.pass, 'p4ss');
});

test('unseal rejects expired, tampered and garbage tokens', () => {
  const expired = v.seal({ email: 'a@example.com', pass: 'x', exp: Date.now() - 1 });
  assert.equal(v.unseal(expired), undefined);
  const good = v.seal({ email: 'a@example.com', pass: 'x', exp: Date.now() + 60_000 });
  // change one character inside the ciphertext (always to a different one, so the token really is altered)
  const i = good.length - 5;
  const flipped = good.slice(0, i) + (good[i] === 'A' ? 'B' : 'A') + good.slice(i + 1);
  assert.equal(v.unseal(flipped), undefined);
  assert.equal(v.unseal('not-a-token'), undefined);
  assert.equal(v.unseal(''), undefined);
});

test('two seals of the same value differ (random IV)', () => {
  const a = v.seal({ email: 'a@example.com', pass: 'x', exp: Date.now() + 1000 });
  const b = v.seal({ email: 'a@example.com', pass: 'x', exp: Date.now() + 1000 });
  assert.notEqual(a, b);
});

test('per-user key depends on email (case-insensitive) and password', () => {
  const k1 = v.userKey('Bo@Example.com', 'pw');
  assert.equal(k1.length, 32);
  assert.ok(k1.equals(v.userKey('bo@example.com', 'pw')));
  assert.ok(!k1.equals(v.userKey('bo@example.com', 'other')));
  assert.ok(!k1.equals(v.userKey('al@example.com', 'pw')));
});

test('encryptWith/decryptWith round-trip, wrong key fails', () => {
  const key = v.userKey('bo@example.com', 'pw');
  const tok = v.encryptWith(key, 'secret text åäö');
  assert.equal(v.decryptWith(key, tok), 'secret text åäö');
  assert.equal(v.decryptWith(v.userKey('bo@example.com', 'wrong'), tok), undefined);
  assert.equal(v.serverDecrypt(v.serverEncrypt('seed')), 'seed');
});
