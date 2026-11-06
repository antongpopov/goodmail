import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.ts';

isolate();
const cfg = await import('../server/config.ts');

test('parseConfig reads domains, ports, defaults and comments', () => {
  const c = cfg.parseConfig(`
    # a comment
    title = Test Mail
    defaultdomain = Example.COM
    domain1 = example.com, Example.DE   # two domains share one entry
    imap1 = mail.example.com
    smtp1 = mail.example.com:587
    title1 = Example Webmail
    domain2 = other.org
    imap2 = imap.other.org:143
    insecure2 = true
    login2 = local
    domain3 = broken.net
  `);
  assert.equal(c.title, 'Test Mail');
  assert.equal(c.defaultDomain, 'example.com');
  const a = c.domains.get('example.com')!;
  assert.equal(a.imapHost, 'mail.example.com');
  assert.equal(a.imapPort, 993);
  assert.equal(a.imapSecure, true);
  assert.equal(a.smtpPort, 587);
  assert.equal(a.smtpSecure, false);
  assert.equal(a.title, 'Example Webmail');
  assert.equal(c.domains.get('example.de'), a); // same entry for both names
  const b = c.domains.get('other.org')!;
  assert.equal(b.imapPort, 143);
  assert.equal(b.imapSecure, false);
  assert.equal(b.smtpHost, 'imap.other.org'); // smtp defaults to the imap host
  assert.equal(b.smtpPort, 465);
  assert.equal(b.insecureTls, true);
  assert.equal(b.login, 'local');
  assert.equal(c.domains.has('broken.net'), false); // no imap3= -> ignored
});

test('parseConfig: autodiscover flag and spam threshold', () => {
  const c = cfg.parseConfig('autodiscover = true\nspamthreshold = 7.5\n');
  assert.equal(c.autodiscover, true);
  assert.equal(c.spamThreshold, 7.5);
  assert.equal(cfg.parseConfig('').autodiscover, false);
});

test('normalizeLogin lowercases and appends the default domain only when configured', () => {
  // the example config has no defaultdomain, so nothing is appended
  assert.equal(cfg.normalizeLogin('  Bo@Example.COM '), 'bo@example.com');
  assert.equal(cfg.normalizeLogin('bo'), 'bo');
});

test('serversFor returns configured domains, nothing for unknown ones (autodiscover off)', async () => {
  assert.ok(await cfg.serversFor('someone@example.com'));
  assert.equal(await cfg.serversFor('someone@unknown.invalid'), undefined);
  assert.equal(await cfg.serversFor('no-at-sign'), undefined);
});
