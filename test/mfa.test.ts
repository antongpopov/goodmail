import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.ts';

isolate();
const mfa = await import('../server/mfa.ts');

// RFC 6238 appendix B: secret "12345678901234567890" (SHA-1), T=59s -> 94287082, so 6 digits = 287082.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('TOTP matches the RFC 6238 test vector and accepts spaces', () => {
  mock.method(Date, 'now', () => 59_000);
  assert.equal(mfa.checkTotp(RFC_SECRET, '287082'), 1);
  assert.equal(mfa.checkTotp(RFC_SECRET, '287 082'), 1);
  assert.equal(mfa.checkTotp(RFC_SECRET, '000000'), null);
  assert.equal(mfa.checkTotp(RFC_SECRET, '12345'), null);
  assert.equal(mfa.checkTotp(RFC_SECRET, 'abcdef'), null);
  mock.restoreAll();
});

test('TOTP replay protection: a used step is refused', () => {
  mock.method(Date, 'now', () => 59_000);
  assert.equal(mfa.checkTotp(RFC_SECRET, '287082', 1), null);
  mock.restoreAll();
});

test('TOTP rejects a code from far outside the ±1 step window', () => {
  mock.method(Date, 'now', () => 59_000 + 10 * 30_000);
  assert.equal(mfa.checkTotp(RFC_SECRET, '287082'), null);
  mock.restoreAll();
});

test('new TOTP secret is base32 and the otpauth URI carries it', () => {
  const s = mfa.newTotpSecret();
  assert.match(s, /^[A-Z2-7]+$/);
  const uri = mfa.otpauthUri(s, 'bo@example.com', 'goodmail');
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes(`secret=${s}`));
});

test('recovery codes: 10 unique codes, each usable exactly once', () => {
  const { plain, hashed } = mfa.newRecoveryCodes();
  assert.equal(plain.length, 10);
  assert.equal(new Set(plain).size, 10);
  const d: any = { recovery: [...hashed] };
  assert.equal(mfa.useRecoveryCode(d, plain[0]), true);
  assert.equal(mfa.useRecoveryCode(d, plain[0]), false); // already consumed
  assert.equal(mfa.useRecoveryCode(d, plain[1].toLowerCase().replace('-', ' ')), true); // forgiving input
  assert.equal(d.recovery.length, 8);
  assert.equal(mfa.useRecoveryCode(d, 'AAAAA-AAAAA'), false);
});

test('maskEmail hides the middle of the address', () => {
  const m = mfa.maskEmail('anton@example.com');
  assert.ok(m.includes('@') && m.includes('example.com') && !m.includes('anton'));
});

test('sealTotp/openTotp round-trip', () => {
  assert.equal(mfa.openTotp(mfa.sealTotp('ABCDEFGH')), 'ABCDEFGH');
});
