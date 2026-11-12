import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAdminCommand } from '../server/admin.ts';
import { parseConfig } from '../server/config.ts';

const script = (body: string) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-adm-')), 's.mjs');
  fs.writeFileSync(f, body);
  return [process.execPath, f];
};

test('the command receives op, caller and arguments as one JSON line, and its answer comes back without "ok"', async () => {
  const out = path.join(os.tmpdir(), `gm-adm-out-${process.pid}`);
  const argv = script(`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(out)}, fs.readFileSync(0, 'utf8')); console.log(JSON.stringify({ ok: true, domains: ['a.dk'] }));`);
  const res = await runAdminCommand(argv, 'domain.get', 'boss@a.dk', { domain: 'a.dk' });
  assert.deepEqual(res, { domains: ['a.dk'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), { domain: 'a.dk', op: 'domain.get', caller: 'boss@a.dk' });
});

test('an error answer becomes a 400 with the command’s own text', async () => {
  const argv = script(`console.log(JSON.stringify({ error: 'You do not administer this domain' }));`);
  await assert.rejects(runAdminCommand(argv, 'mailbox.delete', 'x@a.dk'), (e: any) => e.message === 'You do not administer this domain' && e.status === 400);
});

test('garbage output, a crash or a missing command is a 502 that never leaks stderr', async () => {
  const bad = script(`console.error('secret detail'); console.log('not json'); process.exit(3);`);
  await assert.rejects(runAdminCommand(bad, 'whoami', 'x@a.dk'), (e: any) => e.status === 502 && !/secret/.test(e.message));
  const noOk = script(`console.log(JSON.stringify({ domains: [] }));`);
  await assert.rejects(runAdminCommand(noOk, 'whoami', 'x@a.dk'), (e: any) => e.status === 502);
  await assert.rejects(runAdminCommand(['/nonexistent/cmd'], 'whoami', 'x@a.dk'), (e: any) => e.status === 502);
});

test('a command that hangs is stopped', async () => {
  const argv = script(`setTimeout(() => {}, 60000);`);
  await assert.rejects(runAdminCommand(argv, 'whoami', 'x@a.dk', {}, 300), (e: any) => /in time/.test(e.message));
});

test('admincmdN in the config file turns the feature on for that entry', async () => {
  const cfg = parseConfig(['domain1=example.com', 'imap1=mail.example.com', 'admincmd1=ssh -i /k adm@mail.example.com'].join('\n'));
  assert.deepEqual(cfg.domains.get('example.com')?.adminCmd, ['ssh', '-i', '/k', 'adm@mail.example.com']);
  const none = parseConfig(['domain1=example.com', 'imap1=mail.example.com'].join('\n'));
  assert.equal(none.domains.get('example.com')?.adminCmd, undefined);
});

import { isAdmin } from '../server/admin.ts';

test('isAdmin: the admin command decides; no command, an error answer or a crash all mean "not an administrator"', async () => {
  const boss = script(`const l = JSON.parse(require('node:fs').readFileSync(0,'utf8')); console.log(JSON.stringify({ ok: true, admin: l.caller === 'boss@a.dk' }));`.replace("require('node:fs')", 'process.getBuiltinModule("node:fs")'));
  assert.equal(await isAdmin(boss, 'boss@a.dk', 0), true);
  assert.equal(await isAdmin(boss, 'BOSS@a.dk', 0), true, 'case does not matter');
  assert.equal(await isAdmin(boss, 'user@a.dk', 0), false);
  assert.equal(await isAdmin(undefined, 'boss@a.dk'), false);
  assert.equal(await isAdmin(script(`console.log(JSON.stringify({ error: 'not an administrator' }));`), 'boss@a.dk', 0), false);
  assert.equal(await isAdmin(script(`process.exit(3);`), 'boss@a.dk', 0), false);
});

test('isAdmin remembers the answer, so a polling window does not start the command every time', async () => {
  const counter = path.join(os.tmpdir(), `gm-adm-count-${process.pid}`);
  fs.writeFileSync(counter, '');
  const argv = script(`const fs = process.getBuiltinModule('node:fs'); fs.appendFileSync(${JSON.stringify(counter)}, 'x'); console.log(JSON.stringify({ ok: true, admin: true }));`);
  for (let i = 0; i < 5; i++) assert.equal(await isAdmin(argv, 'cached@a.dk', 60_000), true);
  assert.equal(fs.readFileSync(counter, 'utf8').length, 1, 'the command ran once for five asks');
});
