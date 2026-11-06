// goodmail — webmail for any IMAP server. Copyright (C) 2026 Anton Popov
// SPDX-License-Identifier: AGPL-3.0-or-later
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import type { ImapFlow, ListResponse, MessageStructureObject, FetchMessageObject } from 'imapflow';
import { Session, addSession, getSession, dropSession, connectImap } from './session.ts';
import type { Conn } from './session.ts';
import { attachAccounts, listAccounts, addAccount, removeAccount } from './accounts.ts';
import { guessSettings } from './autoconfig.ts';
import type { Account } from './session.ts';
import crypto from 'node:crypto';
import { serversFor, appTitle, titleFor, normalizeLogin } from './config.ts';
import { seal, unseal, userKey } from './vault.ts';
import { previewPart, attachments, makeSnippet } from './mime.ts';
import { spamInfo } from './spam.ts';
import { messageCache, msgKey, checkValidity, dropMessages, patchFlag } from './cache.ts';
import { loadEvents, saveEvent, deleteEvents, importEvents, parseIcs, toIcs } from './calendar.ts';
import { loadContacts, saveContact, deleteContacts, importContacts, parseVCard, parseCsv, toVCard, toCsv } from './contacts.ts';

const PORT = Number(process.env.PORT || 3000);
const PAGE = 50;
const COOKIE = 'gm_auth';
const YEAR = 365 * 24 * 3600;
const SECURE_COOKIE = process.env.GOODMAIL_INSECURE_COOKIE !== 'true' && process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.GOODMAIL_TRUST_PROXY === 'true');
app.use(express.json({ limit: '40mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; frame-src 'self' blob: about:; connect-src 'self'; object-src 'none'; base-uri 'self'",
  );
  next();
});

// ---------- helpers ----------

function cookie(req: Request, name: string) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

type Authed = Request & { session: Session };

/** The mailbox a mail request is about: ?account= / body.account, default the login mailbox. */
function conn(req: Authed): Conn {
  const id = String((req.method === 'GET' ? req.query.account : req.body?.account) || 'main');
  const c = req.session.acct(id);
  if (!c) throw Object.assign(new Error('That account is no longer available — refresh the page'), { status: 404 });
  return c;
}

function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  // Browsers can't send custom headers cross-site without a CORS preflight we never approve.
  if (req.method !== 'GET' && req.get('x-goodmail') !== '1') return res.status(403).json({ error: 'csrf' });
  next();
}
app.use('/api', requireCsrfHeader);

const tokenId = (t: string) => crypto.createHash('sha256').update(t).digest('base64url');

async function accountFor(email: string, pass: string): Promise<Account | undefined> {
  const srv = await serversFor(email);
  if (!srv) return undefined;
  const { login, ...rest } = srv;
  return { email, name: '', user: login === 'local' ? email.split('@')[0] : email, pass, ...rest };
}

async function auth(req: Request, res: Response, next: NextFunction) {
  const token = cookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: 'not logged in' });
  const id = tokenId(token);
  let s = getSession(id);
  if (!s) {
    // Unknown to this process (restart, or idle-expired): rebuild from the sealed cookie.
    const v = unseal(token);
    const account = v && (await accountFor(v.email, v.pass).catch(() => undefined));
    if (!account) return res.status(401).json({ error: 'not logged in' });
    s = new Session(account, id);
    s.userKey = userKey(v!.email, v!.pass);
    await attachAccounts(s).catch((e) => console.warn('extra accounts:', e.message));
    addSession(s);
  }
  (req as Authed).session = s;
  next();
}

const wrap =
  (fn: (req: Authed, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
    fn(req as Authed, res).catch((err: any) => {
      console.error(err);
      if (!res.headersSent)
        res.status(err?.status || 500).json({ error: err?.responseText || err?.message || 'server error' });
    });

async function withFolder<T>(s: Conn, folder: string, fn: (c: ImapFlow) => Promise<T>, readOnly = false): Promise<T> {
  const c = await s.imap();
  const lock = await c.getMailboxLock(folder, { readOnly });
  try {
    if (c.mailbox) checkValidity(s.account.email, folder, c.mailbox.uidValidity);
    return await fn(c);
  } finally {
    lock.release();
  }
}

const folderCache = new WeakMap<Conn, { list: ListResponse[]; at: number }>();

/** maxAgeMs: reuse a list younger than this (0 = always ask the server). */
async function folders(s: Conn, refresh = false, maxAgeMs = 0) {
  const hit = folderCache.get(s);
  if (hit && (!refresh || Date.now() - hit.at < maxAgeMs)) return hit.list;
  const c = await s.imap();
  const list = await c.list({ statusQuery: { unseen: true, messages: true } });
  folderCache.set(s, { list, at: Date.now() });
  return list;
}

const NAME_FALLBACK: Record<string, RegExp> = {
  '\\Sent': /^(sent|sent items|sent messages|gesendet|gesendete (objekte|elemente))$/i,
  '\\Trash': /^(trash|deleted|deleted items|deleted messages|papierkorb|gelöschte (objekte|elemente))$/i,
  '\\Junk': /^(junk|spam|junk e-?mail|bulk mail)$/i,
  '\\Drafts': /^(drafts|entwürfe)$/i,
  '\\Archive': /^(archive|archiv)$/i,
};

async function special(s: Conn, use: string): Promise<string | undefined> {
  const list = await folders(s);
  return (
    list.find((f) => f.specialUse === use)?.path ??
    list.find((f) => NAME_FALLBACK[use]?.test(f.name) || NAME_FALLBACK[use]?.test(f.path.split(f.delimiter).pop()!))
      ?.path
  );
}

// Preview lines are expensive (an extra FETCH per part key), so cache them forever per uid.
const snippetCache = new Map<string, string>();
function cacheSnippet(k: string, v: string) {
  snippetCache.set(k, v);
  if (snippetCache.size > 50_000) snippetCache.delete(snippetCache.keys().next().value!);
}

function summarize(m: FetchMessageObject, snippet: string) {
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
  };
}

/** Fetch envelopes for a uid/seq range, then preview text grouped by part key (one FETCH per distinct key). */
async function listMessages(s: Conn, c: ImapFlow, folder: string, range: string | number[], byUid: boolean) {
  const msgs: FetchMessageObject[] = [];
  for await (const m of c.fetch(
    range,
    { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true },
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

// ---------- auth ----------

const attempts = new Map<string, { n: number; t: number }>();
function throttled(ip: string) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.t > 15 * 60_000) {
    attempts.set(ip, { n: 1, t: now });
    return false;
  }
  a.n++;
  return a.n > 10;
}

app.get('/api/config', (_req, res) => {
  res.json({ appName: appTitle(), source: process.env.GOODMAIL_SOURCE_URL || 'https://github.com/antongpopov/goodmail' });
});

app.post(
  '/api/login',
  wrap(async (req, res) => {
    if (throttled(req.ip || '?')) return res.status(429).json({ error: 'Too many attempts, try again in 15 minutes' });
    const b = req.body || {};
    const email = normalizeLogin(String(b.email || ''));
    const pass = String(b.password || '');
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !pass) return res.status(400).json({ error: 'Enter your email address and password' });
    const account = await accountFor(email, pass);
    if (!account) return res.status(403).json({ error: `This server doesn't handle mail for ${email.split('@')[1]}` });
    let client: ImapFlow;
    try {
      client = await connectImap(account);
    } catch (err: any) {
      console.warn(`login failed for ${email} at ${account.imapHost}:${account.imapPort}:`, err?.responseText || err?.message);
      const msg = err?.authenticationFailed ? 'Wrong email address or password' : `Can't reach the mail server (${err?.code || err?.message || 'error'})`;
      return res.status(401).json({ error: msg });
    }
    await client.logout().catch(() => {});
    attempts.delete(req.ip || '?');
    const remember = b.remember !== false;
    const token = seal({ email, pass, exp: Date.now() + (remember ? YEAR : 12 * 3600) * 1000 });
    const sess = new Session(account, tokenId(token));
    sess.userKey = userKey(email, pass);
    await attachAccounts(sess).catch((e) => console.warn('extra accounts:', e.message));
    addSession(sess);
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${remember ? `; Max-Age=${YEAR}` : ''}${SECURE_COOKIE ? '; Secure' : ''}`,
    );
    res.json({ email: account.email, name: account.name, imapHost: account.imapHost, appName: titleFor(account.email) });
  }),
);

app.post('/api/logout', async (req, res) => {
  const token = cookie(req, COOKIE);
  if (token) await dropSession(tokenId(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const a = (req as Authed).session.account;
  res.json({ email: a.email, name: a.name, imapHost: a.imapHost, appName: titleFor(a.email) });
});

// ---------- mail ----------

app.get(
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

app.get(
  '/api/messages',
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder || 'INBOX');
    const page = Math.max(0, Number(req.query.page || 0));
    const out = await withFolder(
      conn(req),
      folder,
      async (c) => {
        const exists = c.mailbox ? c.mailbox.exists : 0;
        const to = exists - page * PAGE;
        if (to < 1) return { total: exists, messages: [], hasMore: false };
        const from = Math.max(1, to - PAGE + 1);
        const messages = await listMessages(conn(req), c, folder, `${from}:${to}`, false);
        return { total: exists, messages, hasMore: from > 1 };
      },
      true,
    );
    res.json(out);
  }),
);

app.get(
  '/api/search',
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder || 'INBOX');
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ total: 0, messages: [], hasMore: false });
    const out = await withFolder(
      conn(req),
      folder,
      async (c) => {
        const uids = (await c.search({ or: [{ subject: q }, { from: q }, { to: q }, { body: q }] }, { uid: true })) || [];
        const top = uids.sort((a, b) => b - a).slice(0, 200);
        const messages = top.length ? await listMessages(conn(req), c, folder, top, true) : [];
        return { total: uids.length, messages, hasMore: false };
      },
      true,
    );
    res.json(out);
  }),
);

app.get(
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
      const parsed = await simpleParser(m.source);
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
        attachments: attachments(m.bodyStructure).filter((a) => !(a.cid && usedCids.has(a.cid))),
        seen: wasSeen || !peek,
        _bytes: sourceBytes,
      };
    });
    const { _bytes, ...msg } = out;
    messageCache.set(key, msg, Math.max(_bytes, (msg.html?.length || 0) + (msg.text?.length || 0)) * 2);
    res.json(msg);
  }),
);

app.get(
  '/api/attachment',
  auth,
  wrap(async (req, res) => {
    const folder = String(req.query.folder || 'INBOX');
    const uid = String(Number(req.query.uid));
    const part = String(req.query.part || '1');
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

app.post(
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

app.post(
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

app.post(
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

app.post(
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

const SERVER_SAVES_SENT = /(^|\.)(gmail\.com|googlemail\.com|office365\.com|outlook\.com)$/i;

app.post(
  '/api/send',
  auth,
  wrap(async (req, res) => {
    const s = conn(req);
    const b = req.body || {};
    const from = s.account.name ? { name: s.account.name, address: s.account.email } : s.account.email;
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
    const raw = built.message as Buffer;
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

// ---------- extra accounts (user-managed) ----------

app.get(
  '/api/accounts',
  auth,
  wrap(async (req, res) => {
    const a = req.session.account;
    res.json([{ id: 'main', email: a.email, name: a.name, provider: 'main', imapHost: a.imapHost, locked: false }, ...(await listAccounts(req.session))]);
  }),
);

app.post(
  '/api/accounts',
  auth,
  wrap(async (req, res) => {
    res.json(await addAccount(req.session, req.body || {}));
  }),
);

app.post(
  '/api/accounts/delete',
  auth,
  wrap(async (req, res) => {
    await removeAccount(req.session, String(req.body?.id || ''));
    res.json({ ok: true });
  }),
);

app.post(
  '/api/accounts/guess',
  auth,
  wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid email' });
    res.json(await guessSettings(email, { skipDomainAutoconfig: true }));
  }),
);

// ---------- address book ----------

app.get(
  '/api/contacts',
  auth,
  wrap(async (req, res) => {
    res.json(await loadContacts(req.session.account.email));
  }),
);

app.post(
  '/api/contacts',
  auth,
  wrap(async (req, res) => {
    res.json(await saveContact(req.session.account.email, req.body || {}));
  }),
);

app.post(
  '/api/contacts/delete',
  auth,
  wrap(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
    res.json({ total: await deleteContacts(req.session.account.email, ids) });
  }),
);

app.post(
  '/api/contacts/import',
  auth,
  wrap(async (req, res) => {
    const text = String(req.body?.text || '');
    const isVcf = req.body?.format === 'vcf' || /BEGIN:VCARD/i.test(text.slice(0, 2000));
    const parsed = isVcf ? parseVCard(text) : parseCsv(text);
    if (!parsed.length) return res.status(400).json({ error: 'No contacts found in that file' });
    res.json(await importContacts(req.session.account.email, parsed));
  }),
);

app.get(
  '/api/contacts/export',
  auth,
  wrap(async (req, res) => {
    const list = await loadContacts(req.session.account.email);
    const csv = req.query.format === 'csv';
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', csv ? 'text/csv; charset=utf-8' : 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${stamp}.${csv ? 'csv' : 'vcf'}"`);
    res.send(csv ? toCsv(list) : toVCard(list));
  }),
);

// ---------- calendar ----------

app.get(
  '/api/events',
  auth,
  wrap(async (req, res) => {
    res.json(await loadEvents(req.session.account.email));
  }),
);

app.post(
  '/api/events',
  auth,
  wrap(async (req, res) => {
    res.json(await saveEvent(req.session.account.email, req.body || {}));
  }),
);

app.post(
  '/api/events/delete',
  auth,
  wrap(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
    res.json({ total: await deleteEvents(req.session.account.email, ids) });
  }),
);

app.post(
  '/api/events/import',
  auth,
  wrap(async (req, res) => {
    const parsed = parseIcs(String(req.body?.text || ''), String(req.body?.tz || 'UTC'));
    if (!parsed.length) return res.status(400).json({ error: 'No events found in that file' });
    res.json(await importEvents(req.session.account.email, parsed));
  }),
);

app.get(
  '/api/events/export',
  auth,
  wrap(async (req, res) => {
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="calendar-${stamp}.ics"`);
    res.send(toIcs(await loadEvents(req.session.account.email)));
  }),
);

// ---------- static SPA ----------

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  // The app has a single page; send any other unknown path home instead of echoing index.html.
  app.use((req, res) => (req.path.startsWith('/api/') ? res.status(404).json({ error: 'not found' }) : res.redirect(302, '/')));
}

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`goodmail listening on http://${HOST}:${PORT}`));
