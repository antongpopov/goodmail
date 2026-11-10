import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.ts';
import type { Contact } from './api.ts';
import { save, store } from './util.ts';
import type { PaneMode } from './ViewMenu.tsx';

/** Layout preferences that live in localStorage: reading pane, preview text, panel sizes, folder tree state. */
export function useLayout() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => store('collapsed', {}));
  const [foldersHidden, setFoldersHidden] = useState(() => store('foldersHidden', false));
  const [pane, setPaneState] = useState<PaneMode>(() => store('pane', 'right'));
  const [preview, setPreviewState] = useState(() => store('preview', false));
  const [oldestFirst, setOldestFirstState] = useState(() => store('oldestFirst', false));
  const [listH, setListH] = useState(() => store('listH', 300));
  const [folderW, setFolderW] = useState(() => store('folderW', 220));
  const [listW, setListW] = useState(() => store('listW', 380));
  const setPane = (p: PaneMode) => {
    setPaneState(p);
    save('pane', p);
  };
  const setOldestFirst = (v: boolean) => {
    setOldestFirstState(v);
    save('oldestFirst', v);
  };
  const setPreview = (v: boolean) => {
    setPreviewState(v);
    save('preview', v);
  };
  return { collapsed, setCollapsed, foldersHidden, setFoldersHidden, pane, setPane, preview, setPreview, oldestFirst, setOldestFirst, listH, setListH, folderW, setFolderW, listW, setListW };
}

/** True on phone-width screens (re-evaluated when the window crosses the breakpoint). */
export function usePhoneWidth() {
  const [phoneWidth, setPhoneWidth] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const on = () => setPhoneWidth(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phoneWidth;
}

/** A single transient message ("Moved 1 to Junk"); flash() replaces it and clears it after 3.5 s. */
export function useToast() {
  const [toast, setToast] = useState('');
  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? '' : cur)), 3500);
  }, []);
  return { toast, flash };
}

/** The user's contacts, reloaded whenever the Contacts view opens, plus the set of known addresses. */
export function useAddressBook(contactsViewOpen: boolean) {
  const [book, setBook] = useState<Contact[]>([]);
  const [addContact, setAddContact] = useState<Partial<Contact> | null>(null);
  const reloadBook = useCallback(() => api.contacts().then(setBook).catch(() => {}), []);
  useEffect(() => {
    void reloadBook();
  }, [reloadBook, contactsViewOpen]); // refresh when the Contacts view opens (edits from other devices)
  const known = useMemo(() => new Set(book.flatMap((c) => c.emails)), [book]);
  return { book, addContact, setAddContact, reloadBook, known };
}
