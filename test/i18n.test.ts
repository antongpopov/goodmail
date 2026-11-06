import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserStub } from './helpers.ts';

browserStub();
const { LANGUAGES } = await import('../web/src/i18n.ts');

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

for (const lang of LANGUAGES.filter((l) => l.id !== 'en')) {
  test(`locale ${lang.id}: translations keep the same {placeholders} as the English text`, () => {
    const bad = Object.entries(lang.dict).filter(([en, tr]) => vars(en) !== vars(tr)).map(([en]) => en);
    assert.deepEqual(bad, []);
  });
  test(`locale ${lang.id}: no empty translations`, () => {
    assert.deepEqual(Object.entries(lang.dict).filter(([, tr]) => !String(tr).trim()).map(([en]) => en), []);
  });
}
