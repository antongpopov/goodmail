import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserStub } from './helpers.ts';

browserStub();
const { humanSize, initials, displayName, fullAddr, escapeHtml, textToHtml, parseRecipients, avatarColor } = await import('../web/src/util.ts');

test('humanSize', () => {
  assert.equal(humanSize(0), '0 B');
  assert.equal(humanSize(1023), '1023 B');
  assert.equal(humanSize(2048), '2 KB');
  assert.equal(humanSize(5 * 1024 * 1024), '5.0 MB');
});

test('initials: two words, one word, email fallback, unicode, junk', () => {
  assert.equal(initials({ name: 'Anton Popov', address: 'a@x.com' }), 'AP');
  assert.equal(initials({ name: 'Anton', address: 'a@x.com' }), 'A');
  assert.equal(initials({ name: '', address: 'bo.christensen@x.com' }), 'BC');
  assert.equal(initials({ name: 'Åsa Öberg', address: 'a@x.com' }), 'ÅÖ');
  assert.equal(initials({ name: '', address: '' }), '?');
});

test('displayName / fullAddr', () => {
  assert.equal(displayName({ name: 'Bo', address: 'bo@x.com' }), 'Bo');
  assert.equal(displayName({ name: '', address: 'bo@x.com' }), 'bo@x.com');
  assert.equal(fullAddr({ name: 'Bo', address: 'bo@x.com' }), 'Bo <bo@x.com>');
  assert.equal(fullAddr({ name: '', address: 'bo@x.com' }), 'bo@x.com');
});

test('escapeHtml/textToHtml escape markup, linkify urls without the trailing punctuation, keep line breaks', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(textToHtml('see https://example.com/a?b=1, ok\nnext'), 'see <a href="https://example.com/a?b=1">https://example.com/a?b=1</a>, ok<br>next');
  assert.ok(!textToHtml('<script>alert(1)</script>').includes('<script>'));
});

test('parseRecipients splits on comma, semicolon and newline', () => {
  assert.equal(parseRecipients('A <a@x.com>, b@y.com; c@z.com\n d@w.com ,, '), 'A <a@x.com>, b@y.com, c@z.com, d@w.com');
});

test('avatarColor is stable and case-insensitive', () => {
  assert.equal(avatarColor('Bo@X.com'), avatarColor('bo@x.com'));
  assert.match(avatarColor('anything'), /^#[0-9a-f]{6}$/i);
});

test('initials: first + last word, ignoring "(via …)" tails, and host-like names', async () => {
  const { initials } = await import('../web/src/util.ts');
  assert.equal(initials({ name: 'Konstantin Zlatanov (via Google Drive)', address: 'x@google.com' }), 'KZ');
  assert.equal(initials({ name: 'Anna Berg via Dropbox', address: 'x@dropbox.com' }), 'AB');
  assert.equal(initials({ name: 'apopov.de', address: 'a@apopov.de' }), 'AP');
  assert.equal(initials({ name: '', address: 'john.smith@example.com' }), 'JS');
  assert.equal(initials({ name: 'GitHub', address: 'n@github.com' }), 'G');
});
