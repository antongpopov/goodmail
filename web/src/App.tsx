import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler, useAccount, currentAccount } from './api.ts';
import type { MailAccount } from './api.ts';
import { AccountsDialog } from './Accounts.tsx';
import { SecurityDialog } from './Security.tsx';
import { RulesDialog } from './Rules.tsx';
import { LangPicker } from './LangPicker.tsx';
import type { Features, Folder, Me, Message, Summary } from './api.ts';
import { Icon, folderIcon } from './icons.tsx';
import { Login } from './Login.tsx';
import { Compose } from './Compose.tsx';
import type { ComposeInit } from './Compose.tsx';
import { MailBody } from './MailBody.tsx';
import { Contacts } from './Contacts.tsx';
import { Calendar } from './Calendar.tsx';
import { bucket, displayName, fullAddr, fullTime, humanSize, save, store } from './util.ts';
import { t, localTitle } from './i18n.ts';
import { listCache, msgCache, msgKey, rememberMsg } from './cache.ts';
import { folderLabel, buildTree } from './folders.ts';
import type { FolderNode } from './folders.ts';
import { Avatar } from './Avatar.tsx';
import { Splitter } from './Splitter.tsx';
import { MessageItem } from './MessageItem.tsx';
import { FolderRow } from './FolderRow.tsx';
import { ViewMenu, Appearance } from './ViewMenu.tsx';
import { useAddressBook, useLayout, usePhoneWidth, useToast } from './hooks.ts';

const POLL_MS = 30_000;

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [cfg, setCfg] = useState<{ appName: string; appNames?: Record<string, string>; reset?: boolean; source: string }>({ appName: 'goodmail', source: 'https://github.com/antongpopov/goodmail' });

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    api.config().then(setCfg).catch(() => {});
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  // per-domain title once signed in, in the user's language when the config provides one
  const appName = me?.appName ? localTitle(me.appName, me.appNames) : localTitle(cfg.appName, cfg.appNames);
  useEffect(() => {
    document.title = appName;
  }, [appName]);

  if (me === undefined) return <div className="splash" />;
  if (!me) return <Login onLogin={setMe} appName={localTitle(cfg.appName, cfg.appNames)} source={cfg.source} canReset={cfg.reset} />;
  return <Mail me={me} appName={appName} source={cfg.source} onLogout={() => api.logout().finally(() => setMe(null))} />;
}

function Mail({ me, appName, source, onLogout }: { me: Me; appName: string; source: string; onLogout: () => void }) {
  const mainAcct: MailAccount = { id: 'main', email: me.email, name: me.name, provider: 'main', imapHost: me.imapHost, locked: false };
  const [accounts, setAccounts] = useState<MailAccount[]>([mainAcct]);
  const [acct, setAcctState] = useState(() => store('acct', 'main'));
  useAccount(acct); // every mail API call below acts on this mailbox
  const [allFolders, setAllFolders] = useState<Record<string, Folder[]>>({});
  const folders = allFolders[acct] ?? [];
  const setFolders = (fn: (f: Folder[]) => Folder[]) => setAllFolders((all) => ({ ...all, [acct]: fn(all[acct] ?? []) }));
  const [folder, setFolder] = useState(() => store('folder', 'INBOX'));
  const [acctDialog, setAcctDialog] = useState(false);
  const [secDialog, setSecDialog] = useState(false);
  const [rulesDialog, setRulesDialog] = useState(false);
  const [features, setFeatures] = useState<Features | null>(null);
  useEffect(() => {
    api.features().then(setFeatures).catch(() => {});
  }, [me.email]);
  const goto = (id: string, path: string) => {
    useAccount(id);
    setAcctState(id);
    save('acct', id);
    setFolder(path);
  };
  const [list, setList] = useState<Summary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [open, setOpen] = useState<Message | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'flagged'>('all');
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const { collapsed, setCollapsed, foldersHidden, setFoldersHidden, pane, setPane, preview, setPreview, listH, setListH, folderW, setFolderW, listW, setListW } = useLayout();
  const { toast, flash } = useToast();
  const [moveOpen, setMoveOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [view, setView] = useState<'mail' | 'contacts' | 'calendar'>(() => (location.hash === '#calendar' ? 'calendar' : 'mail'));
  const { book, addContact, setAddContact, reloadBook, known } = useAddressBook(view === 'contacts');
  const phoneWidth = usePhoneWidth();
  const addToCalendar = async (url: string) => {
    try {
      const r = await api.importEvents(await (await fetch(url, { credentials: 'same-origin' })).text());
      flash(r.updated ? t('Calendar event updated') : t('Added to your calendar'));
    } catch (err) {
      flash((err as Error).message);
    }
  };
  const [remoteOk, setRemoteOk] = useState<Record<string, boolean>>(() => store('remoteOk', {}));
  const [showRemoteOnce, setShowRemoteOnce] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const acctRef = useRef(acct);
  acctRef.current = acct;
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const loadFolders = useCallback(
    (fresh = false) =>
      Promise.all(
        accountsRef.current
          .filter((a) => !a.locked)
          .map((a) =>
            api
              .folders(a.id, fresh)
              .then((f) => setAllFolders((all) => ({ ...all, [a.id]: f })))
              .catch(() => {}),
          ),
      ),
    [],
  );
  const loadAccounts = useCallback(async () => {
    try {
      const list = await api.accounts();
      setAccounts(list);
      accountsRef.current = list;
      if (!list.some((a) => a.id === acctRef.current && !a.locked)) goto('main', 'INBOX');
      void loadFolders(true);
    } catch {
      /* keep what we have */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFolders]);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  /** Quietly fetch a few messages (without marking them read) so opening them is instant. */
  const prefetch = useCallback(async (acctId: string, f: string, msgs: Summary[], id?: number) => {
    for (const m of msgs) {
      if (id !== undefined && id !== reqId.current) return; // user moved on
      const k = msgKey(acctId, f, m.uid);
      if (msgCache.has(k) || m.size > 600_000) continue;
      try {
        rememberMsg(k, await api.message(f, m.uid, true, acctId));
      } catch {
        /* best effort */
      }
    }
  }, []);

  const loadList = useCallback(
    async (f: string, p: number, q: string, merge = false) => {
      const id = ++reqId.current;
      const acctId = currentAccount();
      const flt = q ? 'all' : filterRef.current;
      const lkey = `${acctId}\u0000${f}\u0000${q}\u0000${flt}`;
      const cachedList = p === 0 ? listCache.get(lkey) : undefined;
      if (cachedList && !merge) {
        setList(cachedList.messages);
        setHasMore(cachedList.hasMore);
      }
      if (!merge) setLoading(true);
      try {
        const r = q ? await api.search(f, q) : await api.messages(f, p, flt);
        if (id !== reqId.current) return;
        if (p === 0) {
          listCache.set(lkey, { messages: r.messages, hasMore: r.hasMore });
          void prefetch(acctId, f, r.messages.slice(0, 4), id);
        }
        setHasMore(r.hasMore);
        setList((old) => {
          if (p === 0) return r.messages;
          const seen = new Set(old.map((m) => m.uid));
          return [...old, ...r.messages.filter((m) => !seen.has(m.uid))];
        });
      } catch (err) {
        if (id === reqId.current) flash((err as Error).message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [flash],
  );

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    save('folder', folder);
    useAccount(acct);
    setPage(0);
    setSelected(new Set());
    setOpen(null);
    setFilter('all');
    filterRef.current = 'all';
    listRef.current?.scrollTo(0, 0);
    void loadList(folder, 0, searching);
  }, [folder, acct, searching, loadList]);

  // Unread / Flagged ask the server for every match in the folder, not just the loaded page.
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    if (searching) return;
    setPage(0);
    listRef.current?.scrollTo(0, 0);
    void loadList(folder, 0, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Background refresh: re-fetch the first page and folder counts.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void loadFolders();
      if (!searching && page === 0) void loadList(folder, 0, '', true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [folder, page, searching, loadFolders, loadList]);

  const current = folders.find((f) => f.path === folder);
  const trees = useMemo(() => Object.fromEntries(Object.entries(allFolders).map(([id, f]) => [id, buildTree(f)])), [allFolders]);
  const visibleRef = useRef<Summary[]>([]);
  const visible = useMemo(
    () => list.filter((m) => (filter === 'unread' ? !m.seen : filter === 'flagged' ? m.flagged : true)),
    [list, filter],
  );
  visibleRef.current = visible;
  const contacts = useMemo(() => {
    const s = new Set<string>();
    for (const c of book) for (const e of c.emails) s.add(c.name ? `${c.name} <${e}>` : e);
    for (const m of list) {
      if (m.from.address) s.add(fullAddr(m.from));
      m.to.forEach((a) => a.address && s.add(fullAddr(a)));
    }
    return [...s].slice(0, 5000);
  }, [list, book]);

  const patch = (uids: number[], p: Partial<Summary>) =>
    setList((l) => l.map((m) => (uids.includes(m.uid) ? { ...m, ...p } : m)));

  const openMessage = useCallback(
    async (m: Summary) => {
      setCompose(null);
      setShowRemoteOnce(false);
      const acctId = currentAccount();
      const k = msgKey(acctId, folder, m.uid);
      const hit = msgCache.get(k);
      if (!hit) setOpenLoading(true);
      try {
        const full = hit ?? (await api.message(folder, m.uid));
        rememberMsg(k, full);
        setOpen(full);
        if (hit && !m.seen) void api.flags(folder, [m.uid], ['\\Seen']).catch(() => {});
        // warm up the next message in the list, the usual next click (or j)
        const idx = visibleRef.current.findIndex((x) => x.uid === m.uid);
        const next = visibleRef.current[idx + 1];
        if (next) void prefetch(acctId, folder, [next]);
        if (!m.seen) {
          patch([m.uid], { seen: true });
          setFolders((fs) => fs.map((f) => (f.path === folder ? { ...f, unseen: Math.max(0, f.unseen - 1) } : f)));
        }
      } catch (err) {
        flash((err as Error).message);
      } finally {
        setOpenLoading(false);
      }
    },
    [folder, flash, prefetch],
  );

  const select = (m: Summary, e?: React.MouseEvent) => {
    if (e && (e.metaKey || e.ctrlKey)) {
      setSelected((s) => {
        const n = new Set(s);
        n.has(m.uid) ? n.delete(m.uid) : n.add(m.uid);
        return n;
      });
      setAnchor(m.uid);
      return;
    }
    if (e?.shiftKey && anchor != null) {
      const a = visible.findIndex((x) => x.uid === anchor);
      const b = visible.findIndex((x) => x.uid === m.uid);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(visible.slice(lo, hi + 1).map((x) => x.uid)));
      return;
    }
    setSelected(new Set([m.uid]));
    setAnchor(m.uid);
    void openMessage(m);
  };

  const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
  const overlay = !!(open || compose);
  const readingActive = !!(open || compose || openLoading);
  useEffect(() => {
    if (overlay && (isPhone() || pane === 'hidden') && !history.state?.gm) history.pushState({ gm: 1 }, '');
  }, [overlay, pane]);
  useEffect(() => {
    const onPop = () => {
      setOpen(null);
      setCompose(null);
      setSelected(new Set());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const closeMessage = () => {
    if (history.state?.gm) history.back();
    else {
      setOpen(null);
      setSelected(new Set());
    }
  };

  const targetUids = () => (selected.size ? [...selected] : open ? [open.uid] : []);

  const removeFromList = (uids: number[]) => {
    const idx = visible.findIndex((m) => uids.includes(m.uid));
    const remaining = visible.filter((m) => !uids.includes(m.uid));
    setList((l) => l.filter((m) => !uids.includes(m.uid)));
    const next = remaining[Math.min(idx, remaining.length - 1)];
    if (next && uids.length === 1 && open && uids.includes(open.uid)) {
      setSelected(new Set([next.uid]));
      setAnchor(next.uid);
      void openMessage(next);
    } else {
      setSelected(new Set());
      if (open && uids.includes(open.uid)) setOpen(null);
    }
  };

  const doDelete = async (uids = targetUids()) => {
    if (!uids.length) return;
    removeFromList(uids);
    try {
      const r = await api.remove(folder, uids);
      flash(r.permanent ? t('Deleted {n} permanently', { n: uids.length }) : t('Moved {n} to the trash', { n: uids.length }));
      void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
      void loadList(folder, 0, searching);
    }
  };

  const doMove = async (to: string, uids = targetUids()) => {
    if (!uids.length) return;
    setMoveOpen(false);
    removeFromList(uids);
    try {
      const r = await api.move(folder, uids, to);
      flash(t('Moved {n} to {folder}', { n: uids.length, folder: (() => { const f = folders.find((x) => x.path === r.to); return f ? folderLabel(f) : r.to; })() }));
      void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
      void loadList(folder, 0, searching);
    }
  };

  const setFlag = async (uids: number[], flag: '\\Seen' | '\\Flagged', on: boolean) => {
    if (!uids.length) return;
    patch(uids, flag === '\\Seen' ? { seen: on } : { flagged: on });
    if (flag === '\\Flagged') for (const u of uids) { const c = msgCache.get(msgKey(currentAccount(), folder, u)); if (c) c.flagged = on; }
    if (open && uids.includes(open.uid) && flag === '\\Flagged') setOpen({ ...open, flagged: on });
    try {
      await api.flags(folder, uids, on ? [flag] : [], on ? [] : [flag]);
      if (flag === '\\Seen') void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const toggleRead = () => {
    const uids = targetUids();
    const anyUnread = list.some((m) => uids.includes(m.uid) && !m.seen);
    void setFlag(uids, '\\Seen', anyUnread);
  };
  const toggleFlag = () => {
    const uids = targetUids();
    const anyUnflagged = list.some((m) => uids.includes(m.uid) && !m.flagged);
    void setFlag(uids, '\\Flagged', anyUnflagged);
  };

  const sync = () => {
    void loadFolders(true);
    void loadList(folder, 0, searching);
    setPage(0);
  };

  // Keyboard shortcuts (outside inputs/editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (compose || tgt.closest('input,textarea,[contenteditable="true"],select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = visible.findIndex((m) => m.uid === (open?.uid ?? anchor));
      const go = (d: number) => {
        const n = visible[Math.max(0, Math.min(visible.length - 1, idx + d))];
        if (n) {
          select(n);
          document.querySelector(`[data-uid="${n.uid}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      };
      switch (e.key) {
        case 'ArrowDown': case 'j': e.preventDefault(); go(1); break;
        case 'ArrowUp': case 'k': e.preventDefault(); go(-1); break;
        case 'Delete': case 'Backspace': e.preventDefault(); void doDelete(); break;
        case 'n': e.preventDefault(); setCompose({ mode: 'new' }); break;
        case 'r': if (open) { e.preventDefault(); setCompose({ mode: 'reply', source: open }); } break;
        case 'a': if (open) { e.preventDefault(); setCompose({ mode: 'replyAll', source: open }); } break;
        case 'f': if (open) { e.preventDefault(); setCompose({ mode: 'forward', source: open }); } break;
        case 'u': e.preventDefault(); toggleRead(); break;
        case 'e': e.preventDefault(); void doMove('archive'); break;
        case '!': e.preventDefault(); void toggleJunk(); break;
        case '/': e.preventDefault(); document.getElementById('gm-search')?.focus(); break;
        case 'Escape': setSelected(new Set()); setOpen(null); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!loading && hasMore && !searching && el.scrollTop + el.clientHeight > el.scrollHeight - 400) {
      const p = page + 1;
      setPage(p);
      setLoading(true);
      void loadList(folder, p, '');
    }
  };

  const senderKey = open?.from.address.toLowerCase() || '';
  const remote = showRemoteOnce || !!remoteOk[senderKey];

  const groups = useMemo(() => {
    const g: { label: string; items: Summary[] }[] = [];
    for (const m of visible) {
      const label = bucket(m.date);
      if (g[g.length - 1]?.label !== label) g.push({ label, items: [] });
      g[g.length - 1].items.push(m);
    }
    return g;
  }, [visible]);

  const isSentFolder = current?.specialUse === '\\Sent' || current?.specialUse === '\\Drafts';
  // In the Junk folder the junk buttons turn into "Not junk" (move back to Inbox). On servers that learn from
  // Junk moves (rspamd/IMAPSieve) this is also what trains the spam filter.
  const inJunk = current?.specialUse === '\\Junk';
  const toggleJunk = (uids = targetUids()) => doMove(inJunk ? 'INBOX' : 'junk', uids);
  const has = targetUids().length > 0;

  const openFolder = (aid: string, path: string) => {
    setSearching('');
    setQuery('');
    setView('mail');
    goto(aid, path);
    setDrawer(false);
  };
  /** Drag a folder onto another one (becomes its subfolder) or onto empty space in the list (top level). */
  const moveFolder = async (aid: string, from: string, to: string) => {
    try {
      useAccount(aid);
      const r = await api.moveFolder(from, to);
      if (aid === acct && folder === from) goto(aid, r.path);
      void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      useAccount(acct);
    }
  };
  const newSubfolder = async (aid: string, n: FolderNode) => {
    const name = prompt(t('Name of the new subfolder in "{name}"', { name: n.name }));
    if (!name || !name.trim()) return;
    try {
      useAccount(aid);
      await api.createFolder(`${n.path}${n.delimiter || '/'}${name.trim()}`);
      setCollapsed((c) => ({ ...c, [`${aid}:${n.path}`]: false }));
      void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      useAccount(acct);
    }
  };
  const renameFolder = async (aid: string, n: FolderNode) => {
    const name = prompt(t('New name for the folder'), n.name);
    if (!name || name.trim() === n.name) return;
    try {
      useAccount(aid);
      const r = await api.renameFolder(n.path, name.trim());
      if (aid === acct && folder === n.path) goto(aid, r.path);
      void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      useAccount(acct);
    }
  };
  const deleteFolder = async (aid: string, n: FolderNode) => {
    const msg = n.total ? t('Delete the folder "{name}" and its {n} messages?', { name: n.name, n: n.total }) : t('Delete the folder "{name}"?', { name: n.name });
    if (!confirm(msg + '\n\n' + t('It moves to Trash, where you can still get it back.'))) return;
    try {
      useAccount(aid);
      await api.deleteFolder(n.path);
      if (aid === acct && (folder === n.path || folder.startsWith(n.path + n.delimiter))) goto(aid, 'INBOX');
      void loadFolders(true);
      flash(t('Folder moved to Trash'));
    } catch (err) {
      flash((err as Error).message);
    } finally {
      useAccount(acct);
    }
  };
  const toggleCollapsed = (k: string) => {
    const c = { ...collapsed, [k]: !collapsed[k] };
    setCollapsed(c);
    save('collapsed', c);
  };
  const dropOnFolder = (aid: string, path: string, uids: number[]) => {
    if (uids.length && aid === acct && path !== folder) void doMove(path, uids);
  };
  const renderFolder = (n: FolderNode, aid: string): React.ReactNode => (
    <FolderRow key={n.path} n={n} aid={aid} acct={acct} folder={folder} collapsed={collapsed} onOpen={openFolder} onToggle={toggleCollapsed} onDrop={dropOnFolder} onDropFolder={moveFolder} onSub={newSubfolder} onRename={renameFolder} onDelete={deleteFolder} />
  );

  const foldersBlock = (
    <>
            {drawer && <div className="backdrop" onClick={() => setDrawer(false)} />}
            {(!foldersHidden || drawer) && (
              <aside
                className={`folders ${drawer ? 'drawer-open' : ''}`}
                style={{ width: folderW }}
                onDragOver={(e) => e.dataTransfer.types.includes('application/x-goodmail-folder') && e.preventDefault()}
                onDrop={(e) => {
                  const f = e.dataTransfer.getData('application/x-goodmail-folder');
                  if (!f) return;
                  e.preventDefault();
                  const src = JSON.parse(f) as { aid: string; path: string };
                  void moveFolder(src.aid, src.path, '');
                }}
              >
                {accounts.map((a) => {
                  const k = `acct:${a.id}`;
                  const unseen = (allFolders[a.id] || []).find((f) => f.specialUse === '\\Inbox')?.unseen || 0;
                  return (
                    <div key={a.id} className="acct-tree">
                      <button
                        className="account"
                        onClick={() => {
                          const c = { ...collapsed, [k]: !collapsed[k] };
                          setCollapsed(c);
                          save('collapsed', c);
                        }}
                        title={a.email}
                      >
                        <Icon name={collapsed[k] ? 'chevronRight' : 'chevronDown'} size={14} />
                        <span>{a.email}</span>
                        {collapsed[k] && unseen > 0 && <span className="count">{unseen}</span>}
                      </button>
                      {a.locked && (
                        <button className="folder muted" onClick={() => setAcctDialog(true)}>
                          <span className="twisty" />
                          <Icon name="close" size={16} /> <span className="fname">{t('Locked — re-enter password')}</span>
                        </button>
                      )}
                      {!collapsed[k] && (trees[a.id] || []).map((n) => renderFolder(n, a.id))}
                    </div>
                  );
                })}
                <button
                  className="folder add"
                  onClick={async () => {
                    const name = prompt(t('New folder name'));
                    if (name) {
                      try {
                        await api.createFolder(name);
                        void loadFolders(true);
                      } catch (err) {
                        flash((err as Error).message);
                      }
                    }
                  }}
                >
                  <span className="twisty" />
                  <Icon name="plus" size={16} /> <span className="fname">{t('Create new folder')}</span>
                </button>
                <button className="folder add" onClick={() => setAcctDialog(true)}>
                  <span className="twisty" />
                  <Icon name="people" size={16} /> <span className="fname">{t('Add account')}</span>
                </button>
                <div className="drawer-foot phone-only">
                  <button className="folder" onClick={() => { setView('calendar'); setDrawer(false); }}>
                    <span className="twisty" />
                    <Icon name="calendar" size={18} /> <span className="fname">{t('Calendar')}</span>
                  </button>
                  <button className="folder" onClick={() => { setView('contacts'); setDrawer(false); }}>
                    <span className="twisty" />
                    <Icon name="people" size={18} /> <span className="fname">{t('Contacts')}</span>
                  </button>
                  <Appearance />
                  <LangPicker className="wide drawer-lang" />
                  <label className="menu-check">
                    <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> {t('Show preview text')}
                  </label>
                  {features?.rules && (
                    <button className="folder" onClick={() => { setRulesDialog(true); setDrawer(false); }}>
                      <span className="twisty" />
                      <Icon name="folder" size={18} /> <span className="fname">{t('Mail rules…')}</span>
                    </button>
                  )}
                  <button className="folder" onClick={() => { setSecDialog(true); setDrawer(false); }}>
                    <span className="twisty" />
                    <Icon name="check" size={18} /> <span className="fname">{t('Sign-in security…')}</span>
                  </button>
                  <button className="folder" onClick={onLogout}>
                    <span className="twisty" />
                    <Icon name="signout" size={18} /> <span className="fname">{t('Sign out')}</span>
                  </button>
                </div>
              </aside>
            )}
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
        <button className="top-btn phone-only" onClick={() => setDrawer(true)} title={t('Folders')}>
          <Icon name="menu" />
        </button>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          {appName}
        </div>
        <nav className="apps desk-only">
          {(
            [
              ['mail', 'mail', t('Mail')],
              ['calendar', 'calendar', t('Calendar')],
              ['contacts', 'people', t('Contacts')],
            ] as const
          ).map(([id, icon, label]) => (
            <button key={id} className={`app-btn ${view === id ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={view === id} onClick={() => setView(id)}>
              <Icon name={icon} />
            </button>
          ))}
        </nav>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearching(query.trim());
          }}
        >
          <Icon name="search" size={16} />
          <input id="gm-search" placeholder={current ? t('Search {folder}', { folder: folderLabel(current) }) : t('Search mail')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {searching && (
            <button
              type="button"
              className="x"
              onClick={() => {
                setQuery('');
                setSearching('');
              }}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </form>
        <div className="top-right">
          <span className="desk-only">
            <ViewMenu pane={pane} onPane={setPane} preview={preview} onPreview={setPreview} onAccounts={() => setAcctDialog(true)} onSecurity={() => setSecDialog(true)} onRules={features?.rules ? () => setRulesDialog(true) : undefined} source={source} />
          </span>
          <span className="who" title={`${me.email} · ${me.imapHost}`}>
            <Avatar addr={{ name: me.name, address: me.email }} size={28} />
          </span>
          <button className="top-btn desk-only" onClick={onLogout} title={t('Sign out')}>
            <Icon name="signout" />
          </button>
        </div>
      </header>

      <div className="body">

        <div className="main">
          {view !== 'mail' && drawer && foldersBlock}
          {view === 'calendar' ? (
            <Calendar flash={flash} isPhone={phoneWidth} />
          ) : view === 'contacts' ? (
            <Contacts
              contacts={book}
              reload={reloadBook}
              flash={flash}
              initial={addContact}
              onCompose={(to) => {
                setView('mail');
                setOpen(null);
                setCompose({ mode: 'new', to });
              }}
            />
          ) : (
          <>
          <div className="toolbar">
            <button className="tb" onClick={() => { setFoldersHidden(!foldersHidden); save('foldersHidden', !foldersHidden); }} title={t('Show/hide folders')}>
              <Icon name="menu" />
            </button>
            <button className="tb new" onClick={() => setCompose({ mode: 'new' })}>
              <Icon name="compose" /> {t('New mail')}
            </button>
            <span className="sep" />
            <button className="tb" disabled={!has} onClick={() => void doDelete()}>
              <Icon name="trash" /> <span className="lbl">{t('Delete')}</span>
            </button>
            <button className="tb" disabled={!has} onClick={() => void doMove('archive')}>
              <Icon name="archive" /> <span className="lbl">{t('Archive')}</span>
            </button>
            <div className="menu-wrap">
              <button className="tb" disabled={!has} onClick={() => setMoveOpen((v) => !v)}>
                <Icon name="move" /> <span className="lbl">{t('Move')}</span>
              </button>
              {moveOpen && (
                <div className="menu" onMouseLeave={() => setMoveOpen(false)}>
                  {folders
                    .filter((f) => f.path !== folder)
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map((f) => (
                      <button key={f.path} onClick={() => void doMove(f.path)}>
                        <Icon name={folderIcon(f.specialUse)} size={16} /> {f.path.split(f.delimiter || '/').join(' / ')}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <button
              className="tb"
              disabled={!has}
              onClick={() => void toggleJunk()}
              title={inJunk ? t('Not junk: move back to Inbox (!)') : t('Mark as junk (!)')}
            >
              <Icon name={inJunk ? 'inbox' : 'junk'} /> <span className="lbl">{inJunk ? t('Not junk') : t('Mark as junk')}</span>
            </button>
            <button className="tb" disabled={!has} onClick={toggleFlag}>
              <Icon name="flag" /> <span className="lbl">{t('Flag')}</span>
            </button>
            <button className="tb" disabled={!has} onClick={toggleRead}>
              <Icon name="unread" /> <span className="lbl">{t('Read / Unread')}</span>
            </button>
            <button className="tb" onClick={sync}>
              <Icon name="sync" /> <span className="lbl">{t('Sync')}</span>
            </button>
          </div>

          <div className={`panes pane-${pane}`}>
            {foldersBlock}
            {!foldersHidden && <Splitter width={folderW} min={150} max={480} onChange={setFolderW} storeKey="folderW" />}

            <div className="work">
            <section
              className="list"
              style={{
                ...(pane === 'right' ? { width: listW } : pane === 'below' ? { height: listH } : {}),
                ...(pane === 'hidden' && readingActive ? { display: 'none' } : {}),
              }}
            >
              <div className="list-head">
                <div className="tabs">
                  {(['all', 'unread', 'flagged'] as const).map((f) => (
                    <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                      {f === 'all' ? (searching ? t('Results') : current ? folderLabel(current) : t('All')) : f === 'unread' ? t('Unread') : t('Flagged')}
                    </button>
                  ))}
                </div>
                {loading && <span className="spinner" />}
              </div>
              <div className="list-scroll" ref={listRef} onScroll={onScroll}>
                {!loading && visible.length === 0 && <div className="empty">{searching ? t('No results.') : t('Nothing here. Enjoy your day.')}</div>}
                {groups.map((g) => (
                  <div key={g.label}>
                    <div className="group">{g.label}</div>
                    {g.items.map((m) => (
                      <MessageItem
                        key={m.uid}
                        m={m}
                        who={isSentFolder ? m.to[0] || m.from : m.from}
                        isSentFolder={isSentFolder}
                        selected={selected.has(m.uid)}
                        selectedUids={selected}
                        preview={preview}
                        compact={pane === 'below' && !phoneWidth}
                        inJunk={inJunk}
                        onSelect={select}
                        onFlag={setFlag}
                        onToggleJunk={toggleJunk}
                        onDelete={doDelete}
                      />
                    ))}
                  </div>
                ))}
                {hasMore && !searching && <div className="more">{loading ? t('Loading…') : ''}</div>}
              </div>
            </section>
            {pane === 'right' && <Splitter width={listW} min={260} max={900} onChange={setListW} storeKey="listW" />}
            {pane === 'below' && <Splitter axis="y" width={listH} min={120} max={900} onChange={setListH} storeKey="listH" />}
            {(pane !== 'hidden' || readingActive) && (

            <main className="reading">
              {compose ? (
                <Compose
                  key={`${compose.mode}-${compose.source?.uid ?? 'new'}`}
                  me={me}
                  init={compose}
                  accounts={accounts.filter((a) => !a.locked)}
                  defaultFrom={compose.source?.account || acct}
                  contacts={contacts}
                  onClose={() => setCompose(null)}
                  onSent={() => {
                    setCompose(null);
                    flash(t('Message sent'));
                    if (compose.source && compose.mode !== 'forward') patch([compose.source.uid], { answered: true });
                    void loadFolders(true);
                  }}
                />
              ) : open ? (
                <article className="message">
                  <div className="msg-head">
                    <button className="tb icon back" title={t('Back')} onClick={closeMessage}>
                      <Icon name="chevronRight" />
                    </button>
                    <h2>{open.subject || t('(no subject)')}</h2>
                    <div className="msg-actions">
                      <button className="tb icon" title={t('Reply (r)')} onClick={() => setCompose({ mode: 'reply', source: open })}>
                        <Icon name="reply" />
                      </button>
                      <button className="tb icon" title={t('Reply all (a)')} onClick={() => setCompose({ mode: 'replyAll', source: open })}>
                        <Icon name="replyAll" />
                      </button>
                      <button className="tb icon" title={t('Forward (f)')} onClick={() => setCompose({ mode: 'forward', source: open })}>
                        <Icon name="forward" />
                      </button>
                      <button className="tb icon" title={inJunk ? t('Not junk (!)') : t('Mark as junk (!)')} onClick={() => void toggleJunk([open.uid])}>
                        <Icon name={inJunk ? 'inbox' : 'junk'} />
                      </button>
                      <span className="phone-only phone-actions">
                        <button className="tb icon" title={t('Delete')} onClick={() => void doDelete()}>
                          <Icon name="trash" />
                        </button>
                        <button className="tb icon" title={t('Archive')} onClick={() => void doMove('archive')}>
                          <Icon name="archive" />
                        </button>
                        <button className="tb icon" title={t('Flag')} onClick={toggleFlag}>
                          <Icon name="flag" filled={open.flagged} />
                        </button>
                        <button className="tb icon" title={t('Mark unread')} onClick={() => { void setFlag([open.uid], '\\Seen', false); closeMessage(); }}>
                          <Icon name="unread" />
                        </button>
                      </span>
                    </div>
                  </div>
                  <div className="card">
                    <div className="sender-row">
                      <Avatar addr={open.from} size={44} />
                      <div className="sender-info">
                        <div className="from-line">
                          <b>{displayName(open.from)}</b>
                          {open.from.address && !known.has(open.from.address.toLowerCase()) && (
                            <button
                              className="add-contact"
                              title={t('Add to contacts')}
                              onClick={() => {
                                setAddContact({ name: open.from.name, emails: [open.from.address] });
                                setView('contacts');
                              }}
                            >
                              <Icon name="plus" size={14} />
                            </button>
                          )}
                          {open.from.name && <span className="muted"> &lt;{open.from.address}&gt;</span>}
                        </div>
                        <div className="to-line">
                          <span className="muted">{t('To:')}</span> {open.to.map(displayName).join('; ') || '—'}
                          {open.cc.length > 0 && (
                            <>
                              {'  '}
                              <span className="muted">{t('Cc:')}</span> {open.cc.map(displayName).join('; ')}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="date-col">
                        <div className="date">{fullTime(open.date)}</div>
                      </div>
                    </div>
                    {blocked && !remote && (
                      <div className="banner">
                        <Icon name="image" size={16} /> {t('Some external content was blocked to protect your privacy.')}
                        <button className="link-btn" onClick={() => setShowRemoteOnce(true)}>{t('Show once')}</button>
                        <button
                          className="link-btn"
                          onClick={() => {
                            const r = { ...remoteOk, [senderKey]: true };
                            setRemoteOk(r);
                            save('remoteOk', r);
                          }}
                        >
                          {t('Always show from {sender}', { sender: open.from.address })}
                        </button>
                      </div>
                    )}
                    {open.attachments.length > 0 && (
                      <div className="attachments">
                        {open.attachments.map((a) => (
                          <a key={a.part} className="att" href={api.attachmentUrl(folder, open.uid, a)} download={a.filename}>
                            <Icon name="clip" size={16} />
                            <span className="att-name">{a.filename}</span>
                            <span className="muted">{humanSize(a.size)}</span>
                          </a>
                        ))}
                        {open.attachments
                          .filter((a) => a.type === 'text/calendar' || /\.ics$/i.test(a.filename))
                          .map((a) => (
                            <button key={`cal-${a.part}`} className="att ics" onClick={() => void addToCalendar(api.attachmentUrl(folder, open.uid, a))}>
                              <Icon name="calendar" size={16} /> {t('Add to calendar')}
                            </button>
                          ))}
                      </div>
                    )}
                    <MailBody html={open.html} text={open.text} remote={remote} onBlocked={setBlocked} />
                  </div>
                </article>
              ) : (
                <div className={`placeholder ${openLoading ? 'loading' : ''}`}>
                  {openLoading ? <span className="spinner" /> : (
                    <>
                      <Icon name="mail" size={56} />
                      <p>{selected.size > 1 ? t('{n} items selected', { n: selected.size }) : t('Select an item to read')}</p>
                      <p className="muted small">{t('j/k to move · r reply · a reply all · f forward · e archive · Del delete · n new · / search')}</p>
                    </>
                  )}
                </div>
              )}
            </main>
            )}
            </div>
          </div>
          </>
          )}
        </div>
      </div>
      {view === 'mail' && !compose && !open && !openLoading && (
        <button className="fab phone-only" onClick={() => setCompose({ mode: 'new' })}>
          <Icon name="compose" /> {t('New mail')}
        </button>
      )}
      {secDialog && <SecurityDialog onClose={() => setSecDialog(false)} flash={flash} features={features} />}
      {rulesDialog && <RulesDialog onClose={() => setRulesDialog(false)} flash={flash} />}
      {acctDialog && (
        <AccountsDialog
          accounts={accounts}
          onClose={() => setAcctDialog(false)}
          onChanged={() => void loadAccounts()}
          flash={flash}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
