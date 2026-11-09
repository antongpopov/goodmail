// Stand-in for ops/goodmail-admin in the screenshot demo: answers the read operations with canned data
// (everything that would change something is accepted and ignored). Enabled by `admincmd1=` in demo.conf.
import fs from 'node:fs';
const job = JSON.parse(fs.readFileSync(0, 'utf8').split('\n')[0]);
const say = (o) => console.log(JSON.stringify(o));
const boxes = [
  ['alex@example.com', 'Alex Morgan', true],
  ['sam@example.com', 'Sam Okafor', true],
  ['priya@example.com', 'Priya Raman', true],
  ['jonas@example.com', 'Jonas Becker', false],
  ['info@example.com', 'Front desk', true],
];
switch (job.op) {
  case 'whoami':
    say({ ok: true, admin: true, superadmin: true, domains: ['example.com', 'example.net'] });
    break;
  case 'domain.get':
    say({
      ok: true,
      domain: job.domain,
      description: job.domain,
      limits: { mailboxes: 0, aliases: 0 },
      active: true,
      mailboxes: boxes.map(([address, name, active]) => ({ address, name, active, forwards: address === 'info@example.com' ? ['sam@example.com'] : [] })),
      aliases: [
        { address: 'sales@example.com', goto: ['alex@example.com', 'sam@example.com'], active: true },
        { address: 'support@example.com', goto: ['sam@example.com'], active: true },
        { address: '@example.com', goto: ['info@example.com'], active: true },
      ],
    });
    break;
  case 'domain.list':
    say({
      ok: true,
      domains: [
        { domain: 'example.com', description: 'Example Ltd', active: true, limits: { mailboxes: 0, aliases: 0 }, counts: { mailboxes: 5, aliases: 3 }, admins: [{ address: 'alex@example.com', mailbox: true, mfa: true }, { address: 'sam@example.com', mailbox: true, mfa: false }] },
        { domain: 'example.net', description: 'Example Studio', active: true, limits: { mailboxes: 10, aliases: 0 }, counts: { mailboxes: 3, aliases: 1 }, admins: [{ address: 'priya@example.com', mailbox: true, mfa: true }] },
      ],
    });
    break;
  default:
    say({ ok: true });
}
