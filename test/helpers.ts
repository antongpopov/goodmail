import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Point the server modules at a throw-away data dir and the example config before they are imported. */
export function isolate() {
  process.env.GOODMAIL_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'goodmail-test-'));
  process.env.GOODMAIL_CONFIG = path.resolve('goodmail.conf.example');
  delete process.env.GOODMAIL_SECRET;
}

/** Minimal browser globals so web/src modules (i18n) can be imported under Node. */
export function browserStub() {
  const g = globalThis as any;
  g.document ??= { documentElement: {} };
  g.localStorage ??= { getItem: () => null, setItem: () => {} };
}
