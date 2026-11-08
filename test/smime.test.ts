// S/MIME against the real `openssl cms`: a throw-away CA, two users, sign / verify / encrypt / decrypt, tampering.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isolate } from './helpers.ts';

isolate();
const conf = path.join(os.tmpdir(), `gm-smime-test-${process.pid}.conf`);
fs.writeFileSync(conf, 'smime=true\nsmimecaname=Test CA\ndomain1=example.com\nimap1=localhost\n');
process.env.GOODMAIL_CONFIG = conf;
for (const p of ['/opt/homebrew/bin/openssl', '/usr/local/bin/openssl']) if (!process.env.GOODMAIL_OPENSSL && fs.existsSync(p)) process.env.GOODMAIL_OPENSSL = p;
const sm = await import('../server/smime.ts');
const ok = await sm.available();
const skip = !ok && 'openssl with cms is not available';

const keyA = crypto.randomBytes(32);
const keyB = crypto.randomBytes(32);
let alice: Awaited<ReturnType<typeof sm.issue>>;
let bob: Awaited<ReturnType<typeof sm.issue>>;

const mail = (to: string, body = 'Hello Bob,\r\n\r\nthis is secret: ünïcödé 42.\r\n') =>
  Buffer.from(
    ['From: Alice <alice@example.com>', `To: ${to}`, 'Subject: Test', 'Date: Mon, 09 Nov 2026 10:00:00 +0000', 'Message-ID: <1@example.com>', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body].join('\r\n'),
    'utf8',
  );

before(async () => {
  if (skip) return;
  alice = await sm.issue('alice@example.com', 'Alice Example', keyA);
  bob = await sm.issue('bob@example.com', 'Bob Example', keyB);
});

test('the CA issues certificates for the right address, usable for mail', { skip }, async () => {
  const info = sm.describe(alice.cert);
  assert.deepEqual(info.emails, ['alice@example.com']);
  assert.equal(info.name, 'Alice Example');
  assert.equal(info.issuer, 'Test CA');
  assert.equal(info.expired, false);
  assert.ok(await sm.caCertificate());
  await assert.rejects(sm.issue('not an address', 'x', keyA), /valid email/);
  // the private key is not stored in the clear
  assert.ok(!fs.readFileSync(path.join(process.env.GOODMAIL_DATA!, 'smime', 'ca.json'), 'utf8').includes('PRIVATE KEY'));
  assert.ok(!JSON.stringify(alice).includes('PRIVATE KEY'));
});

test('sign → verify: ok for the right sender, mismatch for another From', { skip }, async () => {
  const signed = await sm.protect(mail('bob@example.com'), { sign: { rec: alice, userKey: keyA } });
  const text = signed.toString('latin1');
  assert.match(text, /^From: Alice/m);
  assert.match(text, /Content-Type: multipart\/signed;/i);
  assert.match(text, /application\/pkcs7-signature/);
  const v = await sm.verify(signed, 'alice@example.com');
  assert.equal(v.status, 'ok');
  assert.deepEqual(v.signer?.emails, ['alice@example.com']);
  assert.equal((await sm.verify(signed, 'mallory@example.com')).status, 'mismatch');
});

test('a tampered signed message is invalid', { skip }, async () => {
  const signed = await sm.protect(mail('bob@example.com'), { sign: { rec: alice, userKey: keyA } });
  const evil = Buffer.from(signed.toString('latin1').replace('this is secret', 'this is SECRET'), 'latin1');
  assert.equal((await sm.verify(evil, 'alice@example.com')).status, 'invalid');
});

test('a certificate from an unknown CA is "untrusted", not accepted', { skip }, async () => {
  // issue from the CA, then pretend the verifier never heard of it by wiping the trust anchor file
  const caPath = path.join(process.env.GOODMAIL_DATA!, 'smime', 'ca.json');
  const keep = fs.readFileSync(caPath, 'utf8');
  const signed = await sm.protect(mail('bob@example.com'), { sign: { rec: alice, userKey: keyA } });
  fs.rmSync(caPath);
  try {
    assert.equal((await sm.verify(signed, 'alice@example.com')).status, 'untrusted');
  } finally {
    fs.writeFileSync(caPath, keep, { mode: 0o600 });
  }
});

test('encrypt → decrypt: only the recipient can read it, and the body is not in the clear', { skip }, async () => {
  const enc = await sm.protect(mail('bob@example.com'), { encryptTo: [bob.cert, alice.cert] });
  const text = enc.toString('latin1');
  assert.match(text, /^To: bob@example.com/m);
  assert.match(text, /application\/pkcs7-mime/);
  assert.ok(!text.includes('this is secret'));
  const inner = await sm.decrypt(enc, bob, keyB);
  assert.ok(inner && inner.toString('utf8').includes('this is secret: ünïcödé 42.'));
  assert.ok(await sm.decrypt(enc, alice, keyA)); // the sender can read her own copy
  const carol = await sm.issue('carol@example.com', 'Carol', keyB);
  assert.equal(await sm.decrypt(enc, carol, keyB), undefined);
  assert.equal(await sm.decrypt(enc, bob, crypto.randomBytes(32)), undefined); // wrong user key
});

test('sign + encrypt: decrypts to a message that verifies', { skip }, async () => {
  const both = await sm.protect(mail('bob@example.com'), { sign: { rec: alice, userKey: keyA }, encryptTo: [bob.cert] });
  assert.equal(sm.kindOf('application/pkcs7-mime', { 'smime-type': 'enveloped-data' }), 'enveloped');
  const inner = await sm.decrypt(both, bob, keyB);
  assert.ok(inner);
  const innerText = inner!.toString('latin1');
  assert.match(innerText, /multipart\/signed/i);
  const v = await sm.verify(Buffer.from('MIME-Version: 1.0\r\n' + innerText, 'latin1'), 'alice@example.com');
  assert.equal(v.status, 'ok');
});

test('p12 export and import round trip', { skip }, async () => {
  const p12 = await sm.exportP12(alice, keyA, 'correct horse');
  assert.ok(p12.length > 500);
  await assert.rejects(sm.importP12('alice@example.com', p12, 'wrong password', keyB), /Wrong password|not a usable/);
  await assert.rejects(sm.importP12('bob@example.com', p12, 'correct horse', keyB), /not bob@example.com/);
  const back = await sm.importP12('alice@example.com', p12, 'correct horse', keyB);
  assert.equal(back.issuer, 'imported');
  const enc = await sm.protect(mail('alice@example.com'), { encryptTo: [alice.cert] });
  assert.ok(await sm.decrypt(enc, back, keyB));
  await sm.removeUserCert('alice@example.com');
});

test('contact certificates: remembered, looked up, forgotten; local users found automatically', { skip }, async () => {
  assert.equal(await sm.rememberCert('owner@example.com', bob.cert), true);
  assert.equal(await sm.rememberCert('owner@example.com', bob.cert), false);
  assert.equal(await sm.certFor('owner@example.com', 'BOB@example.com'), bob.cert);
  assert.deepEqual((await sm.listCerts('owner@example.com')).map((c) => c.email), ['bob@example.com']);
  await sm.forgetCert('owner@example.com', 'bob@example.com');
  assert.equal((await sm.listCerts('owner@example.com')).length, 0);
  // bob is a local user, so even without a saved copy his certificate is found
  assert.equal((await sm.certFor('owner@example.com', 'bob@example.com'))?.trim(), bob.cert.trim());
  assert.equal(await sm.certFor('owner@example.com', 'nobody@example.com'), undefined);
});

test('header splitting keeps the outer headers outside the signed part', () => {
  const { headers, body } = sm.splitMessage('A: 1\r\nSubject: long\r\n continued\r\nContent-Type: text/plain\r\n\r\nbody\r\n');
  assert.deepEqual(headers, ['A: 1', 'Subject: long\r\n continued', 'Content-Type: text/plain']);
  assert.equal(body, 'body\r\n');
  assert.equal(sm.kindOf('multipart/signed', { protocol: 'application/pkcs7-signature' }), 'signed');
  assert.equal(sm.kindOf('application/x-pkcs7-mime', { 'smime-type': 'signed-data' }), 'opaque');
  assert.equal(sm.kindOf('text/plain'), null);
});
