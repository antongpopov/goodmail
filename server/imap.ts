import path from 'node:path';
import type { ImapFlow, ListResponse, FetchMessageObject } from 'imapflow';
import { previewPart, attachments, makeSnippet } from './mime.ts';
import { spamInfo, parseHeaderLines } from './spam.ts';
import { Conn } from './session.ts';
import { checkValidity } from './cache.ts';

export async function withFolder<T>(s: Conn, folder: string, fn: (c: ImapFlow) => Promise<T>, readOnly = false): Promise<T> {
  const c = await s.imap();
  const lock = await c.getMailboxLock(folder, { readOnly });
  try {
    if (c.mailbox) checkValidity(s.account.email, folder, c.mailbox.uidValidity);
    return await fn(c);
  } finally {
    lock.release();
  }
}

export const folderCache = new WeakMap<Conn, { list: ListResponse[]; at: number }>();

/** maxAgeMs: reuse a list younger than this (0 = always ask the server). */
export async function folders(s: Conn, refresh = false, maxAgeMs = 0) {
  const hit = folderCache.get(s);
  if (hit && (!refresh || Date.now() - hit.at < maxAgeMs)) return hit.list;
  const c = await s.imap();
  const list = await c.list({ statusQuery: { unseen: true, messages: true } });
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

/** Fetch envelopes for a uid/seq range, then preview text grouped by part key (one FETCH per distinct key). */
export async function listMessages(s: Conn, c: ImapFlow, folder: string, range: string | number[], byUid: boolean) {
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
  return msgs.map((m) => summarize(m, snippetCache.get(key(m.uid)) ?? '')).sort((a, b) => b.date - a.date || b.uid - a.uid);
}
