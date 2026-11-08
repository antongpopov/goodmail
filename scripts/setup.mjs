#!/usr/bin/env node
// goodmail setup wizard:  npm run setup
// Asks a few questions, checks that the mail servers answer, and writes goodmail.conf.
// No dependencies; safe to run again (the old file is kept as goodmail.conf.bak).
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';

const out = process.stdout;
const rl = readline.createInterface({ input: process.stdin });
const input = rl[Symbol.asyncIterator](); // works for a terminal and for piped answers alike
const ask = async (q, def = '') => {
  out.write(def ? `${q} [${def}] ` : `${q} `);
  const { value, done } = await input.next();
  if (done) out.write('\n');
  return (value || '').trim() || def;
};
const yes = async (q, def = true) => /^y/i.test(await ask(`${q} (y/n)`, def ? 'y' : 'n'));
const say = (s = '') => out.write(s + '\n');
const hostPort = (v, port) => {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(v.trim());
  return [m?.[1] || v.trim(), m?.[2] ? Number(m[2]) : port];
};

/** Does something answer on host:port (TLS on 993/465, plain otherwise)? */
function probe(host, port) {
  return new Promise((resolve) => {
    const done = (r) => {
      s.destroy();
      resolve(r);
    };
    const s = (port === 993 || port === 465 ? tls.connect({ host, port, servername: host, rejectUnauthorized: false }) : net.connect({ host, port }));
    s.setTimeout(6000, () => done('no answer'));
    s.once('error', (e) => done(e.code || e.message));
    s.once(port === 993 || port === 465 ? 'secureConnect' : 'connect', () => done('ok'));
  });
}

say('\ngoodmail setup\n==============');
say('This writes goodmail.conf. Press Enter to accept the suggestion in [brackets].\n');

const file = process.env.GOODMAIL_CONFIG || 'goodmail.conf';
if (fs.existsSync(file) && !(await yes(`${file} exists — replace it? (a copy is kept as ${file}.bak)`, false))) {
  say('Nothing changed.');
  process.exit(0);
}

const lines = ['# goodmail.conf — written by `npm run setup`. Every setting is explained in the README.', ''];
const domains = (await ask('Mail domain(s) your users have, comma separated (e.g. example.com, example.org):'))
  .toLowerCase()
  .split(/[,\s]+/)
  .filter(Boolean);
if (!domains.length) {
  say('A domain is needed.');
  process.exit(1);
}
const first = domains[0];
const imap = await ask('IMAP server (host or host:port, port 993 = TLS):', `mail.${first}`);
const [ih, ip] = hostPort(imap, 993);
const smtp = await ask('SMTP server (465 = TLS, 587 = STARTTLS):', `${ih}:587`);
const [sh, sp] = hostPort(smtp, 465);
const local = await yes('Do your users sign in to the mail server with just the part before the @ (not the full address)?', false);

say('\nChecking the servers …');
for (const [name, h, p] of [['IMAP', ih, ip], ['SMTP', sh, sp]]) {
  const r = await probe(h, p);
  say(`  ${name} ${h}:${p}  ${r === 'ok' ? '✓ answers' : '✗ ' + r + ' (continuing anyway)'}`);
}

lines.push(`domain1=${domains.join(', ')}`, `imap1=${ih}${ip === 993 ? '' : ':' + ip}`, `smtp1=${sh}:${sp}`);
if (local) lines.push('login1=local');
if (domains.length > 1) lines.push('', `# One install serves all of them. Give each domain a host name goodmail.<domain>`, `# (see "Several domains, one install" in the README); there "bo" logs in as bo@<that domain>.`);
lines.push('', `defaultdomain=${first}`);
const title = await ask('\nName shown on the sign-in page:', 'goodmail');
lines.push(`title=${title}`);

if (await yes('\nTurn on Mail rules (needs ManageSieve, port 4190, on the mail server)?', false)) {
  lines.push('', '# mail rules', `sieve1=${ih}`);
}
const pw = await ask('\nCommand that sets a new password for a mailbox (turns on "Change password"; Enter = off):');
if (pw) {
  lines.push('', '# change password: the command gets {"login","user","old","new"} as JSON on stdin (see README)', `passwordcmd1=${pw}`);
  if (await yes('Turn on "Forgot password" (needs a sender mailbox)?', false)) {
    const from = await ask('  Sender address:', `goodmail@${first}`);
    lines.push(`resetfrom=${from}`, `resetsmtp=${sh}:${sp === 465 ? 465 : 587}`, `resetuser=${from}`, `resetpass=${await ask('  Password of that sender mailbox:')}`);
  }
}

if (await yes('\nTurn on S/MIME (sign / encrypt mail; goodmail can be its own certificate authority)?', false)) {
  const r = spawnSync(process.env.GOODMAIL_OPENSSL || 'openssl', ['cms', '-help'], { encoding: 'utf8' });
  if (r.error || !/encrypt/.test((r.stdout || '') + (r.stderr || ''))) say('  ✗ the openssl command (with "cms") was not found — install OpenSSL first; S/MIME stays off for now.');
  else {
    lines.push('', '# S/MIME', 'smime=true', `smimecaname=${await ask('  Name of your certificate authority:', `${title} CA`)}`);
    say('  ✓ openssl found. The CA is created the first time someone makes a certificate.');
  }
}

if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o640 });
say(`\nWrote ${file}.\n`);
say('Next:');
say('  npm run build');
say('  NODE_ENV=production PORT=3000 node dist-server/index.mjs     (deploy/goodmail.service is a systemd example)');
say('Put it behind a TLS reverse proxy; for several domains see deploy/apache-multidomain.conf.');
rl.close();
