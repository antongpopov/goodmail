// The ManageSieve client against a tiny in-process server (STARTTLS with a throw-away certificate).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { withSieve } from '../server/managesieve.ts';

let key = '';
let cert = '';
let server: net.Server;
let port = 0;
const scripts = new Map<string, string>([['old', 'keep;'], ['goodmail', 'require "fileinto";\r\nfileinto "A";\r\n']]);
let active = 'goodmail';
let bad = false;

before(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-sieve-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${d}/k.pem`, '-out', `${d}/c.pem`, '-subj', '/CN=localhost', '-days', '2'], { stdio: 'ignore' });
  } catch {
    return;
  }
  key = fs.readFileSync(`${d}/k.pem`, 'utf8');
  cert = fs.readFileSync(`${d}/c.pem`, 'utf8');
  server = net.createServer((raw) => {
    let sock: net.Socket = raw;
    let buf = Buffer.alloc(0);
    let authed = false;
    const caps = '"IMPLEMENTATION" "fake"\r\n"SIEVE" "fileinto"\r\n';
    sock.write(caps + '"STARTTLS"\r\nOK "ready"\r\n');
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const s = buf.toString('latin1'); // byte-exact indices; decode the script body as UTF-8 afterwards
        const nl = s.indexOf('\r\n');
        if (nl < 0) return;
        const line = s.slice(0, nl);
        const lit = /\{(\d+)\+?\}$/.exec(line);
        let body = '';
        let used = nl + 2;
        if (lit) {
          const n = Number(lit[1]);
          if (s.length < used + n + 2) return;
          body = Buffer.from(s.slice(used, used + n), 'latin1').toString('utf8');
          used += n + 2;
        }
        buf = Buffer.from(s.slice(used), 'latin1');
        const cmd = line.replace(/ \{\d+\+?\}$/, '');
        if (cmd === 'STARTTLS') {
          sock.write('OK "Begin TLS negotiation now."\r\n');
          sock.removeAllListeners('data');
          const t = new tls.TLSSocket(sock, { isServer: true, key, cert });
          sock = t;
          buf = Buffer.alloc(0);
          t.on('data', onData);
          t.on('error', () => {});
          t.write(caps + 'OK "TLS ready"\r\n');
          return;
        }
        if (cmd.startsWith('AUTHENTICATE')) {
          const tok = Buffer.from(/"([^"]+)"$/.exec(cmd)![1], 'base64').toString();
          authed = tok === '\0me\0pw';
          sock.write(authed ? 'OK "ok"\r\n' : 'NO "Authentication failed"\r\n');
        } else if (!authed) sock.write('NO "auth first"\r\n');
        else if (cmd === 'LISTSCRIPTS') sock.write([...scripts.keys()].map((n) => `"${n}"${n === active ? ' ACTIVE' : ''}\r\n`).join('') + 'OK\r\n');
        else if (cmd.startsWith('GETSCRIPT')) {
          const n = /"([^"]+)"/.exec(cmd)![1];
          const v = scripts.get(n);
          sock.write(v === undefined ? 'NO "no such script"\r\n' : `{${Buffer.byteLength(v)}}\r\n${v}\r\nOK\r\n`);
        } else if (cmd.startsWith('CHECKSCRIPT')) sock.write(bad ? 'NO "line 2: syntax error"\r\n' : 'OK\r\n');
        else if (cmd.startsWith('PUTSCRIPT')) {
          if (bad) sock.write('NO "line 2: syntax error"\r\n');
          else {
            scripts.set(/"([^"]+)"/.exec(cmd)![1], body);
            sock.write('OK\r\n');
          }
        } else if (cmd.startsWith('SETACTIVE')) {
          active = /"([^"]+)"/.exec(cmd)![1];
          sock.write('OK\r\n');
        } else if (cmd === 'LOGOUT') {
          sock.end('OK "bye"\r\n');
        } else sock.write('NO "unknown"\r\n');
      }
    };
    sock.on('data', onData);
    sock.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as net.AddressInfo).port;
});
after(() => server?.close());

const o = (pass = 'pw') => ({ host: '127.0.0.1', port, user: 'me', pass, insecureTls: true, timeoutMs: 4000 });

test('STARTTLS, sign-in, list, read, write, activate', { skip: !cert && 'openssl missing' }, async () => {
  await withSieve(o(), async (s) => {
    assert.deepEqual(await s.list(), [{ name: 'old', active: false }, { name: 'goodmail', active: true }]);
    assert.equal(await s.get("goodmail"), 'require "fileinto";\r\nfileinto "A";\r\n');
    assert.equal(await s.get('nope'), undefined);
    const text = '# ünï\r\nkeep;\r\n';
    await s.check(text);
    await s.put("new", text);
    await s.activate('new');
    assert.equal(await s.get('new'), text);
    assert.equal((await s.list()).find((x) => x.active)!.name, 'new');
  });
});

test('wrong password and rejected scripts surface as errors', { skip: !cert && 'openssl missing' }, async () => {
  await assert.rejects(withSieve(o('bad'), async () => {}), (e: any) => e.auth === true);
  bad = true;
  await assert.rejects(withSieve(o(), (s) => s.put('x', 'junk')), /syntax error/);
  bad = false;
});
