import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPasswordCommand, checkNewPassword } from '../server/password.ts';
import { splitArgs, parseConfig } from '../server/config.ts';

const script = (body: string) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-pw-')), 's.mjs');
  fs.writeFileSync(f, body);
  return [process.execPath, f];
};
const job = { login: 'a@b.c', user: 'a@b.c', old: 'oldpass', next: 'a new "pass" word' };

test('the command receives the job as JSON on stdin', async () => {
  const out = path.join(os.tmpdir(), `gm-pw-out-${process.pid}`);
  const argv = script(`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(out)}, fs.readFileSync(0, 'utf8'));`);
  await runPasswordCommand(argv, job);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), { login: 'a@b.c', user: 'a@b.c', old: 'oldpass', new: 'a new "pass" word' });
});

test('a failing command shows its first stdout line, never stderr', async () => {
  const argv = script(`console.log('Password is too weak'); console.error('secret detail'); process.exit(1);`);
  await assert.rejects(runPasswordCommand(argv, job), (e: any) => e.message === 'Password is too weak' && e.status === 400);
  const quiet = script(`console.error('secret detail'); process.exit(2);`);
  await assert.rejects(runPasswordCommand(quiet, job), (e: any) => !/secret/.test(e.message));
});

test('a missing command and a hanging command fail cleanly', async () => {
  await assert.rejects(runPasswordCommand(['/nonexistent/cmd'], job), /Can't run/);
  await assert.rejects(runPasswordCommand(script('setTimeout(() => {}, 60000)'), job, 300), /in time/);
});

test('new password checks', () => {
  assert.match(checkNewPassword('a', 'short', 10)!, /at least 10/);
  assert.match(checkNewPassword('same-password', 'same-password', 10)!, /same/);
  assert.match(checkNewPassword('a', 'bad\nline-password', 10)!, /control/);
  assert.equal(checkNewPassword('old-password', 'a-good-new-one', 10), null);
});

test('command lines split like a shell would, without running one', () => {
  assert.deepEqual(splitArgs(`ssh -i /k "a b" 'c d' e`), ['ssh', '-i', '/k', 'a b', 'c d', 'e']);
});

test('config: sieveN and passwordcmdN turn the features on per domain', () => {
  const c = parseConfig('domain1=a.com\nimap1=m.a.com\nsieve1=m.a.com\npasswordcmd1=ssh -i /k pw@m.a.com\nmindummy=1\ndomain2=b.com\nimap2=m.b.com');
  const a = c.domains.get('a.com')!;
  assert.equal(a.sieveHost, 'm.a.com');
  assert.equal(a.sievePort, 4190);
  assert.deepEqual(a.passwordCmd, ['ssh', '-i', '/k', 'pw@m.a.com']);
  assert.equal(a.passwordMin, 10);
  const b = c.domains.get('b.com')!;
  assert.equal(b.sieveHost, undefined);
  assert.equal(b.passwordCmd, undefined);
});

test('config: resetfrom + resetsmtp turn on "forgot password"', () => {
  const c = parseConfig('resetfrom=gm@a.com\nresetsmtp=mail.a.com:465\nresetpass=x\ndomain1=a.com\nimap1=m.a.com');
  assert.deepEqual(c.reset, { from: 'gm@a.com', host: 'mail.a.com', port: 465, secure: true, user: 'gm@a.com', pass: 'x', insecureTls: false });
  assert.equal(parseConfig('resetfrom=gm@a.com').reset, undefined);
});
