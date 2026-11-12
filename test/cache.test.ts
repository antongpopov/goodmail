import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCache, rememberList, persistLists, hydrateLists, clearLists } from '../web/src/cache.ts';

// An in-memory stand-in for sessionStorage
function store() {
  const m = new Map<string, string>();
  return Object.assign(Object.create(null), {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  });
}
// Object.keys(store) must list the stored keys for clearLists: expose them as own properties
const live = (s: ReturnType<typeof store>) => new Proxy(s, { ownKeys: () => s.keys(), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });

const row = (uid: number) => ({ uid, subject: `s${uid}`, snippet: 'x'.repeat(20) }) as never;
const key = (folder: string, q = '') => `main\u0000${folder}\u0000${q}\u0000all\u0000`;

test('lists survive a reload: persist, forget everything in memory, hydrate', () => {
  listCache.clear();
  rememberList(key('INBOX'), { messages: [row(1), row(2)], hasMore: true });
  const s = store();
  persistLists('me@example.com', s);
  listCache.clear();
  hydrateLists('me@example.com', s);
  assert.deepEqual([...listCache.keys()], [key('INBOX')]);
  assert.equal(listCache.get(key('INBOX'))!.messages.length, 2);
  assert.equal(listCache.get(key('INBOX'))!.hasMore, true);
});

test('searches are never kept, and nobody gets somebody else\'s lists', () => {
  listCache.clear();
  rememberList(key('INBOX'), { messages: [row(1)], hasMore: false });
  rememberList(key('INBOX', 'secret search'), { messages: [row(2)], hasMore: false });
  const s = store();
  persistLists('a@example.com', s);
  listCache.clear();
  hydrateLists('b@example.com', s); // another user in the same tab
  assert.equal(listCache.size, 0);
  hydrateLists('A@example.com', s); // same user, different letter case
  assert.deepEqual([...listCache.keys()], [key('INBOX')]);
});

test('at most 16 lists and about a megabyte: the least recently used go first', () => {
  listCache.clear();
  for (let i = 0; i < 25; i++) rememberList(key(`F${i}`), { messages: [row(i)], hasMore: false });
  const s = store();
  persistLists('me@example.com', s);
  listCache.clear();
  hydrateLists('me@example.com', s);
  assert.deepEqual([...listCache.keys()].map((k) => k.split('\u0000')[1]), Array.from({ length: 16 }, (_, i) => `F${i + 9}`));
  listCache.clear();
  const big = Array.from({ length: 6000 }, (_, i) => ({ uid: i, snippet: 'y'.repeat(200) }) as never);
  rememberList(key('OLD'), { messages: big, hasMore: false });
  rememberList(key('NEW'), { messages: [row(1)], hasMore: false });
  const s2 = store();
  persistLists('me@example.com', s2);
  listCache.clear();
  hydrateLists('me@example.com', s2);
  assert.deepEqual([...listCache.keys()].map((k) => k.split('\u0000')[1]), ['NEW'], 'the oversized old list was dropped, the recent one kept');
});

test('a broken copy and a full storage never throw; sign-out clears every kept list', () => {
  const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => hydrateLists('me@example.com', bad));
  assert.doesNotThrow(() => persistLists('me@example.com', bad));
  const s = store();
  s.setItem('gm:lists:a@example.com', '[]');
  s.setItem('gm:lists:b@example.com', '[]');
  s.setItem('gm:other', 'keep');
  clearLists(live(s) as unknown as Storage);
  assert.deepEqual(s.keys(), ['gm:other']);
});
