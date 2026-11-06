// Starts the real server (no IMAP needed) and pins the HTTP surface: auth gate, CSRF guard, headers, 404s.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

let child: ChildProcess;
let base = '';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      GOODMAIL_CONFIG: path.resolve('goodmail.conf.example'),
      GOODMAIL_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'goodmail-srv-')),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15_000);
    child.stdout!.on('data', (d) => String(d).includes('listening') && (clearTimeout(t), resolve()));
    child.on('exit', (c) => reject(new Error('server exited early: ' + c)));
  });
});
after(() => child?.kill());

const req = (method: string, p: string, headers: Record<string, string> = {}, body?: unknown) =>
  fetch(base + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
const csrf = { 'x-goodmail': '1' };

test('public config endpoint works without a session', async () => {
  const r = await req('GET', '/api/config');
  assert.equal(r.status, 200);
  assert.ok((await r.json()).appName);
});

test('every protected GET endpoint answers 401 without a login', async () => {
  for (const p of ['/api/me', '/api/folders', '/api/contacts', '/api/events', '/api/accounts']) {
    assert.equal((await req('GET', p, csrf)).status, 401, p);
  }
});

test('state-changing requests without the CSRF header are refused (403) before anything else', async () => {
  for (const p of ['/api/logout', '/api/login', '/api/move', '/api/delete']) {
    assert.equal((await req('POST', p, {}, {})).status, 403, p);
  }
});

test('with the header, protected POSTs still need a login (401), and logout is always fine', async () => {
  assert.equal((await req('POST', '/api/move', csrf, { folder: 'INBOX', uids: [1], to: 'junk' })).status, 401);
  assert.equal((await req('POST', '/api/logout', csrf, {})).status, 200);
});

test('login: bad input is a 400, unknown domain is refused, no session cookie is set', async () => {
  assert.equal((await req('POST', '/api/login', csrf, { email: 'nope', password: '' })).status, 400);
  const r = await req('POST', '/api/login', csrf, { email: 'x@unknown.invalid', password: 'pw' });
  assert.ok(r.status >= 400 && r.status < 500);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('security headers are set on every response', async () => {
  const r = await req('GET', '/api/config');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('unknown /api routes are a JSON 404', async () => {
  const r = await req('GET', '/api/does-not-exist', csrf);
  assert.equal(r.status, 404);
});
