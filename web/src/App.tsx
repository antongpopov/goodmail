import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler, useAccount, currentAccount, withAcct, setOrder } from './api.ts';
import { UNI_ACCOUNT, UNI_DEFAULT, UNI_KINDS, UNI_USE, synthUid, uniKind, uniLabel } from './unified.ts';
import type { UniPrefs } from './unified.ts';
import type { MailAccount } from './api.ts';
import { Dialogs } from './Dialogs.tsx';
import type { Dialog } from './Dialogs.tsx';
import { MessageView } from './MessageView.tsx';
import { TextBtn, ActionPills, idleAct } from './actions.tsx';
import type { Act } from './actions.tsx';
import { MoveDropdown, MoveSheet } from './MovePicker.tsx';
import type { MoveTargets } from './MovePicker.tsx';
import { LangPicker } from './LangPicker.tsx';
import type { AdminMe, Features, Folder, Me, Message, Prefs, Summary } from './api.ts';
import { Icon, folderIcon } from './icons.tsx';
import { SelectBox } from './SelectBox.tsx';
import { DebugPanel } from './DebugPanel.tsx';
import { inboxCounts, totalUnseen, newMail, playChime, unlockAudio, setTabCount, showDesktop, type InboxCount } from './notify.ts';
import { allSelected, someSelected, toggleAll, toggleGroup } from './selection.ts';
import { Login } from './Login.tsx';
import { Compose } from './Compose.tsx';
import type { ComposeInit } from './Compose.tsx';
import { Contacts } from './Contacts.tsx';
import { Calendar } from './Calendar.tsx';
import { Tasks } from './Tasks.tsx';
import { SidePanel } from './SidePanel.tsx';
import { bucket, displayName, fullAddr, save, store } from './util.ts';
import { t, localTitle } from './i18n.ts';
import { listCache, msgCache, msgKey, rememberMsg, rememberList, hydrateLists, persistLists, persistSoon, clearLists } from './cache.ts';
import { folderLabel, buildTree } from './folders.ts';
import type { FolderNode } from './folders.ts';
import { Avatar } from './Avatar.tsx';
import { Splitter } from './Splitter.tsx';
import { MessageItem } from './MessageItem.tsx';
import { FolderRow } from './FolderRow.tsx';
import { ViewMenu, PaneMenu, ThemeMenu, FilterMenu, Appearance } from './ViewMenu.tsx';
import { useAddressBook, useLayout, useNotifyPrefs, useSwipePref, usePhoneWidth, useToast } from './hooks.ts';

const POLL_MS = 30_000;

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [cfg, setCfg] = useState<{ appName: string; appNames?: Record<string, string>; reset?: boolean; source: string }>({ appName: 'goodmail', source: 'https://github.com/antongpopov/goodmail' });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearLists();
      setMe(null);
    });
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
  return <Mail me={me} onName={(name) => setMe({ ...me, name })} appName={appName} source={cfg.source} onLogout={() => {
    clearLists();
    void api.logout().finally(() => setMe(null));
  }} />;
}

function Mail({ me, onName, appName, source, onLogout }: { me: Me; onName: (name: string) => void; appName: string; source: string; onLogout: () => void }) {
  const mainAcct: MailAccount = { id: 'main', email: me.email, name: me.name, provider: 'main', imapHost: me.imapHost, locked: false };
  const [accounts, setAccounts] = useState<MailAccount[]>([mainAcct]);
  const [acct, setAcctState] = useState(() => store('acct', 'main'));
  useAccount(acct); // every mail API call below acts on this mailbox
  const [allFolders, setAllFolders] = useState<Record<string, Folder[]>>({});
  const [debugOpen, setDebugOpen] = useState(false);
  useState(() => hydrateLists(me.email)); // the lists of before a reload, shown at once while the fresh ones load
  useEffect(() => {
    const save = () => persistLists(me.email);
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, [me.email]);
  const allFoldersRef = useRef(allFolders);
  allFoldersRef.current = allFolders;
  const folders = allFolders[acct] ?? [];
  const setFolders = (fn: (f: Folder[]) => Folder[]) => setAllFolders((all) => ({ ...all, [acct]: fn(all[acct] ?? []) }));
  const [folder, setFolder] = useState(() => store('folder', 'INBOX'));
  const [uni, setUniState] = useState<UniPrefs>(() => ({ ...UNI_DEFAULT, ...store<Partial<UniPrefs>>('unified', {}) }));
  const setUni = (u: UniPrefs) => {
    setUniState(u);
    save('unified', u);
  };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  useEffect(() => {
    api.prefs().then(setPrefs).catch(() => {});
  }, [me.email]);
  const mergePrefs = (p: Omit<Prefs, 'defaultSignature'>) => setPrefs((old) => ({ defaultSignature: old?.defaultSignature || '', ...p }));
  const [features, setFeatures] = useState<Features | null>(null);
  const [adminMe, setAdminMe] = useState<AdminMe | null>(null);
  useEffect(() => {
    api.features().then((f) => {
      setFeatures(f);
      // administrator rights are decided by the mail server; ask once per sign-in
      if (f.admin) api.adminMe().then(setAdminMe).catch(() => setAdminMe(null));
    }).catch(() => {});
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
  const [filter, setFilter] = useState<'all' | 'unread' | 'flagged' | 'attachments' | 'tome' | 'bulk' | 'people'>('all');
  const oldestRef = useRef(false);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const { collapsed, setCollapsed, foldersHidden, setFoldersHidden, pane, setPane, preview, setPreview, oldestFirst, setOldestFirst, sortKey, setSortKey, listH, setListH, folderW, setFolderW, listW, setListW } = useLayout();
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const notify = useNotifyPrefs();
  const { swipe, setSwipe } = useSwipePref();
  const lastCounts = useRef<Record<string, InboxCount> | null>(null);
  // New mail: compare the Inbox counts with the previous look (they are polled anyway) and chime / badge / notify.
  useEffect(() => {
    const now = inboxCounts(allFolders);
    const { n, ids } = newMail(lastCounts.current, now);
    lastCounts.current = { ...(lastCounts.current ?? {}), ...now };
    if (n > 0) {
      if (notify.sound) playChime();
      if (notify.desktop) {
        const who = ids.map((id) => (id === 'main' ? me.email : accountsRef.current.find((a) => a.id === id)?.email ?? id)).join(', ');
        showDesktop(appName, `${n === 1 ? t('One new message') : t('{n} new messages', { n })} · ${who}`);
      }
    }
    setTabCount(notify.badge ? totalUnseen(now) : 0, appName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFolders, notify.badge, appName]);
  useEffect(() => {
    // browsers allow sound only after the page was used: the first click or key press unlocks it
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
  }, []);
  // The server only pages by date, so the order sent to it matters for the date sort alone.
  const serverAsc = sortKey === 'date' && oldestFirst;
  oldestRef.current = serverAsc;
  setOrder(serverAsc);
  const { toast, flash } = useToast();
  const [moveOpen, setMoveOpen] = useState(false);
  const [sidePanel, setSidePanelState] = useState(() => store('sidePanel', false));
  const setSidePanel = (v: boolean) => {
    setSidePanelState(v);
    save('sidePanel', v);
  };
  const [drawer, setDrawer] = useState(false);
  const [view, setView] = useState<'mail' | 'contacts' | 'calendar' | 'tasks'>(() => (location.hash === '#calendar' ? 'calendar' : location.hash === '#tasks' ? 'tasks' : 'mail'));
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
  const listRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const listFor = useRef(''); // which mailbox + folder the list on screen belongs to
  // Opening a message is async; these let a newer click, or removing that very message, cancel a load still in flight.
  const openSeq = useRef(0);
  const loadingUid = useRef<number | null>(null);

  const acctRef = useRef(acct);
  acctRef.current = acct;
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  // The order of the accounts in the folder list (drag an account to change it); kept per device.
  const [acctOrder, setAcctOrder] = useState<string[]>(() => store('acctOrder', []));
  const orderedAccounts = useMemo(() => {
    const rank = (id: string) => { const i = acctOrder.indexOf(id); return i < 0 ? acctOrder.length + accounts.findIndex((a) => a.id === id) : i; };
    return accounts.slice().sort((a, b) => rank(a.id) - rank(b.id));
  }, [accounts, acctOrder]);
  const [dragAcct, setDragAcct] = useState<string | null>(null);
  const [overAcct, setOverAcct] = useState<{ id: string; after: boolean } | null>(null);
  const moveAccount = (id: string, target: string, after: boolean) => {
    if (id === target) return;
    const ids = orderedAccounts.map((a) => a.id).filter((x) => x !== id);
    const at = ids.indexOf(target) + (after ? 1 : 0);
    ids.splice(at, 0, id);
    setAcctOrder(ids);
    save('acctOrder', ids);
  };
  const usable = accounts.filter((a) => !a.locked);
  const uniOn = usable.length > 1; // the combined views only make sense with several mailboxes
  const uniIds = usable.filter((a) => uni.accounts == null || uni.accounts.includes(a.id)).map((a) => a.id);
  const uniIdsRef = useRef(uniIds);
  uniIdsRef.current = uniIds;
  const isAll = acct === UNI_ACCOUNT;
  useEffect(() => {
    if (isAll && !uniOn) goto('main', 'INBOX');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAll, uniOn]);
  const loadFolders = useCallback(
    (fresh = false, only?: string[]) =>
      Promise.all(
        accountsRef.current
          .filter((a) => !a.locked && (!only || only.includes(a.id)))
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
      if (acctRef.current !== UNI_ACCOUNT && !list.some((a) => a.id === acctRef.current && !a.locked)) goto('main', 'INBOX');
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
      const [aid, fo, uid] = [m.account ?? acctId, m.folder ?? f, m.rUid ?? m.uid]; // combined views: where the message really is
      if (aid !== 'main') continue; // extra mailboxes (Gmail throttles every command): fetch only what is opened, also in the combined views
      const k = msgKey(aid, fo, uid);
      if (msgCache.has(k) || m.size > 600_000) continue;
      try {
        rememberMsg(k, await api.message(fo, uid, true, aid));
      } catch {
        /* best effort */
      }
    }
  }, []);

  const loadList = useCallback(
    async (f: string, p: number, q: string, merge = false) => {
      // A background refresh (merge) must not cancel a load the user just started, so it doesn't take a new number;
      // any foreground load that starts meanwhile bumps reqId and the refresh result is dropped.
      const id = merge ? reqId.current : ++reqId.current;
      const acctId = currentAccount();
      const flt = q ? 'all' : filterRef.current;
      const lkey = `${acctId}\u0000${f}\u0000${q}\u0000${flt}\u0000${oldestRef.current ? 'asc' : ''}`;
      const cachedList = p === 0 ? listCache.get(lkey) : undefined;
      const where = `${acctId}\u0000${f}`;
      // The last folder list says this folder is empty: show it at once and let the server confirm quietly. A slow IMAP server
      // (Gmail: 2-7 s just to open a folder) would otherwise keep us on a spinner for a folder that has nothing to show.
      const knownEmpty = !merge && p === 0 && !q && acctId !== UNI_ACCOUNT && allFoldersRef.current[acctId]?.find((x) => x.path === f)?.total === 0;
      const quiet = merge || knownEmpty;
      if (knownEmpty) {
        setList([]);
        setHasMore(false);
        listFor.current = where;
        setLoading(false);
      } else if (cachedList && !merge) {
        setList(cachedList.messages);
        setHasMore(cachedList.hasMore);
        listFor.current = where;
      } else if (!merge && p === 0 && listFor.current !== where) {
        // Another folder or mailbox: never leave the previous one's messages on screen while this one (maybe a slow server) loads.
        setList([]);
        setHasMore(false);
        listFor.current = where;
      }
      if (!quiet) setLoading(true);
      try {
        let r;
        if (acctId === UNI_ACCOUNT) {
          const u = await api.unified(uniKind(f), p, flt, uniIdsRef.current, q);
          if (u.errors?.length) flash(u.errors.map((e) => `${accountsRef.current.find((a) => a.id === e.account)?.email ?? e.account}: ${e.error}`).join('\n'));
          r = { ...u, messages: u.messages.map((m) => ({ ...m, rUid: m.uid, uid: synthUid(accountsRef.current.findIndex((a) => a.id === m.account), m.uid) })) };
        } else r = q ? await api.search(f, q) : await api.messages(f, p, flt);
        if (id !== reqId.current) return;
        if (merge && listFor.current !== where) return; // refresh of a folder that is no longer the one on screen
        listFor.current = where;
        if (p === 0) {
          rememberList(lkey, { messages: r.messages, hasMore: r.hasMore });
          persistSoon(me.email);
          void prefetch(acctId, f, r.messages.slice(0, 4), id);
        }
        setHasMore(r.hasMore);
        // A throttled server (Gmail) sends the list first and the preview lines afterwards, so the list shows up sooner.
        const pend = r.messages.filter((m) => m.snippetPending).map((m) => m.uid);
        if (pend.length && acctId !== UNI_ACCOUNT && previewRef.current) {
          void (async () => {
            try {
              const { snippets } = await withAcct(acctId, () => api.snippets(f, pend));
              const fill = (l: Summary[]) => l.map((m) => (String(m.uid) in snippets ? { ...m, snippet: snippets[m.uid], snippetPending: false } : m));
              const cached = listCache.get(lkey);
              if (cached) cached.messages = fill(cached.messages);
              if (listFor.current === where) setList(fill);
            } catch {
              /* the previews are optional */
            }
          })();
        }
        // The server reconciles a folder's unread counter with this search; pick the corrected number up now.
        if (flt === 'unread' && p === 0 && !q && acctId !== UNI_ACCOUNT) void loadFolders();
        // A complete first page of the unfiltered folder is the truth about what is unread there: when the folder's counter
        // disagrees (mail read or removed with another client since the last poll), fix it at once instead of waiting for a reload.
        if (flt === 'all' && p === 0 && !q && !r.hasMore && acctId !== UNI_ACCOUNT) {
          const n = r.messages.filter((m) => !m.seen).length;
          const cur = allFoldersRef.current[acctId]?.find((x) => x.path === f);
          if (cur && cur.unseen !== n) {
            setAllFolders((all) => ({ ...all, [acctId]: (all[acctId] ?? []).map((x) => (x.path === f ? { ...x, unseen: n } : x)) }));
          }
        }
        setList((old) => {
          if (p === 0) return r.messages;
          const seen = new Set(old.map((m) => m.uid));
          return [...old, ...r.messages.filter((m) => !seen.has(m.uid))];
        });
      } catch (err) {
        if (id === reqId.current) flash((err as Error).message);
      } finally {
        if (id === reqId.current && !quiet) setLoading(false);
      }
    },
    [flash, loadFolders],
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

  // Switching newest first / oldest first reloads the list from the start.
  const firstOrder = useRef(true);
  useEffect(() => {
    if (firstOrder.current) {
      firstOrder.current = false;
      return;
    }
    setPage(0);
    listRef.current?.scrollTo(0, 0);
    void loadList(folder, 0, searching);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverAsc]);

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
    let tick = 0;
    const timer = setInterval(() => {
      if (document.hidden) return;
      tick++;
      // Other mailboxes (Gmail throttles every single command) are refreshed every 2 minutes; the login mailbox every 30 s.
      const other = acct !== 'main' && acct !== UNI_ACCOUNT;
      void (tick % 4 === 0 ? loadFolders() : loadFolders(false, other ? ['main'] : [acct, 'main']));
      if (!searching && page === 0 && (!other || tick % 4 === 0)) void loadList(folder, 0, '', true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [folder, acct, page, searching, loadFolders, loadList]);

  const current = folders.find((f) => f.path === folder);
  const moveTargets: MoveTargets = {
    accounts: usable.map((a) => ({ id: a.id, email: a.email, folders: allFolders[a.id] || [] })).sort((x, y) => Number(y.id === acct) - Number(x.id === acct)),
    curAccount: isAll ? '' : acct,
    curFolder: isAll ? '' : folder,
    onPick: (aid, path, move) => void doTransfer(aid, path, move),
  };
  const trees = useMemo(() => Object.fromEntries(Object.entries(allFolders).map(([id, f]) => [id, buildTree(f)])), [allFolders]);
  const visibleRef = useRef<Summary[]>([]);
  const visible = useMemo(() => {
    const l = list.filter((m) => (filter === 'unread' ? !m.seen : filter === 'flagged' ? m.flagged : filter === 'attachments' ? m.hasAttachments : true));
    if (sortKey === 'date') return l;
    const name = (m: Summary) => (m.from.name || m.from.address || '').toLowerCase();
    const cmp: Record<string, (a: Summary, b: Summary) => number> = {
      from: (a, b) => name(a).localeCompare(name(b)),
      subject: (a, b) => (a.subject || '').toLowerCase().localeCompare((b.subject || '').toLowerCase()),
      size: (a, b) => a.size - b.size,
      flagged: (a, b) => Number(a.flagged) - Number(b.flagged),
    };
    const sgn = oldestFirst ? 1 : -1;
    return l.slice().sort((a, b) => sgn * cmp[sortKey](a, b) || b.date - a.date);
  }, [list, filter, sortKey, oldestFirst]);
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

  const patch = (uids: number[], p: Partial<Summary>) => {
    setList((l) => l.map((m) => (uids.includes(m.uid) ? { ...m, ...p } : m)));
    // Keep the cached copies of this folder's list in step too, or going away and back shows the old (bold/unflagged) state until the server answers.
    const prefix = `${currentAccount()}\u0000${folder}\u0000`;
    for (const [k, v] of listCache) if (k.startsWith(prefix)) v.messages = v.messages.map((m) => (uids.includes(m.uid) ? { ...m, ...p } : m));
  };

  const openMessage = useCallback(
    async (m: Summary) => {
      setCompose(null);
      const acctId = currentAccount();
      const [aid, fo, ru] = [m.account ?? acctId, m.folder ?? folder, m.rUid ?? m.uid]; // combined views: where the message really is
      const k = msgKey(aid, fo, ru);
      const hit = msgCache.get(k);
      const seq = ++openSeq.current;
      loadingUid.current = m.uid;
      if (!hit) setOpenLoading(true);
      try {
        const full = hit ?? (await api.message(fo, ru, false, aid));
        rememberMsg(k, full);
        if (seq !== openSeq.current) return; // a newer click, or the message was archived/deleted meanwhile
        setOpen(m.rUid ? { ...full, uid: m.uid, realUid: ru, folder: fo } : full);
        if (hit && !m.seen) void withAcct(aid, () => api.flags(fo, [ru], ['\\Seen'])).catch(() => {});
        // warm up the next message in the list, the usual next click (or j)
        const idx = visibleRef.current.findIndex((x) => x.uid === m.uid);
        const next = visibleRef.current[idx + 1];
        if (next) void prefetch(acctId, folder, [next]);
        if (!m.seen) {
          patch([m.uid], { seen: true });
          setAllFolders((all) => ({ ...all, [aid]: (all[aid] ?? []).map((f) => (f.path === fo ? { ...f, unseen: Math.max(0, f.unseen - 1) } : f)) }));
        }
      } catch (err) {
        if (seq === openSeq.current) flash((err as Error).message);
      } finally {
        if (seq === openSeq.current) {
          loadingUid.current = null;
          setOpenLoading(false);
        }
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
    const prefix = `${currentAccount()}\u0000${folder}\u0000`;
    for (const [k, v] of listCache) if (k.startsWith(prefix)) v.messages = v.messages.filter((m) => !uids.includes(m.uid));
    const next = remaining[Math.min(idx, remaining.length - 1)];
    // Is the message on screen, or still loading into the reading pane, one of those going away?
    const loadingGone = loadingUid.current !== null && uids.includes(loadingUid.current);
    if (loadingGone) {
      openSeq.current++; // drop the load in flight
      loadingUid.current = null;
      setOpenLoading(false);
    }
    if (next && uids.length === 1 && ((open && uids.includes(open.uid)) || loadingGone)) {
      setSelected(new Set([next.uid]));
      setAnchor(next.uid);
      void openMessage(next);
    } else {
      setSelected(new Set());
      if ((open && uids.includes(open.uid)) || loadingGone) setOpen(null);
    }
  };

  /** Which mailbox/folder the selected rows really belong to (in the combined views they come from several). */
  const groupsOf = (uids: number[]) => {
    const g = new Map<string, { aid: string; folder: string; uids: number[] }>();
    for (const u of uids) {
      const m = list.find((x) => x.uid === u);
      const [aid, fo, ru] = [m?.account ?? acct, m?.folder ?? folder, m?.rUid ?? u];
      const k = `${aid}\u0000${fo}`;
      if (!g.has(k)) g.set(k, { aid, folder: fo, uids: [] });
      g.get(k)!.uids.push(ru);
    }
    return [...g.values()];
  };

  const doDelete = async (uids = targetUids()) => {
    if (!uids.length) return;
    const groups = groupsOf(uids);
    removeFromList(uids);
    try {
      let permanent = false;
      for (const g of groups) permanent = (await withAcct(g.aid, () => api.remove(g.folder, g.uids))).permanent || permanent;
      const r = { permanent };
      flash(r.permanent ? t('Deleted {n} permanently', { n: uids.length }) : t('Moved {n} to the trash', { n: uids.length }));
      listCache.clear(); // the target folders' cached lists (Trash, the move target…) are out of date now
      void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
      void loadList(folder, 0, searching);
    }
  };

  /** Move or copy to a folder of this or another mailbox (the Move menu). */
  const doTransfer = async (toAcct: string, to: string, move: boolean, uids = targetUids()) => {
    if (!uids.length) return;
    setMoveOpen(false);
    const groups = groupsOf(uids);
    if (move) removeFromList(uids);
    const label = (() => {
      const f = (allFolders[toAcct] || []).find((x) => x.path === to);
      const name = f ? folderLabel(f) : to;
      return usable.length > 1 ? `${name} (${accounts.find((a) => a.id === toAcct)?.email ?? toAcct})` : name;
    })();
    try {
      let n = 0;
      for (const g of groups) {
        if (move && g.aid === toAcct) await withAcct(g.aid, () => api.move(g.folder, g.uids, to));
        else if (g.aid === toAcct && g.folder === to) continue;
        else await withAcct(g.aid, () => api.transfer(g.folder, g.uids, toAcct, to, move));
        n += g.uids.length;
      }
      if (n) flash(t(move ? 'Moved {n} to {folder}' : 'Copied {n} to {folder}', { n, folder: label }));
      listCache.clear(); // the target folders' cached lists (Trash, the move target…) are out of date now
      void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
      void loadList(folder, 0, searching);
    }
  };
  const doMove = async (to: string, uids = targetUids()) => {
    if (!uids.length) return;
    setMoveOpen(false);
    if (isAll && !['archive', 'junk', 'INBOX'].includes(to)) return flash(t('Open the mailbox itself to move mail to another folder'));
    const groups = groupsOf(uids);
    removeFromList(uids);
    try {
      let r = { to };
      for (const g of groups) r = await withAcct(g.aid, () => api.move(g.folder, g.uids, to));
      flash(t('Moved {n} to {folder}', { n: uids.length, folder: (() => { const f = folders.find((x) => x.path === r.to); return f ? folderLabel(f) : r.to; })() }));
      listCache.clear(); // the target folders' cached lists (Trash, the move target…) are out of date now
      void loadFolders(true);
    } catch (err) {
      flash((err as Error).message);
      void loadList(folder, 0, searching);
    }
  };

  const setFlag = async (uids: number[], flag: '\\Seen' | '\\Flagged', on: boolean) => {
    if (!uids.length) return;
    patch(uids, flag === '\\Seen' ? { seen: on } : { flagged: on });
    if (flag === '\\Flagged') for (const g of groupsOf(uids)) for (const u of g.uids) { const c = msgCache.get(msgKey(g.aid, g.folder, u)); if (c) c.flagged = on; }
    if (open && uids.includes(open.uid) && flag === '\\Flagged') setOpen({ ...open, flagged: on });
    try {
      for (const g of groupsOf(uids)) await withAcct(g.aid, () => api.flags(g.folder, g.uids, on ? [flag] : [], on ? [] : [flag]));
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
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        if (visible.length) {
          setSelected(new Set(visible.map((m) => m.uid)));
          setAnchor(visible[0].uid);
          if (visible.length > 1) setOpen(null);
        }
        return;
      }
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

  // A filtered page can come back short (e.g. Attachments): keep loading while the list is too short to scroll.
  useEffect(() => {
    const el = listRef.current;
    if (!el || loading || !hasMore || searching || view !== 'mail') return;
    if (el.scrollHeight - 400 <= el.clientHeight) {
      const p = page + 1;
      setPage(p);
      setLoading(true);
      void loadList(folder, p, '');
    }
  }, [list, hasMore, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g: { label: string; items: Summary[] }[] = [];
    for (const m of visible) {
      const label = sortKey === 'date' ? bucket(m.date) : '';
      if (g[g.length - 1]?.label !== label) g.push({ label, items: [] });
      g[g.length - 1].items.push(m);
    }
    return g;
  }, [visible, sortKey]);

  // Select all: the toolbar tickbox, a tickbox on each day header, and Ctrl/Cmd-A.
  const allSel = allSelected(selected, visible);
  const someSel = someSelected(selected, visible);
  const toggleAllRows = () => {
    const n = toggleAll(selected, visible);
    setSelected(n);
    setAnchor(visible[0]?.uid ?? null);
    if (n.size > 1) setOpen(null);
  };

  const uniK = isAll ? uniKind(folder) : '';
  const isSentFolder = isAll ? uniK === 'sent' || uniK === 'drafts' : current?.specialUse === '\\Sent' || current?.specialUse === '\\Drafts';
  // In the Junk folder the junk buttons turn into "Not junk" (move back to Inbox). On servers that learn from
  // Junk moves (rspamd/IMAPSieve) this is also what trains the spam filter.
  const inJunk = isAll ? uniK === 'junk' : current?.specialUse === '\\Junk';
  const toggleJunk = (uids = targetUids()) => doMove(inJunk ? 'INBOX' : 'junk', uids);
  const has = targetUids().length > 0;
  /** Open the rule editor pre-filled from a message (who it came from, or who it went to in Sent/Drafts). */
  const ruleFrom = (m: { from: { name: string; address: string }; to: { name: string; address: string }[] }) => {
    const w = isSentFolder ? m.to[0] || m.from : m.from;
    setDialog({ kind: 'rules', seed: { name: displayName(w), address: w.address, field: isSentFolder ? 'to' : 'from' } });
  };

  // Each action is defined once; the desktop toolbar, the message header and the phone toolbar all render these.
  const act = {
    delete: { icon: 'trash', label: t('Delete'), run: () => void doDelete(), disabled: !has },
    archive: { icon: 'archive', label: t('Archive'), run: () => void doMove('archive'), disabled: !has },
    move: { icon: 'move', label: t('Move'), run: () => setMoveOpen((v) => !v), disabled: !has },
    junk: {
      icon: inJunk ? 'inbox' : 'junk',
      label: inJunk ? t('Not junk') : t('Mark as junk'),
      title: inJunk ? t('Not junk: move back to Inbox (!)') : t('Mark as junk (!)'),
      run: () => void toggleJunk(),
      disabled: !has,
    },
    flag: { icon: 'flag', label: t('Flag'), run: toggleFlag, disabled: !has },
    read: { icon: 'unread', label: t('Read / Unread'), run: toggleRead, disabled: !has },
    sync: { icon: 'sync', label: t('Sync'), run: sync },
  } satisfies Record<string, Act>;
  const messageActs = (m: Message) => ({
    reply: { icon: 'reply', label: t('Reply (r)'), run: () => setCompose({ mode: 'reply', source: m }) },
    replyAll: { icon: 'replyAll', label: t('Reply all (a)'), run: () => setCompose({ mode: 'replyAll', source: m }) },
    forward: { icon: 'forward', label: t('Forward (f)'), run: () => setCompose({ mode: 'forward', source: m }) },
    junk: { ...act.junk, label: inJunk ? t('Not junk (!)') : t('Mark as junk (!)'), title: undefined },
    headers: { icon: 'code', label: t('View headers'), run: () => setDialog({ kind: 'headers', folder: m.realUid ? m.folder || folder : folder, uid: m.realUid ?? m.uid, account: m.account }) },
    rule: features?.rules && (m.account ?? acct) === 'main' ? { icon: 'folder', label: t('Create rule from this message…'), run: () => ruleFrom(m) } : undefined,
    delete: act.delete,
    archive: act.archive,
    move: act.move,
    flag: { ...act.flag, filled: m.flagged },
    unread: { icon: 'unread', label: t('Mark unread'), run: () => { void setFlag([m.uid], '\\Seen', false); closeMessage(); } },
  });

  // The pills in the top bar: the open message's own actions, or greyed out while none is open.
  const ma = open ? messageActs(open) : null;
  const pillActs = {
    reply: ma?.reply ?? idleAct('reply', t('Reply (r)')),
    replyAll: ma?.replyAll ?? idleAct('replyAll', t('Reply all (a)')),
    forward: ma?.forward ?? idleAct('forward', t('Forward (f)')),
    archive: act.archive,
    delete: act.delete,
    junk: ma?.junk ?? act.junk,
    move: act.move,
    flag: ma?.flag ?? act.flag,
    headers: ma?.headers ?? idleAct('code', t('View headers')),
    rule: ma?.rule,
    unread: ma?.unread ?? idleAct('unread', t('Mark unread')),
  };

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
    // inside Trash already? Then it really is deleted for good — say so, don't promise a way back.
    const trash = (allFolders[aid] || []).find((f) => f.specialUse === '\\Trash');
    const inTrash = !trash || n.path.startsWith(trash.path + (n.delimiter || '/'));
    const msg = inTrash
      ? n.total ? t('Permanently delete the folder "{name}" and its {n} messages?', { name: n.name, n: n.total }) : t('Permanently delete the folder "{name}"?', { name: n.name })
      : n.total ? t('Delete the folder "{name}" and its {n} messages?', { name: n.name, n: n.total }) : t('Delete the folder "{name}"?', { name: n.name });
    if (!confirm(msg + '\n\n' + (inTrash ? t('This cannot be undone.') : t('It moves to Trash, where you can still get it back.')))) return;
    try {
      useAccount(aid);
      const r = await api.deleteFolder(n.path);
      if (aid === acct && (folder === n.path || folder.startsWith(n.path + n.delimiter))) goto(aid, 'INBOX');
      void loadFolders(true);
      flash(r.permanent ? t('Folder deleted') : t('Folder moved to Trash'));
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
                {uniOn && (
                  <div className="acct-tree">
                    {UNI_KINDS.filter((k) => uni.entries.includes(k)).map((k) => {
                      const unseen = k === 'inbox' ? uniIds.reduce((n, id) => n + ((allFolders[id] || []).find((f) => f.specialUse === '\\Inbox')?.unseen || 0), 0) : 0;
                      return (
                        <button key={k} className={`folder ${isAll && folder === `@${k}` ? 'active' : ''}`} onClick={() => openFolder(UNI_ACCOUNT, `@${k}`)}>
                          <span className="twisty" />
                          <Icon name={folderIcon(UNI_USE[k])} size={18} /> <span className="fname">{uniLabel(k)}</span>
                          {unseen > 0 && <span className="count">{unseen}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {orderedAccounts.map((a) => {
                  const k = `acct:${a.id}`;
                  const unseen = (allFolders[a.id] || []).find((f) => f.specialUse === '\\Inbox')?.unseen || 0;
                  return (
                    <div
                      key={a.id}
                      className={`acct-tree ${overAcct?.id === a.id && dragAcct !== a.id ? (overAcct.after ? 'drop-after' : 'drop-before') : ''}`}
                      onDragOver={(e) => {
                        if (!dragAcct || !e.dataTransfer.types.includes('application/x-gm-account')) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > r.top + r.height / 2;
                        if (overAcct?.id !== a.id || overAcct.after !== after) setOverAcct({ id: a.id, after });
                      }}
                      onDrop={(e) => {
                        if (!dragAcct) return;
                        e.preventDefault();
                        moveAccount(dragAcct, a.id, !!overAcct?.after);
                        setDragAcct(null);
                        setOverAcct(null);
                      }}
                    >
                      <button
                        className="account"
                        draggable={accounts.length > 1}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-gm-account', a.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragAcct(a.id);
                        }}
                        onDragEnd={() => { setDragAcct(null); setOverAcct(null); }}
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
                      {orderedAccounts.length > 1 && (
                        <span className="acct-move">
                          {(['up', 'down'] as const).map((dir) => {
                            const i = orderedAccounts.findIndex((x) => x.id === a.id);
                            const to = orderedAccounts[i + (dir === 'up' ? -1 : 1)];
                            return (
                              <button key={dir} disabled={!to} title={dir === 'up' ? t('Move up') : t('Move down')} aria-label={dir === 'up' ? t('Move up') : t('Move down')} onClick={() => to && moveAccount(a.id, to.id, dir === 'down')}>
                                <Icon name={dir === 'up' ? 'chevronUp' : 'chevronDown'} size={16} />
                              </button>
                            );
                          })}
                        </span>
                      )}
                      {a.locked && (
                        <button className="folder muted" onClick={() => setDialog({ kind: 'accounts' })}>
                          <span className="twisty" />
                          <Icon name="close" size={16} /> <span className="fname">{t('Locked — re-enter password')}</span>
                        </button>
                      )}
                      {!collapsed[k] && (trees[a.id] || []).map((n) => renderFolder(n, a.id))}
                      {!collapsed[k] && !a.locked && (
                        <button
                          className="folder add"
                          onClick={async () => {
                            const name = prompt(t('New folder name') + ' (' + a.email + ')');
                            if (!name || !name.trim()) return;
                            try {
                              useAccount(a.id);
                              await api.createFolder(name.trim());
                              void loadFolders(true);
                            } catch (err) {
                              flash((err as Error).message);
                            } finally {
                              useAccount(acct);
                            }
                          }}
                        >
                          <span className="twisty" />
                          <Icon name="plus" size={16} /> <span className="fname">{t('Create new folder')}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
                <button className="folder add phone-only" onClick={() => setDialog({ kind: 'accounts' })}>
                  <span className="twisty" />
                  <Icon name="people" size={16} /> <span className="fname">{t('Add account')}</span>
                </button>
                <div className="drawer-foot phone-only">
                  <button className="folder" onClick={() => { setView('calendar'); setDrawer(false); }}>
                    <span className="twisty" />
                    <Icon name="calendar" size={18} /> <span className="fname">{t('Calendar')}</span>
                  </button>
                  <button className="folder" onClick={() => { setView('tasks'); setDrawer(false); }}>
                    <span className="twisty" />
                    <Icon name="tasks" size={18} /> <span className="fname">{t('To-Do')}</span>
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
                  <button className="folder" onClick={() => { setDialog({ kind: 'signatures', tab: 'signature' }); setDrawer(false); }}>
                    <span className="twisty" />
                    <Icon name="drafts" size={18} /> <span className="fname">{t('Signatures & templates…')}</span>
                  </button>
                  {features?.smime && (
                    <button className="folder" onClick={() => { setDialog({ kind: 'smime' }); setDrawer(false); }}>
                      <span className="twisty" />
                      <Icon name="shield" size={18} /> <span className="fname">{t('Secure mail (S/MIME)…')}</span>
                    </button>
                  )}
                  {features?.rules && (
                    <button className="folder" onClick={() => { setDialog({ kind: 'rules' }); setDrawer(false); }}>
                      <span className="twisty" />
                      <Icon name="folder" size={18} /> <span className="fname">{t('Mail rules…')}</span>
                    </button>
                  )}
                  {adminMe?.admin && (
                    <button className="folder" onClick={() => { setDialog({ kind: 'admin' }); setDrawer(false); }}>
                      <span className="twisty" />
                      <Icon name="people" size={18} /> <span className="fname">{t('Administration…')}</span>
                    </button>
                  )}
                  <button className="folder" onClick={() => { setDialog({ kind: 'security' }); setDrawer(false); }}>
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

  const filterTabs = <FilterMenu filter={filter} onFilter={setFilter} sortKey={sortKey} onSortKey={setSortKey} oldestFirst={oldestFirst} onOrder={setOldestFirst} />;

  return (
    <div className="app">
      {debugOpen && features?.debug && <DebugPanel onClose={() => setDebugOpen(false)} />}
      <header className="topbar">
        <button className="top-btn phone-only" onClick={() => setDrawer(true)} title={t('Folders')}>
          <Icon name="menu" />
        </button>
        <div className="brand">
          <span className="who" title={`${me.email} · ${me.imapHost}`}>
            <Avatar addr={{ name: me.name, address: me.email }} size={28} />
          </span>
          {appName}
        </div>
        <nav className="apps desk-only">
          {(
            [
              ['mail', 'mail', t('Mail')],
              ['calendar', 'calendar', t('Calendar')],
              ['tasks', 'tasks', t('To-Do')],
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
        {view === 'mail' && <ActionPills acts={pillActs} />}
        {view === 'mail' && (
          <button className={`top-btn phone-only ${loading ? 'spin' : ''}`} title={t('Sync')} aria-label={t('Sync')} onClick={sync}>
            <Icon name="sync" />
          </button>
        )}
        <div className="top-right">
          {view === 'mail' && (
            <span className="desk-only">
              <button className={`top-btn ${preview ? 'on' : ''}`} title={t('Show preview text')} aria-label={t('Show preview text')} aria-pressed={preview} onClick={() => setPreview(!preview)}>
                <Icon name="preview" />
              </button>
            </span>
          )}
          {view === 'mail' && <span className="desk-only"><PaneMenu pane={pane} onPane={setPane} /></span>}
          {features?.debug && (
            <span className="desk-only">
              <button className={`top-btn ${debugOpen ? 'on' : ''}`} title="Debug: what goodmail is doing in the background" aria-label="Debug" aria-pressed={debugOpen} onClick={() => setDebugOpen(!debugOpen)}>
                <Icon name="bug" />
              </button>
            </span>
          )}
          <span className="desk-only"><ThemeMenu /></span>
          <span className="desk-only">
            <ViewMenu swipe={swipe} onSwipe={setSwipe} notify={{ ...notify, test: playChime }} onAccounts={() => setDialog({ kind: 'accounts' })} onSecurity={() => setDialog({ kind: 'security' })} onRules={features?.rules ? () => setDialog({ kind: 'rules' }) : undefined} onSmime={features?.smime ? () => setDialog({ kind: 'smime' }) : undefined} onSignatures={() => setDialog({ kind: 'signatures', tab: 'signature' })} onAdmin={adminMe?.admin ? () => setDialog({ kind: 'admin' }) : undefined} source={source} />
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
          ) : view === 'tasks' ? (
            <Tasks flash={flash} isPhone={phoneWidth} onFlagged={() => { setFilter('flagged'); setView('mail'); }} />
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
            <SelectBox checked={allSel} indeterminate={someSel} disabled={visible.length === 0} label={allSel ? t('Deselect all') : t('Select all')} onChange={toggleAllRows} />
            <TextBtn a={act.delete} />
            <TextBtn a={act.archive} />
            <div className="menu-wrap">
              <TextBtn a={act.move} />
              {moveOpen && <MoveDropdown targets={moveTargets} onClose={() => setMoveOpen(false)} />}
            </div>
            <TextBtn a={act.junk} />
            <TextBtn a={act.flag} />
            <TextBtn a={act.read} />
            <TextBtn a={act.sync} />
            <span className="grow" />
            {loading && <span className="spinner" />}
            <div className="tool-tabs">{filterTabs}</div>
            <button className={`tb icon side-toggle ${sidePanel ? 'on' : ''}`} title={t('Calendar panel')} aria-label={t('Calendar panel')} aria-pressed={sidePanel} onClick={() => setSidePanel(!sidePanel)}>
              <Icon name="sidePanel" size={18} />
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
              <div className="list-head phone-only">
                {filterTabs}
                {loading && <span className="spinner" />}
              </div>
              <div className="list-scroll" ref={listRef} onScroll={onScroll}>
                {loading && visible.length === 0 && <div className="empty loading" role="status"><span className="spinner" /> {t('Loading…')}</div>}
                {!loading && visible.length === 0 && <div className="empty">{searching ? t('No results.') : t('Nothing here. Enjoy your day.')}</div>}
                {groups.map((g) => (
                  <div key={g.label}>
                    {g.label && (
                      <div className="group">
                        {g.label}
                        <SelectBox
                          className="grp"
                          checked={allSelected(selected, g.items)}
                          indeterminate={someSelected(selected, g.items)}
                          label={t(allSelected(selected, g.items) ? 'Deselect all in “{label}”' : 'Select all in “{label}”', { label: g.label })}
                          onChange={() => setSelected(toggleGroup(selected, g.items))}
                        />
                      </div>
                    )}
                    {g.items.map((m) => (
                      <MessageItem
                        key={m.uid}
                        m={m}
                        who={isSentFolder ? m.to[0] || m.from : m.from}
                        isSentFolder={isSentFolder}
                        selected={selected.has(m.uid)}
                        selectedUids={selected}
                        preview={preview}
                        compact={pane !== 'right' && !phoneWidth}
                        inJunk={inJunk}
                        onSelect={select}
                        onFlag={setFlag}
                        onToggleJunk={toggleJunk}
                        onDelete={doDelete}
                        onArchive={(u) => void doMove('archive', u)}
                        swipe={swipe}
                        onRule={features?.rules && (acct === 'main' || (isAll && m.account === 'main')) ? ruleFrom : undefined}
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
                  features={features}
                  prefs={prefs}
                  onManage={(tab) => setDialog({ kind: 'signatures', tab })}
                  onPrefsChange={mergePrefs}
                  init={compose}
                  accounts={accounts.filter((a) => !a.locked)}
                  defaultFrom={compose.source?.account || (isAll ? 'main' : acct)}
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
                <MessageView
                  key={`${open.account ?? acct}-${folder}-${open.uid}`}
                  msg={open}
                  folder={open.realUid ? open.folder || folder : folder}
                  known={known}
                  acts={messageActs(open)}
                  onBack={closeMessage}
                  onAddContact={(name, email) => {
                    setAddContact({ name, emails: [email] });
                    setView('contacts');
                  }}
                  onAddToCalendar={(url) => void addToCalendar(url)}
                />
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
            {sidePanel && !phoneWidth && <SidePanel onOpenCalendar={() => setView('calendar')} flash={flash} />}
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
      {moveOpen && <MoveSheet targets={moveTargets} onClose={() => setMoveOpen(false)} />}
      <Dialogs
        dialog={dialog}
        close={() => setDialog(null)}
        flash={flash}
        features={features}
        prefs={prefs}
        setPrefs={setPrefs}
        accounts={accounts}
        uni={uni}
        setUni={setUni}
        mainAcct={mainAcct}
        onAccountsChanged={() => void loadAccounts()}
        adminMe={adminMe}
        onSecurity={() => setDialog({ kind: 'security' })}
        onMainName={(name) => {
          onName(name);
          api.prefs().then(setPrefs).catch(() => {}); // the default signature uses the name
        }}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
