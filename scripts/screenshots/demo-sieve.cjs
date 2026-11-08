// A tiny in-memory ManageSieve server (STARTTLS, any user, password "demo") so the screenshots can show the rules editor.
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-sieve-'));
execFileSync(process.env.GOODMAIL_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-subj', '/CN=localhost', '-days', '2'], { stdio: 'ignore' });
const key = fs.readFileSync(`${dir}/k.pem`);
const cert = fs.readFileSync(`${dir}/c.pem`);
const scripts = new Map();
let active = '';

net
  .createServer((raw) => {
    let sock = raw;
    let buf = Buffer.alloc(0);
    let authed = false;
    const caps = '"IMPLEMENTATION" "demo"\r\n"SIEVE" "fileinto"\r\n';
    sock.write(caps + '"STARTTLS"\r\nOK "ready"\r\n');
    const on = (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const s = buf.toString('latin1');
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
          t.on('data', on);
          t.on('error', () => {});
          t.write(caps + 'OK "TLS ready"\r\n');
          return;
        }
        if (cmd.startsWith('AUTHENTICATE')) {
          authed = true;
          sock.write('OK "ok"\r\n');
        } else if (!authed) sock.write('NO "auth first"\r\n');
        else if (cmd === 'LISTSCRIPTS') sock.write([...scripts.keys()].map((n) => `"${n}"${n === active ? ' ACTIVE' : ''}\r\n`).join('') + 'OK\r\n');
        else if (cmd.startsWith('GETSCRIPT')) {
          const v = scripts.get(/"([^"]+)"/.exec(cmd)[1]);
          sock.write(v === undefined ? 'NO "no such script"\r\n' : `{${Buffer.byteLength(v)}}\r\n${v}\r\nOK\r\n`);
        } else if (cmd.startsWith('CHECKSCRIPT')) sock.write('OK\r\n');
        else if (cmd.startsWith('PUTSCRIPT')) {
          scripts.set(/"([^"]+)"/.exec(cmd)[1], body);
          sock.write('OK\r\n');
        } else if (cmd.startsWith('SETACTIVE')) {
          active = /"([^"]+)"/.exec(cmd)[1];
          sock.write('OK\r\n');
        } else if (cmd === 'LOGOUT') sock.end('OK "bye"\r\n');
        else sock.write('NO "unknown"\r\n');
      }
    };
    sock.on('data', on);
    sock.on('error', () => {});
  })
  .listen(4190, '127.0.0.1', () => console.log('demo sieve 4190'));
