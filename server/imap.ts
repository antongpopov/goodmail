import path from 'node:path';
import type { ImapFlow, ListResponse, FetchMessageObject } from 'imapflow';
import { previewPart, attachments, makeSnippet } from './mime.ts';
import { spamInfo, parseHeaderLines } from './spam.ts';
import { Conn } from './session.ts';
import { checkValidity } from './cache.ts';
import { debugLog } from './debug.ts';

/** The server says our view of the folder is out of date (messages we asked for were expunged since we last synced). */
export function isStaleView(err: unknown): boolean {
  const e = err as { serverResponseCode?: string; responseText?: string; message?: string } | null;
  return /EXPUNGEISSUED|no longer exist/i.test(`${e?.serverResponseCode ?? ''} ${e?.responseText ?? ''} ${e?.message ?? ''}`);
}

export async function withFolder<T>(s: Conn, folder: string, fn: (c: ImapFlow) => Promise<T>, readOnly = false): Promise<T> {
  const t0 = Date.now();
  const c = await s.imapIdle();
  const t1 = Date.now();
  let lock;
  try {
    lock = await c.getMailboxLock(folder, { readOnly });
  } catch (err) {
    s.releaseIdle(c);
    throw err;
  }
  const waited = Date.now() - t0;
  if (waited > 2000) console.warn(`slow open ${s.account.email} ${folder}: connect ${t1 - t0} ms, select ${Date.now() - t1} ms`);
  debugLog({ src: 'server', account: s.account.email, sid: '', text: `open ${folder}: ${t1 - t0} ms to get a connection, ${Date.now() - t1} ms to select`, ms: waited, level: waited > 2000 ? 'slow' : undefined });
  try {
    if (c.mailbox) checkValidity(s.account.email, folder, c.mailbox.uidValidity);
    try {
      return await fn(c);
    } catch (err) {
      // We never sit in IDLE, so a connection does not hear about mail that was deleted elsewhere (Roundcube, a phone, another of our
      // connections) and its sequence numbers can be out of date: the server then refuses with EXPUNGEISSUED / "no longer exist".
      // One NOOP makes it report the expunges; then a read can simply be run again. (Never retry something that changes mail.)
      if (!readOnly || !isStaleView(err)) throw err;
      await c.noop();
      return await fn(c);
    }
  } finally {
    lock.release();
    s.releaseIdle(c);
  }
}

export const folderCache = new WeakMap<Conn, { list: ListResponse[]; at: number }>();

/**
 * Some servers (Gmail's Spam, for one) report an UNSEEN count in STATUS that SEARCH UNSEEN does not agree with, so a folder
 * shows "1" while its Unread list is empty. When we run the unread search ourselves we trust it: remember what STATUS said
 * and what the search found, and show the search result for as long as STATUS keeps saying the same thing.
 */
const unseenFix = new WeakMap<Conn, Map<string, { status: number; real: number }>>();
export function noteUnseen(s: Conn, path: string, real: number) {
  const hit = folderCache.get(s)?.list.find((f) => f.path === path);
  if (!hit?.status || hit.status.unseen === undefined) return;
  const fix = unseenFix.get(s) ?? new Map();
  unseenFix.set(s, fix);
  const known = fix.get(path);
  const status = known && hit.status.unseen === known.real ? known.status : hit.status.unseen;
  if (status === real) fix.delete(path);
  else fix.set(path, { status, real });
  hit.status.unseen = real;
}

/** maxAgeMs: reuse a list younger than this (0 = always ask the server). */
export async function folders(s: Conn, refresh = false, maxAgeMs = 0) {
  const hit = folderCache.get(s);
  if (hit && (!refresh || Date.now() - hit.at < maxAgeMs)) return hit.list;
  const t0 = Date.now();
  const c = await s.imapList();
  const list = await c.list({ statusQuery: { unseen: true, messages: true } });
  if (Date.now() - t0 > 2000) console.warn(`slow folder list ${s.account.email}: ${Date.now() - t0} ms (${list.length} folders)`);
  const fix = unseenFix.get(s);
  if (fix)
    for (const f of list) {
      const o = fix.get(f.path);
      if (!o) continue;
      if (f.status?.unseen === o.status) f.status.unseen = o.real;
      else fix.delete(f.path); // STATUS moved on (new or read mail): trust it again
    }
  folderCache.set(s, { list, at: Date.now() });
  return list;
}

export const NAME_FALLBACK: Record<string, RegExp> = {
  '\\Sent': /^(sent|sent items|sent messages|gesendet|gesendete (objekte|elemente))$/i,
  '\\Trash': /^(trash|deleted|deleted items|deleted messages|papierkorb|gelöschte (objekte|elemente))$/i,
  '\\Junk': /^(junk|spam|junk e-?mail|bulk mail)$/i,
  '\\Drafts': /^(drafts|entwürfe)$/i,
  '\\Archive': /^(archive|archiv)$/i,
};

export async function special(s: Conn, use: string): Promise<string | undefined> {
  const list = await folders(s);
  return (
    list.find((f) => f.specialUse === use)?.path ??
    list.find((f) => NAME_FALLBACK[use]?.test(f.name) || NAME_FALLBACK[use]?.test(f.path.split(f.delimiter).pop()!))
      ?.path
  );
}

// Preview lines are expensive (an extra FETCH per part key), so cache them forever per uid.
export const snippetCache = new Map<string, string>();
export function cacheSnippet(k: string, v: string) {
  snippetCache.set(k, v);
  if (snippetCache.size > 50_000) snippetCache.delete(snippetCache.keys().next().value!);
}

export function summarize(m: FetchMessageObject, snippet: string) {
  const e = m.envelope;
  const from = e?.from?.[0] ?? e?.sender?.[0];
  return {
    uid: m.uid,
    date: new Date(e?.date || m.internalDate || 0).valueOf(),
    from: { name: from?.name || '', address: from?.address || '' },
    to: (e?.to || []).map((a) => ({ name: a.name || '', address: a.address || '' })),
    cc: (e?.cc || []).map((a) => ({ name: a.name || '', address: a.address || '' })),
    subject: e?.subject || '',
    messageId: e?.messageId || '',
    seen: m.flags?.has('\\Seen') ?? false,
    flagged: m.flags?.has('\\Flagged') ?? false,
    answered: m.flags?.has('\\Answered') ?? false,
    hasAttachments: attachments(m.bodyStructure).some((a) => !a.inline),
    size: m.size ?? 0,
    snippet,
    // score from the filter's headers (only the topmost one counts, see spam.ts); null when the server adds none
    spam: spamInfo(parseHeaderLines(m.headers)),
  };
}

/** Where a message's preview text lives, remembered from the list fetch so it can be filled in afterwards (lazy previews). */
const partInfo = new Map<string, NonNullable<ReturnType<typeof previewPart>>>();
function rememberPart(k: string, p: NonNullable<ReturnType<typeof previewPart>>) {
  partInfo.set(k, p);
  if (partInfo.size > 50_000) partInfo.delete(partInfo.keys().next().value!);
}
const snipKey = (s: Conn, folder: string, c: ImapFlow, uid: number) => `${s.account.email}\u0000${folder}\u0000${String((c.mailbox && c.mailbox.uidValidity) || 0)}\u0000${uid}`;

/**
 * Fetch envelopes for a uid/seq range, then preview text grouped by part key (one FETCH per distinct key).
 * lazy: leave the previews out (every extra command costs ~1 s on a throttled server such as Gmail): the messages come back
 * with snippetPending, and fillSnippets() fetches the previews afterwards while the list is already on screen.
 */
export async function listMessages(s: Conn, c: ImapFlow, folder: string, range: string | number[], byUid: boolean, lazy = false) {
  const msgs: FetchMessageObject[] = [];
  for await (const m of c.fetch(
    range,
    { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true, headers: ['x-spamd-result', 'x-rspamd-score', 'x-spam-status', 'x-spam-score'] },
    { uid: byUid },
  ))
    msgs.push(m);

  const validity = String((c.mailbox && c.mailbox.uidValidity) || 0);
  const key = (uid: number) => `${s.account.email}\u0000${folder}\u0000${validity}\u0000${uid}`;
  const needed = new Map<string, number[]>();
  const info = new Map<number, ReturnType<typeof previewPart>>();
  for (const m of msgs) {
    if (snippetCache.has(key(m.uid))) continue;
    const p = previewPart(m.bodyStructure);
    if (!p) {
      cacheSnippet(key(m.uid), '');
      continue;
    }
    if (lazy) {
      rememberPart(key(m.uid), p);
      continue;
    }
    info.set(m.uid, p);
    needed.set(p.key, [...(needed.get(p.key) || []), m.uid]);
  }
  for (const [part, uids] of needed) {
    try {
      for await (const m of c.fetch(uids, { uid: true, bodyParts: [{ key: part, start: 0, maxLength: 2048 }] }, { uid: true })) {
        const p = info.get(m.uid);
        const buf = m.bodyParts?.get(part) ?? m.bodyParts?.values().next().value;
        if (!p || !buf) continue;
        cacheSnippet(key(m.uid), makeSnippet(buf, p.node, p.isHtml, !!m.binaryParts?.has(part)));
      }
    } catch (err) {
      console.warn('snippet fetch failed', part, (err as Error).message);
    }
  }
  return msgs
    .map((m) => {
      const snip = snippetCache.get(key(m.uid));
      const o = summarize(m, snip ?? '');
      return lazy && snip === undefined ? { ...o, snippetPending: true as const } : o;
    })
    .sort((a, b) => b.date - a.date || b.uid - a.uid);
}

/** The previews listMessages(…, lazy) left out: one FETCH per distinct part key, answers { uid: text }. */
export async function fillSnippets(s: Conn, c: ImapFlow, folder: string, uids: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  const need = new Map<string, number[]>();
  for (const uid of uids) {
    const k = snipKey(s, folder, c, uid);
    const have = snippetCache.get(k);
    if (have !== undefined) out[uid] = have;
    else if (partInfo.has(k)) need.set(partInfo.get(k)!.key, [...(need.get(partInfo.get(k)!.key) || []), uid]);
  }
  for (const [part, list] of need) {
    try {
      for await (const m of c.fetch(list, { uid: true, bodyParts: [{ key: part, start: 0, maxLength: 2048 }] }, { uid: true })) {
        const k = snipKey(s, folder, c, m.uid);
        const p = partInfo.get(k);
        const buf = m.bodyParts?.get(part) ?? m.bodyParts?.values().next().value;
        if (!p || !buf) continue;
        const text = makeSnippet(buf, p.node, p.isHtml, !!m.binaryParts?.has(part));
        cacheSnippet(k, text);
        out[m.uid] = text;
      }
    } catch (err) {
      console.warn('snippet fetch failed', part, (err as Error).message);
    }
  }
  for (const uid of uids) if (!(uid in out)) out[uid] = ''; // nothing to show for it
  return out;
}
