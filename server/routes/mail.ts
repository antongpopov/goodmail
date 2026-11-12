import type { ImapFlow } from 'imapflow';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import * as sm from '../smime.ts';
import { nameFor } from '../prefs.ts';
const smimeOn = sm.smimeOn;
import { attachments } from '../mime.ts';
import { bulkCriteria, peopleCriteria } from '../bulk.ts';
import { spamInfo } from '../spam.ts';
import { messageCache, msgKey, dropMessages, patchFlag } from '../cache.ts';
import { Router } from 'express';
import { PAGE, conn, auth, wrap } from '../http.ts';
import { withFolder, folders, NAME_FALLBACK, special, listMessages, fillSnippets, noteUnseen } from '../imap.ts';
import { throttledHost, type Conn } from '../session.ts';

const r = Router();

// ---------- mail ----------

r.get(
  '/api/folders',
  auth,
  wrap(async (req, res) => {
    const list = await folders(conn(req), true, req.query.fresh ? 0 : 20_000);
    res.json(
      list
        .filter((f) => !f.flags?.has('\\Noselect') && !f.flags?.has('\\NonExistent'))
        .map((f) => ({
          path: f.path,
          name: f.path.toUpperCase() === 'INBOX' ? 'Inbox' : f.name,
          delimiter: f.delimiter,
          specialUse: f.specialUse || NAMED_SPECIAL(f.name) || (f.path.toUpperCase() === 'INBOX' ? '\\Inbox' : ''),
          unseen: f.status?.unseen ?? 0,
          total: f.status?.messages ?? 0,
        })),
    );
  }),
);

function NAMED_SPECIAL(name: string) {
  for (const [use, re] of Object.entries(NAME_FALLBACK)) if (re.test(name)) return use;
  return '';
}

/** One page of a folder (or of its search / unread / flagged result), newest first. */
/** Sort UIDs by arrival date (INTERNALDATE): UID order is import order, which is not date order in migrated mailboxes. */
async function byDate(c: ImapFlow, uids: number[], asc: boolean) {
  if (uids.length < 2) return uids;
  const d = new Map<number, number>();
  for await (const m of c.fetch(uids, { uid: true, internalDate: true }, { uid: true })) d.set(m.uid, new Date(m.internalDate || 0).valueOf());
  return uids.slice().sort((a, b) => (asc ? 1 : -1) * ((d.get(a) ?? 0) - (d.get(b) ?? 0) || a - b));
}

async function listPage(cn: Conn, folder: string, page: number, filter: string, q = '', asc = false) {
  const dir = <T extends { date: number; uid: number }>(l: T[]) => (asc ? l.slice().sort((a, b) => a.date - b.date || a.uid - b.uid) : l);
  const lazy = throttledHost(cn.account); // previews come in a second step on a throttled server (Gmail)
  return withFolder(
    cn,
    folder,
    async (c) => {
      if (q) {
        const uids = (await c.search({ or: [{ subject: q }, { from: q }, { to: q }, { body: q }] }, { uid: true })) || [];
        const top = (await byDate(c, uids, asc)).slice(0, 200);
        const messages = top.length ? dir(await listMessages(cn, c, folder, top, true, lazy)) : [];
        return { total: uids.length, messages, hasMore: false };
      }
      if (filter === 'unread' || filter === 'flagged' || filter === 'tome' || filter === 'bulk' || filter === 'people') {
        // Ask the server for every match in the folder, not just the loaded page (big folders like Gmail's All Mail).
        const uids = await byDate(c, (await c.search(filter === 'unread' ? { seen: false } : filter === 'tome' ? { to: cn.account.email } : filter === 'bulk' ? bulkCriteria : filter === 'people' ? peopleCriteria : { flagged: true }, { uid: true })) || [], asc);
        if (filter === 'unread') noteUnseen(cn, folder, uids.length);
        const slice = uids.slice(page * PAGE, (page + 1) * PAGE);
        const messages = slice.length ? dir(await listMessages(cn, c, folder, slice, true, lazy)) : [];
        return { total: uids.length, messages, hasMore: uids.length > (page + 1) * PAGE };
      }
      if (filter === 'attachments') {
        // IMAP cannot search "has an attachment": take messages whose top-level type can carry one, then keep the real ones
        // (listMessages looks at the body structure). A page may therefore come back with fewer than PAGE messages.
        const types = ['multipart/mixed', 'multipart/signed', 'multipart/related', 'application/'];
        const uids = await byDate(c, (await c.search({ or: types.map((v) => ({ header: { 'Content-Type': v } })) }, { uid: true })) || [], asc);
        const slice = uids.slice(page * PAGE, (page + 1) * PAGE);
        const messages = slice.length ? dir((await listMessages(cn, c, folder, slice, true, lazy)).filter((m) => m.hasAttachments)) : [];
        return { total: uids.length, messages, hasMore: uids.length > (page + 1) * PAGE };
      }
      const exists = c.mailbox ? c.mailbox.exists : 0;
      if (asc) {
        const first = 1 + page * PAGE;
        if (first > exists) return { total: exists, messages: [], hasMore: false };
        const last = Math.min(exists, first + PAGE - 1);
        return { total: exists, messages: dir(await listMessages(cn, c, folder, `${first}:${last}`, false, lazy)), hasMore: last < exists };
      }
      const to = exists - page * PAGE;
      if (to < 1) return { total: exists, messages: [], hasMore: false };
      const from = Math.max(1, to - PAGE + 1);
      const messages = await listMessages(cn, c, folder, `${from}:${to}`, false, lazy);
      return { total: exists, messages, hasMore: from > 1 };
    },
    true,
  );
}

// Preview lines for messages a list returned with snippetPending (throttled servers: Gmail)
r.post(
  '/api/snippets',
  auth,
  wrap(async (req, res) => {
    const cn = conn(req);
    const folder = String(req.body?.folder || '');
    const uids = (Array.isArray(req.body?.uids) ? req.body.uids : []).map(Number).filter(Number.isFinite).slice(0, 100);
    if (!folder || !uids.length) return res.json({ snippets: {} });
    res.json({ snippets: await withFolder(cn, folder, (c) => fillSnippets(cn, c, folder, uids), true) });
  }),
);

r.get(
  '/api/messages',
  auth,
  wrap(async (req, res) => {
    res.json(await listPage(conn(req), String(req.query.folder || 'INBOX'), Math.max(0, Number(req.query.page || 0)), String(req.query.filter || ''), '', req.query.order === 'asc'));
  }),
);

r.get(
  '/api/search',
  auth,
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ total: 0, messages: [], hasMore: false });
    res.json(await listPage(conn(req), String(req.query.folder || 'INBOX'), 0, '', q, req.query.order === 'asc'));
  }),
);

/** "All inboxes", "All sent", …: the same kind of folder from several of the user's mailboxes, merged by date. */
const UNIFIED: Record<string, string> = { inbox: 'INBOX', sent: '\\Sent', drafts: '\\Drafts', junk: '\\Junk', trash: '\\Trash', archive: '\\Archive' };
const UNIFIED_TIMEOUT_MS = 20_000;
r.get(
  '/api/unified',
  auth,
  wrap(async (req, res) => {
    const use = UNIFIED[String(req.query.kind || 'inbox')];
    if (!use) return res.status(400).json({ error: 'unknown kind' });
    const page = Math.max(0, Number(req.query.page || 0));
    const filter = String(req.query.filter || '');
    const q = String(req.query.q || '').trim();
    const asc = req.query.order === 'asc';
    const ids = [...new Set(String(req.query.accounts || 'main').split(',').filter(Boolean))].slice(0, 12);
    const errors: { account: string; error: string }[] = [];
    const parts = await Promise.all(
      ids.map(async (id) => {
        const cn = req.session.acct(id);
        if (!cn) return null;
        try {
          const folder = use === 'INBOX' ? 'INBOX' : await special(cn, use);
          if (!folder) return null;
          const out = await Promise.race([
            listPage(cn, folder, page, filter, q, asc),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), UNIFIED_TIMEOUT_MS)),
          ]);
          return { id, folder, ...out };
        } catch (err) {
          errors.push({ account: id, error: (err as Error).message });
          return null;
        }
      }),
    );
    const got = parts.filter((p): p is NonNullable<typeof p> => !!p);
    const messages = got
      .flatMap((p) => p.messages.map((m) => ({ ...m, account: p.id, folder: p.folder })))
      .sort((a, b) => (asc ? a.date - b.date : b.date - a.date));
    res.json({ total: got.reduce((n, p) => n + p.total, 0), messages, hasMore: got.some((p) => p.hasMore), errors });
  }),
);

/** S/MIME: verify a signed message, or decrypt an encrypted one with the user's certificate. */
async function openSecure(session: any, source: Buffer, parsed: Awaited<ReturnType<typeof simpleParser>>) {
  if (!smimeOn()) return undefined;
  const ct = parsed.headers.get('content-type') as { value?: string; params?: Record<string, string> } | undefined;
  const kind = sm.kindOf(ct?.value || '', ct?.params || {});
  if (!kind) return undefined;
  const me = session.account.email as string;
  const from = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  const signedInfo = async (raw: Buffer) => {
    const v = await sm.verify(raw, from);
    if (v.status === 'ok' && v.pem) void sm.rememberCert(me, v.pem).catch(() => {});
    return { status: v.status, signer: v.signer };
  };
  if (kind === 'signed') return { info: { signed: await signedInfo(source) } };
  if (kind === 'opaque') {
    const v = await sm.verify(source, from);
    if (!v.content) return { info: { signed: { status: v.status, signer: v.signer } } };
    if (v.status === 'ok' && v.pem) void sm.rememberCert(me, v.pem).catch(() => {});
    const inner = await simpleParser(sm.rebuild(source, v.content));
    return { parsed: inner, attachments: innerAttachments(inner), info: { signed: { status: v.status, signer: v.signer } } };
  }
  // encrypted
  const rec = await sm.loadUserCert(me);
  if (!rec || !session.userKey) return { info: { encrypted: true, readable: false, reason: 'no-certificate' } };
  const plain = await sm.decrypt(source, rec, session.userKey);
  if (!plain) return { info: { encrypted: true, readable: false, reason: 'not-for-you' } };
  const rebuilt = sm.rebuild(source, plain);
  const inner = await simpleParser(rebuilt);
  const ict = inner.headers.get('content-type') as { value?: string; params?: Record<string, string> } | undefined;
  const ikind = sm.kindOf(ict?.value || '', ict?.params || {});
  let signed;
  if (ikind === 'signed') signed = await signedInfo(rebuilt);
  return { parsed: inner, attachments: innerAttachments(inner), info: { encrypted: true, readable: true, signed } };
}

/** Attachments of a decrypted message: they can't be fetched by IMAP part number, so they are addressed by index. */
function innerAttachments(p: Awaited<ReturnType<typeof simpleParser>>) {
  const used = new Set(p.attachments.filter((a) => a.related && a.cid).map((a) => a.cid!.replace(/^<|>$/g, '')));
  return p.attachments
    .map((a, i) => ({ part: `smime:${i}`, filename: a.filename || 'attachment', type: a.contentType, size: a.size, cid: a.cid?.replace(/^<|>$/g, ''), inline: a.contentDisposition === 'inline' }))
    .filter((a) => !(a.cid && used.has(a.cid)) && !/pkcs7-signature/i.test(a.type || ''));
}

r.get(
  '/api/message',
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder || 'INBOX');
    const uid = Number(req.query.uid);
    const peek = req.query.peek === '1'; // prefetch: don't mark as read
    const cn = conn(req);
    const key = msgKey(cn.account.email, folder, uid);
    const cached = messageCache.get(key);
    if (cached) {
      res.json(cached);
      if (!peek && !cached.seen) {
        cached.seen = true;
        void withFolder(cn, folder, (c) => c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })).catch(() => {});
      }
      return;
    }
    const out = await withFolder(cn, folder, async (c) => {
      const m = await c.fetchOne(String(uid), { uid: true, source: true, bodyStructure: true, flags: true, envelope: true }, { uid: true });
      if (!m || !m.source) throw Object.assign(new Error('message not found'), { status: 404 });
      let parsed = await simpleParser(m.source);
      const secure = cn === req.session ? await openSecure(req.session, m.source, parsed) : undefined;
      if (secure?.parsed) parsed = secure.parsed;
      const wasSeen = m.flags?.has('\\Seen') ?? false;
      if (!peek && !wasSeen) await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      const sourceBytes = m.source.length;
      const addr = (v: any) =>
        (Array.isArray(v) ? v : v ? [v] : []).flatMap((x: any) => x.value || []).map((a: any) => ({ name: a.name || '', address: a.address || '' }));
      // mailparser inlines cid: images as data URIs and marks those attachments `related`.
      const usedCids = new Set(parsed.attachments.filter((a) => a.related && a.cid).map((a) => a.cid!.replace(/^<|>$/g, '')));
      return {
        uid,
        folder,
        subject: parsed.subject || '',
        date: (parsed.date || m.envelope?.date || new Date()).valueOf(),
        from: addr(parsed.from)[0] || { name: '', address: '' },
        to: addr(parsed.to),
        cc: addr(parsed.cc),
        replyTo: addr(parsed.replyTo),
        messageId: parsed.messageId || '',
        references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
        html: parsed.html || '',
        text: parsed.text || '',
        flagged: m.flags?.has('\\Flagged') ?? false,
        spam: spamInfo(parsed.headerLines),
        listUnsubscribe: parsed.headers.get('list-unsubscribe') ? String((parsed.headers.get('list-unsubscribe') as any)?.url || '') : '',
        // cid-referenced parts are already embedded in the HTML by mailparser; list everything else.
        attachments: secure?.attachments ?? attachments(m.bodyStructure).filter((a) => !(a.cid && usedCids.has(a.cid)) && !/pkcs7-signature/i.test(a.type || '') && !/^smime\.p7s$/i.test(a.filename || '')),
        smime: secure?.info,
        _nocache: !!secure?.parsed,
        seen: wasSeen || !peek,
        _bytes: sourceBytes,
      };
    });
    const { _bytes, _nocache, ...msg } = out;
    if (!_nocache) messageCache.set(key, msg, Math.max(_bytes, (msg.html?.length || 0) + (msg.text?.length || 0)) * 2);
    res.json(msg);
  }),
);

r.get(
  '/api/headers',
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder || 'INBOX');
    const uid = String(Number(req.query.uid));
    const text = await withFolder(conn(req), folder, async (c) => {
      const m = await c.fetchOne(uid, { uid: true, headers: true }, { uid: true });
      if (!m || !m.headers) throw Object.assign(new Error('message not found'), { status: 404 });
      return m.headers.toString('utf8').replace(/\r?\n$/, '').replace(/\r?\n$/, '');
    });
    res.json({ headers: text });
  }),
);

r.get(
  '/api/attachment',
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder || 'INBOX');
    const uid = String(Number(req.query.uid));
    const part = String(req.query.part || '1');
    const sx = /^smime:(\d+)$/.exec(part);
    if (sx) {
      // an attachment inside an encrypted / opaque-signed message: decrypt again and serve it by index
      const cn = conn(req);
      if (cn !== req.session) return res.status(400).json({ error: 'bad part' });
      const att = await withFolder(cn, folder, async (c) => {
        const m = await c.fetchOne(uid, { source: true }, { uid: true });
        if (!m || !m.source) return undefined;
        const sec = await openSecure(req.session, m.source, await simpleParser(m.source));
        return sec?.parsed?.attachments[Number(sx[1])];
      });
      if (!att) return res.status(404).json({ error: 'attachment not found' });
      const name = String(req.query.name || att.filename || 'attachment').replace(/[\r\n"]/g, '');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
      return res.end(att.content);
    }
    if (!/^[0-9.]+$/.test(part)) return res.status(400).json({ error: 'bad part' });
    await withFolder(conn(req), folder, async (c) => {
      const dl = await c.download(uid, part, { uid: true });
      if (!dl?.content) throw Object.assign(new Error('attachment not found'), { status: 404 });
      const content = dl.content;
      const name = String(req.query.name || dl.meta?.filename || 'attachment').replace(/[\r\n"]/g, '');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
      await new Promise<void>((resolve, reject) => {
        content.on('error', reject).on('end', resolve).pipe(res);
      });
    }, true);
  }),
);

function uidList(b: any): string {
  const uids = (Array.isArray(b?.uids) ? b.uids : [b?.uid]).map(Number).filter((n: number) => n > 0);
  if (!uids.length) throw Object.assign(new Error('no uids'), { status: 400 });
  return uids.join(',');
}

r.post(
  '/api/flags',
  auth,
  wrap(async (req, res) => {
    const { folder = 'INBOX', add = [], remove = [] } = req.body || {};
    const allowed = new Set(['\\Seen', '\\Flagged', '\\Answered']);
    const uids = uidList(req.body);
    await withFolder(conn(req), folder, async (c) => {
      const a = add.filter((f: string) => allowed.has(f));
      const r = remove.filter((f: string) => allowed.has(f));
      if (a.length) await c.messageFlagsAdd(uids, a, { uid: true });
      if (r.length) await c.messageFlagsRemove(uids, r, { uid: true });
    });
    const nums = uids.split(',').map(Number);
    if (add.includes('\\Flagged')) patchFlag(conn(req).account.email, folder, nums, true);
    if (remove.includes('\\Flagged')) patchFlag(conn(req).account.email, folder, nums, false);
    res.json({ ok: true });
  }),
);

r.post(
  '/api/move',
  auth,
  wrap(async (req, res) => {
    const { folder = 'INBOX', to } = req.body || {};
    const uids = uidList(req.body);
    let dest: string | undefined = to;
    if (to === 'archive' || to === 'junk') {
      dest = await special(conn(req), to === 'archive' ? '\\Archive' : '\\Junk');
      if (!dest && to === 'archive') {
        const c = await conn(req).imap();
        await c.mailboxCreate('Archive').catch(() => {});
        await folders(conn(req), true);
        dest = 'Archive';
      }
    }
    if (!dest) return res.status(400).json({ error: `no ${to} folder on this server` });
    await withFolder(conn(req), folder, (c) => c.messageMove(uids, dest!, { uid: true }));
    dropMessages(conn(req).account.email, folder, uids.split(',').map(Number));
    res.json({ ok: true, to: dest });
  }),
);

/** Move or copy messages to a folder of the same or ANOTHER of the user's mailboxes (the full message is read and appended there). */
const TRANSFER_MAX = 60 * 1024 * 1024;
r.post(
  '/api/transfer',
  auth,
  wrap(async (req, res) => {
    const { folder = 'INBOX', to, toAccount = 'main', move = false } = req.body || {};
    if (!to || typeof to !== 'string') return res.status(400).json({ error: 'destination folder required' });
    const src = conn(req);
    const dst = req.session.acct(String(toAccount));
    if (!dst) return res.status(404).json({ error: 'That account is no longer available — refresh the page' });
    const uids = uidList(req.body);
    const nums = uids.split(',').map(Number);
    const same = dst === src;
    if (same && to === folder) return res.status(400).json({ error: 'The message is already in that folder' });
    let count = 0;
    await withFolder(src, folder, async (c) => {
      if (same) {
        await c.messageCopy(uids, to, { uid: true });
        count = nums.length;
      } else {
        const dc = await dst.imap();
        for (const uid of nums) {
          const m = await c.fetchOne(String(uid), { source: true, flags: true, internalDate: true, size: true }, { uid: true });
          if (!m || !m.source) continue;
          if ((m.size ?? m.source.length) > TRANSFER_MAX) throw Object.assign(new Error('That message is too large to transfer'), { status: 413 });
          const keep = [...(m.flags || [])].filter((f) => ['\\Seen', '\\Flagged', '\\Answered', '\\Draft'].includes(f));
          await dc.append(to, m.source, keep, m.internalDate instanceof Date ? m.internalDate : undefined);
          count++;
        }
      }
      if (move && !same && count) {
        // The copy is in place: take the originals out of the source the way "Delete" does (to Trash when there is one).
        const trash = await special(src, '\\Trash');
        if (trash && trash !== folder) await c.messageMove(uids, trash, { uid: true });
        else await c.messageDelete(uids, { uid: true });
      }
    });
    if (move && !same) dropMessages(src.account.email, folder, nums);
    res.json({ ok: true, count });
  }),
);

r.post(
  '/api/delete',
  auth,
  wrap(async (req, res) => {
    const { folder = 'INBOX' } = req.body || {};
    const uids = uidList(req.body);
    const trash = await special(conn(req), '\\Trash');
    await withFolder(conn(req), folder, async (c) => {
      if (trash && trash !== folder) await c.messageMove(uids, trash, { uid: true });
      else await c.messageDelete(uids, { uid: true });
    });
    dropMessages(conn(req).account.email, folder, uids.split(',').map(Number));
    res.json({ ok: true, permanent: !trash || trash === folder });
  }),
);

r.post(
  '/api/folder',
  auth,
  wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const c = await conn(req).imap();
    await c.mailboxCreate(name);
    res.json({ ok: true });
  }),
);

/** Folders the server or the user's mail apps rely on: never renamed or deleted from here. */
async function userFolder(c: Awaited<ReturnType<typeof import('../session.ts').Conn.prototype.imap>>, path: string) {
  if (!path || /^inbox$/i.test(path)) throw Object.assign(new Error('This folder cannot be changed'), { status: 400 });
  const list = await c.list();
  const f = list.find((x) => x.path === path);
  if (!f) throw Object.assign(new Error('That folder no longer exists'), { status: 404 });
  if (f.specialUse) throw Object.assign(new Error('This folder cannot be changed'), { status: 400 });
  return { f, list };
}

r.post(
  '/api/folder/rename',
  auth,
  wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name || /[\u0000-\u001f]/.test(name)) return res.status(400).json({ error: 'name required' });
    const c = await conn(req).imap();
    const { f } = await userFolder(c, String(req.body?.path || ''));
    if (f.delimiter && name.includes(f.delimiter)) return res.status(400).json({ error: `The name may not contain "${f.delimiter}"` });
    const parent = f.delimiter ? f.path.split(f.delimiter).slice(0, -1).join(f.delimiter) : '';
    const to = parent ? `${parent}${f.delimiter}${name}` : name;
    if (to === f.path) return res.json({ path: to });
    await c.mailboxRename(f.path, to);
    res.json({ path: to });
  }),
);

/** Drag-and-drop: move a folder (with its subfolders) under another folder, or to the top level (parent = ""). */
r.post(
  '/api/folder/move',
  auth,
  wrap(async (req, res) => {
    const c = await conn(req).imap();
    const { f, list } = await userFolder(c, String(req.body?.path || ''));
    const d = f.delimiter || '/';
    const parent = String(req.body?.parent || '');
    if (parent) {
      if (!list.some((x) => x.path === parent)) return res.status(404).json({ error: 'That folder no longer exists' });
      if (parent === f.path || parent.startsWith(f.path + d)) return res.status(400).json({ error: "A folder can't go into itself" });
    }
    const leaf = f.path.split(d).pop()!;
    const to = parent ? `${parent}${d}${leaf}` : leaf;
    if (to === f.path) return res.json({ path: to });
    if (list.some((x) => x.path === to)) return res.status(400).json({ error: 'A folder with that name is already there' });
    await c.mailboxRename(f.path, to);
    res.json({ path: to });
  }),
);

/** Delete = move into Trash (like Outlook); a folder that is already in Trash is removed for good. */
r.post(
  '/api/folder/delete',
  auth,
  wrap(async (req, res) => {
    const c = await conn(req).imap();
    const { f, list } = await userFolder(c, String(req.body?.path || ''));
    const trash = list.find((x) => x.specialUse === '\\Trash');
    const d = f.delimiter || '/';
    if (!trash || f.path.startsWith(trash.path + d)) {
      await c.mailboxDelete(f.path);
      return res.json({ permanent: true });
    }
    const leaf = f.path.split(d).pop()!;
    const taken = new Set(list.map((x) => x.path));
    let to = `${trash.path}${d}${leaf}`;
    for (let i = 2; taken.has(to); i++) to = `${trash.path}${d}${leaf} (${i})`;
    await c.mailboxRename(f.path, to);
    res.json({ permanent: false, path: to });
  }),
);

/** Sign and/or encrypt an outgoing message. Encrypting needs a certificate for every recipient (and our own, to read the Sent copy). */
async function smimeProtect(session: any, raw: Buffer, envelope: any, sign: boolean, encrypt: boolean) {
  const me = session.account.email as string;
  const rec = await sm.loadUserCert(me);
  if (!rec || !session.userKey) throw Object.assign(new Error('Set up your S/MIME certificate first (⚙ → Secure mail)'), { status: 409 });
  let encryptTo: string[] | undefined;
  if (encrypt) {
    const missing: string[] = [];
    encryptTo = [rec.cert];
    for (const a of (envelope.to || []) as string[]) {
      const pem = await sm.certFor(me, a);
      if (pem) encryptTo.push(pem);
      else missing.push(a);
    }
    if (missing.length) throw Object.assign(new Error(`No certificate for ${missing.join(', ')}, so the message can't be encrypted`), { status: 409, missing });
  }
  return sm.protect(raw, { sign: sign ? { rec, userKey: session.userKey } : undefined, encryptTo });
}

const SERVER_SAVES_SENT = /(^|\.)(gmail\.com|googlemail\.com|office365\.com|outlook\.com)$/i;

r.post(
  '/api/send',
  auth,
  wrap(async (req, res) => {
    const s = conn(req);
    const b = req.body || {};
    const fromName = s === req.session ? await nameFor(s.account.email, s.account.name) : s.account.name;
    const from = fromName ? { name: fromName, address: s.account.email } : s.account.email;
    const mail = {
      from,
      to: b.to,
      cc: b.cc || undefined,
      bcc: b.bcc || undefined,
      subject: b.subject || '',
      html: b.html || undefined,
      text: b.text || undefined,
      inReplyTo: b.inReplyTo || undefined,
      references: b.references || undefined,
      attachments: (b.attachments || []).map((a: any) => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
        contentType: a.type || undefined,
      })),
    };
    // Build the message once so the copy we save to Sent is byte-identical to what went out.
    const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(mail);
    let raw = built.message as Buffer;
    if ((b.sign || b.encrypt) && sm.smimeOn()) {
      if (s !== req.session) return res.status(400).json({ error: 'S/MIME works for your main mailbox only' });
      raw = await smimeProtect(req.session, raw, built.envelope, !!b.sign, !!b.encrypt);
    }
    await s.smtp().sendMail({ envelope: built.envelope, raw });
    if (!SERVER_SAVES_SENT.test(s.account.smtpHost)) {
      const sent = await special(s, '\\Sent');
      if (sent) await (await s.imap()).append(sent, raw, ['\\Seen']).catch((e) => console.warn('save to Sent failed', e.message));
    }
    if (b.replyTo?.uid && b.replyTo?.folder) {
      const rc = req.session.acct(b.replyTo.account) ?? s;
      await withFolder(rc, b.replyTo.folder, (c) => c.messageFlagsAdd(String(b.replyTo.uid), ['\\Answered'], { uid: true })).catch(() => {});
    }
    res.json({ ok: true, messageId: built.messageId });
  }),
);

export default r;
