import type { Message, Summary } from './api.ts';

// Browser-side caches so switching folders and opening mail is instant on slow servers.
// Lists show the last copy immediately and refresh behind it; messages never change for a UID.
export const listCache = new Map<string, { messages: Summary[]; hasMore: boolean }>();
export const msgCache = new Map<string, Message>();
export const msgKey = (acct: string, folder: string, uid: number) => `${acct}\u0000${folder}\u0000${uid}`;
export function rememberMsg(k: string, m: Message) {
  msgCache.delete(k);
  msgCache.set(k, m);
  if (msgCache.size > 300) msgCache.delete(msgCache.keys().next().value!);
}

/** Put a list in (or back at the end of) the cache, so the least recently used ones are the first to go. */
export function rememberList(k: string, v: { messages: Summary[]; hasMore: boolean }) {
  listCache.delete(k);
  listCache.set(k, v);
  if (listCache.size > 60) listCache.delete(listCache.keys().next().value!);
}

// Message lists survive a page reload in sessionStorage: per tab, per user, gone when the tab closes or the user signs out,
// and never more than a megabyte or so. (Nothing is kept on the server's disk; this is the browser's own copy.)
const LISTS = 'gm:lists:';
const MAX_LISTS = 16;
const MAX_CHARS = 1_000_000;
const listsKey = (email: string) => LISTS + email.toLowerCase();
/** A list cache key is `${account}\0${folder}\0${search}\0${filter}\0${order}`: searches are not kept. */
const isSearch = (k: string) => (k.split('\u0000')[2] ?? '') !== '';

export function persistLists(email: string, store: Pick<Storage, 'setItem'> = sessionStorage) {
  try {
    const entries = [...listCache].filter(([k]) => !isSearch(k)).slice(-MAX_LISTS);
    let json = JSON.stringify(entries);
    while (json.length > MAX_CHARS && entries.length > 1) {
      entries.shift();
      json = JSON.stringify(entries);
    }
    store.setItem(listsKey(email), json);
  } catch {
    /* storage full or unavailable: the lists are just not kept */
  }
}

export function hydrateLists(email: string, store: Pick<Storage, 'getItem'> = sessionStorage) {
  try {
    const raw = store.getItem(listsKey(email));
    if (!raw) return;
    for (const [k, v] of JSON.parse(raw) as [string, { messages: Summary[]; hasMore: boolean }][]) if (!listCache.has(k) && Array.isArray(v?.messages)) listCache.set(k, v);
  } catch {
    /* unreadable copy: start empty */
  }
}

/** Sign-out: forget every kept list (of every user that used this tab). */
export function clearLists(store: Storage = sessionStorage) {
  try {
    for (const k of Object.keys(store).filter((x) => x.startsWith(LISTS))) store.removeItem(k);
  } catch {
    /* ignore */
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Save a moment after the last change (and always on page hide, see App). */
export function persistSoon(email: string) {
  clearTimeout(timer);
  timer = setTimeout(() => persistLists(email), 1500);
}
