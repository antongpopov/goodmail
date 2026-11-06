import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler, useAccount } from './api.ts';
import type { MailAccount } from './api.ts';
import { AccountsDialog } from './Accounts.tsx';
import type { Folder, Me, Message, Summary } from './api.ts';
import { Icon, folderIcon } from './icons.tsx';
import { Login } from './Login.tsx';
import { Compose } from './Compose.tsx';
import type { ComposeInit } from './Compose.tsx';
import { MailBody } from './MailBody.tsx';
import { Contacts } from './Contacts.tsx';
import { Calendar } from './Calendar.tsx';
import type { Contact } from './api.ts';
import { loadTheme, setTheme } from './theme.ts';
import type { Theme } from './theme.ts';
import { avatarColor, bucket, displayName, fullAddr, fullTime, humanSize, initials, listTime, save, store } from './util.ts';

const SPECIAL_ORDER = ['\\Inbox', '\\Drafts', '\\Sent', '\\Archive', '\\Junk', '\\Trash'];
const POLL_MS = 30_000;

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [cfg, setCfg] = useState({ appName: 'goodmail', source: 'https://github.com/antongpopov/goodmail' });

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    api.config().then(setCfg).catch(() => {});
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    document.title = cfg.appName;
  }, [cfg.appName]);

  if (me === undefined) return <div className="splash" />;
  if (!me) return <Login onLogin={setMe} appName={cfg.appName} source={cfg.source} />;
  return <Mail me={me} appName={cfg.appName} source={cfg.source} onLogout={() => api.logout().finally(() => setMe(null))} />;
}

function Avatar({ addr, size = 32 }: { addr: { name: string; address: string }; size?: number }) {
  return (
    <span className="avatar" style={{ background: avatarColor(addr.address || addr.name), width: size, height: size, fontSize: size * 0.4 }}>
      {initials(addr)}
    </span>
  );
}

/** Drag handle between two panes; resizes the pane before it (left, or above for axis="y"). Double-click resets. */
function Splitter({ width, min, max, onChange, storeKey, axis = 'x' }: { width: number; min: number; max: number; onChange: (w: number) => void; storeKey: string; axis?: 'x' | 'y' }) {
  const defaults: Record<string, number> = { folderW: 220, listW: 380, listH: 300 };
  const pos = (e: { clientX: number; clientY: number }) => (axis === 'x' ? e.clientX : e.clientY);
  return (
    <div
      className={`splitter ${axis === 'y' ? 'h' : ''}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      title="Drag to resize · double-click to reset"
      onDoubleClick={() => {
        onChange(defaults[storeKey]);
        save(storeKey, defaults[storeKey]);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        document.body.classList.add(axis === 'x' ? 'resizing' : 'resizing-h');
        const startX = pos(e);
        let w = width;
        const move = (ev: PointerEvent) => {
          w = Math.round(Math.min(max, Math.max(min, width + pos(ev) - startX)));
          onChange(w);
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          el.classList.remove('dragging');
          document.body.classList.remove('resizing', 'resizing-h');
          save(storeKey, w);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    />
  );
}

const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: 'auto', label: 'Auto (system)', icon: 'auto' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
];

export type PaneMode = 'right' | 'below' | 'hidden';
const PANES: { id: PaneMode; label: string }[] = [
  { id: 'right', label: 'Right' },
  { id: 'below', label: 'Below' },
  { id: 'hidden', label: 'Hidden' },
];

function ViewMenu({ pane, onPane, preview, onPreview, onAccounts, source }: { pane: PaneMode; onPane: (p: PaneMode) => void; preview: boolean; onPreview: (v: boolean) => void; onAccounts: () => void; source: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="top-btn" title="View settings" onClick={() => setOpen((v) => !v)}>
        <Icon name="settings" />
      </button>
      {open && (
        <div className="menu view-menu">
          <div className="menu-label">Theme</div>
          <ThemeSegment />
          <div className="menu-label">Reading pane</div>
          <div className="segment">
            {PANES.map((p) => (
              <button key={p.id} className={p.id === pane ? 'on' : ''} onClick={() => onPane(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="menu-label">Message list</div>
          <label className="menu-check">
            <input type="checkbox" checked={preview} onChange={(e) => onPreview(e.target.checked)} /> Show preview text
          </label>
          <div className="menu-label">Mail accounts</div>
          <button className="menu-btn" onClick={() => { setOpen(false); onAccounts(); }}>
            <Icon name="people" size={16} /> Manage accounts…
          </button>
          <div className="about">
            goodmail · AGPL-3.0 ·{' '}
            <a href={source} target="_blank" rel="noopener noreferrer">Source code</a>
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeSegment() {
  const [theme, set] = useState<Theme>(loadTheme);
  return (
    <div className="segment">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={t.id === theme ? 'on' : ''}
          onClick={() => {
            set(t.id);
            setTheme(t.id);
          }}
        >
          <Icon name={t.icon} size={16} /> {t.id === 'auto' ? 'Auto' : t.label}
        </button>
      ))}
    </div>
  );
}

interface FolderNode extends Folder { children: FolderNode[]; depth: number }

function buildTree(list: Folder[]): FolderNode[] {
  const byPath = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];
  const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) byPath.set(f.path, { ...f, children: [], depth: 0 });
  for (const n of byPath.values()) {
    const parentPath = n.delimiter ? n.path.split(n.delimiter).slice(0, -1).join(n.delimiter) : '';
    const parent = parentPath && byPath.get(parentPath);
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const rank = (f: Folder) => {
    const i = SPECIAL_ORDER.indexOf(f.specialUse);
    return i < 0 ? 100 : i;
  };
  const sortRec = (ns: FolderNode[], depth: number) => {
    ns.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    ns.forEach((n) => {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    });
  };
  sortRec(roots, 0);
  return roots;
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => store('collapsed', {}));
  const [foldersHidden, setFoldersHidden] = useState(() => store('foldersHidden', false));
  const [toast, setToast] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [view, setView] = useState<'mail' | 'contacts' | 'calendar'>(() => (location.hash === '#calendar' ? 'calendar' : 'mail'));
  const [book, setBook] = useState<Contact[]>([]);
  const [addContact, setAddContact] = useState<Partial<Contact> | null>(null);
  const reloadBook = useCallback(() => api.contacts().then(setBook).catch(() => {}), []);
  useEffect(() => {
    void reloadBook();
  }, [reloadBook, view === 'contacts']); // refresh when the Contacts view opens (edits from other devices)
  const [phoneWidth, setPhoneWidth] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const on = () => setPhoneWidth(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const addToCalendar = async (url: string) => {
    try {
      const r = await api.importEvents(await (await fetch(url, { credentials: 'same-origin' })).text());
      flash(r.updated ? 'Calendar event updated' : 'Added to your calendar');
    } catch (err) {
      flash((err as Error).message);
    }
  };
  const known = useMemo(() => new Set(book.flatMap((c) => c.emails)), [book]);
  const [pane, setPaneState] = useState<PaneMode>(() => store('pane', 'right'));
  const [preview, setPreviewState] = useState(() => store('preview', false));
  const [listH, setListH] = useState(() => store('listH', 300));
  const setPane = (p: PaneMode) => {
    setPaneState(p);
    save('pane', p);
  };
  const setPreview = (v: boolean) => {
    setPreviewState(v);
    save('preview', v);
  };
  const [remoteOk, setRemoteOk] = useState<Record<string, boolean>>(() => store('remoteOk', {}));
  const [showRemoteOnce, setShowRemoteOnce] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [folderW, setFolderW] = useState(() => store('folderW', 220));
  const [listW, setListW] = useState(() => store('listW', 380));
  const reqId = useRef(0);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), 3500);
  }, []);

  const acctRef = useRef(acct);
  acctRef.current = acct;
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const loadFolders = useCallback(
    () =>
      Promise.all(
        accountsRef.current
          .filter((a) => !a.locked)
          .map((a) =>
            api
              .folders(a.id)
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
      void loadFolders();
    } catch {
      /* keep what we have */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFolders]);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const loadList = useCallback(
    async (f: string, p: number, q: string, merge = false) => {
      const id = ++reqId.current;
      if (!merge) setLoading(true);
      try {
        const r = q ? await api.search(f, q) : await api.messages(f, p);
        if (id !== reqId.current) return;
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
    listRef.current?.scrollTo(0, 0);
    void loadList(folder, 0, searching);
  }, [folder, acct, searching, loadList]);

  // Background refresh: re-fetch the first page and folder counts.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      void loadFolders();
      if (!searching && page === 0) void loadList(folder, 0, '', true);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [folder, page, searching, loadFolders, loadList]);

  const current = folders.find((f) => f.path === folder);
  const trees = useMemo(() => Object.fromEntries(Object.entries(allFolders).map(([id, f]) => [id, buildTree(f)])), [allFolders]);
  const visible = useMemo(
    () => list.filter((m) => (filter === 'unread' ? !m.seen : filter === 'flagged' ? m.flagged : true)),
    [list, filter],
  );
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
      setOpenLoading(true);
      try {
        const full = await api.message(folder, m.uid);
        setOpen(full);
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
    [folder, flash],
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
      flash(r.permanent ? `Deleted ${uids.length} permanently` : `Moved ${uids.length} to Deleted Items`);
      void loadFolders();
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
      flash(`Moved ${uids.length} to ${folders.find((f) => f.path === r.to)?.name || r.to}`);
      void loadFolders();
    } catch (err) {
      flash((err as Error).message);
      void loadList(folder, 0, searching);
    }
  };

  const setFlag = async (uids: number[], flag: '\\Seen' | '\\Flagged', on: boolean) => {
    if (!uids.length) return;
    patch(uids, flag === '\\Seen' ? { seen: on } : { flagged: on });
    if (open && uids.includes(open.uid) && flag === '\\Flagged') setOpen({ ...open, flagged: on });
    try {
      await api.flags(folder, uids, on ? [flag] : [], on ? [] : [flag]);
      if (flag === '\\Seen') void loadFolders();
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
    void loadFolders();
    void loadList(folder, 0, searching);
    setPage(0);
  };

  // Keyboard shortcuts (outside inputs/editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (compose || t.closest('input,textarea,[contenteditable="true"],select')) return;
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

  const renderFolder = (n: FolderNode, aid: string): React.ReactNode => (
    <div key={n.path}>
      <div
        className={`folder ${n.path === folder && aid === acct ? 'active' : ''}`}
        style={{ paddingLeft: 12 + n.depth * 14 }}
        onClick={() => {
          setSearching('');
          setQuery('');
          goto(aid, n.path);
          setDrawer(false);
        }}
        onDragOver={(e) => aid === acct && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const uids = JSON.parse(e.dataTransfer.getData('application/x-goodmail') || '[]');
          if (uids.length && aid === acct && n.path !== folder) void doMove(n.path, uids);
        }}
      >
        {n.children.length > 0 ? (
          <button
            className="twisty"
            onClick={(e) => {
              e.stopPropagation();
              const k = `${aid}:${n.path}`;
              const c = { ...collapsed, [k]: !collapsed[k] };
              setCollapsed(c);
              save('collapsed', c);
            }}
          >
            <Icon name={collapsed[`${aid}:${n.path}`] ? 'chevronRight' : 'chevronDown'} size={14} />
          </button>
        ) : (
          <span className="twisty" />
        )}
        <Icon name={folderIcon(n.specialUse)} size={18} />
        <span className="fname">{n.name}</span>
        {n.unseen > 0 && n.specialUse !== '\\Sent' && <span className="count">{n.unseen}</span>}
      </div>
      {!collapsed[`${aid}:${n.path}`] && n.children.map((c) => renderFolder(c, aid))}
    </div>
  );

  return (
    <div className="app">
      <header className="topbar">
        <button className="top-btn phone-only" onClick={() => setDrawer(true)} title="Folders">
          <Icon name="menu" />
        </button>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          {appName}
        </div>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearching(query.trim());
          }}
        >
          <Icon name="search" size={16} />
          <input id="gm-search" placeholder={`Search ${current?.name || 'mail'}`} value={query} onChange={(e) => setQuery(e.target.value)} />
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
            <ViewMenu pane={pane} onPane={setPane} preview={preview} onPreview={setPreview} onAccounts={() => setAcctDialog(true)} source={source} />
          </span>
          <span className="who" title={`${me.email} · ${me.imapHost}`}>
            <Avatar addr={{ name: me.name, address: me.email }} size={28} />
          </span>
          <button className="top-btn desk-only" onClick={onLogout} title="Sign out">
            <Icon name="signout" />
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="rail">
          <button className={`rail-btn ${view === 'mail' ? 'active' : ''}`} title="Mail" onClick={() => setView('mail')}>
            <Icon name="mail" />
          </button>
          <button className={`rail-btn ${view === 'calendar' ? 'active' : ''}`} title="Calendar" onClick={() => setView('calendar')}>
            <Icon name="calendar" />
          </button>
          <button className={`rail-btn ${view === 'contacts' ? 'active' : ''}`} title="Contacts" onClick={() => setView('contacts')}>
            <Icon name="people" />
          </button>
          <button className="rail-btn" title="Toggle folder pane" onClick={() => { setFoldersHidden(!foldersHidden); save('foldersHidden', !foldersHidden); }}>
            <Icon name="pane" />
          </button>
        </nav>

        <div className="main">
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
            <button className="tb" onClick={() => setFoldersHidden(!foldersHidden)} title="Folders">
              <Icon name="menu" />
            </button>
            <button className="tb new" onClick={() => setCompose({ mode: 'new' })}>
              <Icon name="compose" /> New mail
            </button>
            <span className="sep" />
            <button className="tb" disabled={!has} onClick={() => void doDelete()}>
              <Icon name="trash" /> <span className="lbl">Delete</span>
            </button>
            <button className="tb" disabled={!has} onClick={() => void doMove('archive')}>
              <Icon name="archive" /> <span className="lbl">Archive</span>
            </button>
            <div className="menu-wrap">
              <button className="tb" disabled={!has} onClick={() => setMoveOpen((v) => !v)}>
                <Icon name="move" /> <span className="lbl">Move</span>
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
              title={inJunk ? 'Not junk: move back to Inbox (!)' : 'Mark as junk (!)'}
            >
              <Icon name={inJunk ? 'inbox' : 'junk'} /> <span className="lbl">{inJunk ? 'Not junk' : 'Mark as junk'}</span>
            </button>
            <button className="tb" disabled={!has} onClick={toggleFlag}>
              <Icon name="flag" /> <span className="lbl">Flag</span>
            </button>
            <button className="tb" disabled={!has} onClick={toggleRead}>
              <Icon name="unread" /> <span className="lbl">Read / Unread</span>
            </button>
            <button className="tb" onClick={sync}>
              <Icon name="sync" /> <span className="lbl">Sync</span>
            </button>
          </div>

          <div className={`panes pane-${pane}`}>
            {drawer && <div className="backdrop" onClick={() => setDrawer(false)} />}
            {(!foldersHidden || drawer) && (
              <aside className={`folders ${drawer ? 'drawer-open' : ''}`} style={{ width: folderW }}>
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
                          <Icon name="close" size={16} /> <span className="fname">Locked — re-enter password</span>
                        </button>
                      )}
                      {!collapsed[k] && (trees[a.id] || []).map((n) => renderFolder(n, a.id))}
                    </div>
                  );
                })}
                <button
                  className="folder add"
                  onClick={async () => {
                    const name = prompt('New folder name');
                    if (name) {
                      try {
                        await api.createFolder(name);
                        void loadFolders();
                      } catch (err) {
                        flash((err as Error).message);
                      }
                    }
                  }}
                >
                  <span className="twisty" />
                  <Icon name="plus" size={16} /> <span className="fname">Create new folder</span>
                </button>
                <button className="folder add" onClick={() => setAcctDialog(true)}>
                  <span className="twisty" />
                  <Icon name="people" size={16} /> <span className="fname">Add account</span>
                </button>
                <div className="drawer-foot phone-only">
                  <button className="folder" onClick={() => { setView('calendar'); setDrawer(false); }}>
                    <span className="twisty" />
                    <Icon name="calendar" size={18} /> <span className="fname">Calendar</span>
                  </button>
                  <button className="folder" onClick={() => { setView('contacts'); setDrawer(false); }}>
                    <span className="twisty" />
                    <Icon name="people" size={18} /> <span className="fname">Contacts</span>
                  </button>
                  <ThemeSegment />
                  <label className="menu-check">
                    <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Show preview text
                  </label>
                  <button className="folder" onClick={onLogout}>
                    <span className="twisty" />
                    <Icon name="signout" size={18} /> <span className="fname">Sign out</span>
                  </button>
                </div>
              </aside>
            )}
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
                      {f === 'all' ? (searching ? 'Results' : current?.name || 'All') : f[0].toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                {loading && <span className="spinner" />}
              </div>
              <div className="list-scroll" ref={listRef} onScroll={onScroll}>
                {!loading && visible.length === 0 && <div className="empty">{searching ? 'No results.' : 'Nothing here. Enjoy your day.'}</div>}
                {groups.map((g) => (
                  <div key={g.label}>
                    <div className="group">{g.label}</div>
                    {g.items.map((m) => {
                      const who = isSentFolder ? m.to[0] || m.from : m.from;
                      return (
                        <div
                          key={m.uid}
                          data-uid={m.uid}
                          className={`item ${m.seen ? '' : 'unread'} ${selected.has(m.uid) ? 'sel' : ''} ${m.flagged ? 'flagged' : ''}`}
                          onClick={(e) => select(m, e)}
                          draggable
                          onDragStart={(e) => {
                            const uids = selected.has(m.uid) ? [...selected] : [m.uid];
                            e.dataTransfer.setData('application/x-goodmail', JSON.stringify(uids));
                          }}
                        >
                          <Avatar addr={who} />
                          <div className="item-main">
                            <div className="row1">
                              <span className="sender">{isSentFolder ? `To: ${displayName(who)}` : displayName(who)}</span>
                              <span className="item-actions">
                                <button title="Flag" className={m.flagged ? 'on' : ''} onClick={(e) => { e.stopPropagation(); void setFlag([m.uid], '\\Flagged', !m.flagged); }}>
                                  <Icon name="flag" size={16} filled={m.flagged} />
                                </button>
                                <button title={m.seen ? 'Mark unread' : 'Mark read'} onClick={(e) => { e.stopPropagation(); void setFlag([m.uid], '\\Seen', !m.seen); }}>
                                  <Icon name="unread" size={16} />
                                </button>
                                <button title={inJunk ? 'Not junk' : 'Mark as junk'} onClick={(e) => { e.stopPropagation(); void toggleJunk([m.uid]); }}>
                                  <Icon name={inJunk ? 'inbox' : 'junk'} size={16} />
                                </button>
                                <button title="Delete" onClick={(e) => { e.stopPropagation(); void doDelete([m.uid]); }}>
                                  <Icon name="trash" size={16} />
                                </button>
                              </span>
                            </div>
                            <div className="row2">
                              <span className="subject">{m.subject || '(no subject)'}</span>
                              <span className="meta">
                                {m.hasAttachments && <Icon name="clip" size={14} />}
                                {m.answered && <Icon name="reply" size={14} />}
                                {m.flagged && <span className="flag-mark"><Icon name="flag" size={14} filled /></span>}
                                <span className="time">{listTime(m.date)}</span>
                              </span>
                            </div>
                            {preview && <div className="row3">{m.snippet || ' '}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {hasMore && !searching && <div className="more">{loading ? 'Loading…' : ''}</div>}
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
                    flash('Message sent');
                    if (compose.source && compose.mode !== 'forward') patch([compose.source.uid], { answered: true });
                    void loadFolders();
                  }}
                />
              ) : open ? (
                <article className="message">
                  <div className="msg-head">
                    <button className="tb icon back" title="Back" onClick={closeMessage}>
                      <Icon name="chevronRight" />
                    </button>
                    <h2>{open.subject || '(no subject)'}</h2>
                    <div className="msg-actions">
                      <button className="tb icon" title="Reply (r)" onClick={() => setCompose({ mode: 'reply', source: open })}>
                        <Icon name="reply" />
                      </button>
                      <button className="tb icon" title="Reply all (a)" onClick={() => setCompose({ mode: 'replyAll', source: open })}>
                        <Icon name="replyAll" />
                      </button>
                      <button className="tb icon" title="Forward (f)" onClick={() => setCompose({ mode: 'forward', source: open })}>
                        <Icon name="forward" />
                      </button>
                      <button className="tb icon" title={inJunk ? 'Not junk (!)' : 'Mark as junk (!)'} onClick={() => void toggleJunk([open.uid])}>
                        <Icon name={inJunk ? 'inbox' : 'junk'} />
                      </button>
                      <span className="phone-only phone-actions">
                        <button className="tb icon" title="Delete" onClick={() => void doDelete()}>
                          <Icon name="trash" />
                        </button>
                        <button className="tb icon" title="Archive" onClick={() => void doMove('archive')}>
                          <Icon name="archive" />
                        </button>
                        <button className="tb icon" title="Flag" onClick={toggleFlag}>
                          <Icon name="flag" filled={open.flagged} />
                        </button>
                        <button className="tb icon" title="Mark unread" onClick={() => { void setFlag([open.uid], '\\Seen', false); closeMessage(); }}>
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
                              title="Add to contacts"
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
                          <span className="muted">To:</span> {open.to.map(displayName).join('; ') || '—'}
                          {open.cc.length > 0 && (
                            <>
                              {'  '}
                              <span className="muted">Cc:</span> {open.cc.map(displayName).join('; ')}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="date">{fullTime(open.date)}</div>
                    </div>
                    {blocked && !remote && (
                      <div className="banner">
                        <Icon name="image" size={16} /> Some external content was blocked to protect your privacy.
                        <button className="link-btn" onClick={() => setShowRemoteOnce(true)}>Show once</button>
                        <button
                          className="link-btn"
                          onClick={() => {
                            const r = { ...remoteOk, [senderKey]: true };
                            setRemoteOk(r);
                            save('remoteOk', r);
                          }}
                        >
                          Always show from {open.from.address}
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
                              <Icon name="calendar" size={16} /> Add to calendar
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
                      <p>{selected.size > 1 ? `${selected.size} items selected` : 'Select an item to read'}</p>
                      <p className="muted small">j/k to move · r reply · a reply all · f forward · e archive · Del delete · n new · / search</p>
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
          <Icon name="compose" /> New mail
        </button>
      )}
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
