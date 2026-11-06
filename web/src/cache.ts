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
