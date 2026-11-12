import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestFor } from '../server/manifest.ts';

test('the manifest makes a standalone app named after the configured title, with real icon files', () => {
  const m = manifestFor('My mailoffice');
  assert.deepEqual([m.name, m.display, m.start_url, m.theme_color], ['My mailoffice', 'standalone', '/', '#0f6cbd']);
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'), 'the sizes Android asks for');
  assert.equal(m.short_name, 'My mailoffice');
  assert.equal(manifestFor('A very long name of a mail office').short_name, 'A very long name', 'cut at a word boundary, never mid-word');
  assert.equal(manifestFor('Supercalifragilisticexpialidocious').short_name, 'Supercalifragili', 'one very long word is cut');
  assert.equal(manifestFor('  ').name, 'goodmail', 'an empty title falls back');
  assert.equal(manifestFor('Mail').short_name, 'Mail');
});
