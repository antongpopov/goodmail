import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { LangPicker } from './LangPicker.tsx';
import { loadTheme, setTheme, ACCENTS, loadAccent, setAccent } from './theme.ts';
import type { Theme } from './theme.ts';
import { t, clockPref, setClock, dateFmtPref, setDateFmt } from './i18n.ts';
import type { Clock, DateFmt } from './i18n.ts';
import type { SortKey } from './unified.ts';

const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: 'auto', label: t('Auto (system)'), icon: 'auto' },
  { id: 'light', label: t('Light'), icon: 'sun' },
  { id: 'dark', label: t('Dark'), icon: 'moon' },
];

export type PaneMode = 'right' | 'below' | 'hidden';
const PANES: { id: PaneMode; label: string }[] = [
  { id: 'right', label: t('Right') },
  { id: 'below', label: t('Below') },
  { id: 'hidden', label: t('Hidden') },
];

const PANE_ICON: Record<PaneMode, string> = { right: 'pane', below: 'paneBelow', hidden: 'paneHidden' };

/** Top-bar button for the reading pane position (right / below / hidden). */
export function PaneMenu({ pane, onPane }: { pane: PaneMode; onPane: (p: PaneMode) => void }) {
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
      <button className="top-btn" title={t('Reading pane')} aria-label={t('Reading pane')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={PANE_ICON[pane]} />
      </button>
      {open && (
        <div className="menu menu-right" role="menu">
          <div className="menu-label">{t('Reading pane')}</div>
          {PANES.map((p) => (
            <button key={p.id} role="menuitemradio" aria-checked={pane === p.id} className={pane === p.id ? 'menu-on' : ''} onClick={() => { onPane(p.id); setOpen(false); }}>
              <Icon name={PANE_ICON[p.id]} size={18} /> <span className="grow">{p.label}</span>
              {pane === p.id && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type MsgFilter = 'all' | 'unread' | 'flagged' | 'attachments' | 'tome';
const SORT_KEYS: [SortKey, () => string][] = [['date', () => t('Date')], ['from', () => t('From')], ['subject', () => t('Subject')], ['size', () => t('Size')], ['flagged', () => t('Flagged')]];
/** Names of the two directions for each sort key: [ascending, descending]. */
const DIRECTIONS: Record<SortKey, [() => string, () => string]> = {
  date: [() => t('Oldest on top'), () => t('Newest on top')],
  from: [() => t('A to Z'), () => t('Z to A')],
  subject: [() => t('A to Z'), () => t('Z to A')],
  size: [() => t('Smallest on top'), () => t('Largest on top')],
  flagged: [() => t('Flagged last'), () => t('Flagged on top')],
};

/** Outlook-style "Filter and sort" menu for the message list. */
export function FilterMenu({ filter, onFilter, sortKey, onSortKey, oldestFirst, onOrder }: { filter: MsgFilter; onFilter: (f: MsgFilter) => void; sortKey: SortKey; onSortKey: (k: SortKey) => void; oldestFirst: boolean; onOrder: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const FILTERS: [MsgFilter, string, string][] = [['unread', 'unread', t('Unread')], ['flagged', 'flag', t('Flagged')], ['tome', 'people', t('To me')], ['attachments', 'clip', t('Has files')]];
  const item = (on: boolean, icon: string | null, label: string, onClick: () => void) => (
    <button role="menuitemradio" aria-checked={on} className={on ? 'menu-on' : ''} onClick={onClick}>
      {icon ? <Icon name={icon} size={18} /> : <span className="menu-gap" />} <span className="grow">{label}</span>
      {on && <Icon name="check" size={16} />}
    </button>
  );
  const active = filter !== 'all' || sortKey !== 'date' || oldestFirst;
  return (
    <div className="menu-wrap filter-wrap" ref={ref}>
      <button className={`tb icon ${active ? 'filter-on' : ''}`} title={t('Filter and sort')} aria-label={t('Filter and sort')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="filter" size={18} />
      </button>
      {open && (
        <div className="menu menu-right filter-menu" role="menu">
          <div className="menu-label">{t('Filter by')}</div>
          {FILTERS.map(([id, icon, label]) => item(filter === id, icon, label, () => { onFilter(filter === id ? 'all' : id); setOpen(false); }))}
          <div className="menu-label">{t('Sort by')}</div>
          {SORT_KEYS.map(([k, label]) => item(sortKey === k, null, label(), () => onSortKey(k)))}
          <div className="menu-sep" />
          {item(oldestFirst, null, DIRECTIONS[sortKey][0](), () => onOrder(true))}
          {item(!oldestFirst, null, DIRECTIONS[sortKey][1](), () => onOrder(false))}
        </div>
      )}
    </div>
  );
}

/** Top-bar button for light / dark / auto. */
export function ThemeMenu() {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const cur = THEMES.find((x) => x.id === theme) || THEMES[0];
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="top-btn" title={t('Theme')} aria-label={t('Theme')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={cur.icon} />
      </button>
      {open && (
        <div className="menu menu-right" role="menu">
          <div className="menu-label">{t('Theme')}</div>
          {THEMES.map((th) => (
            <button key={th.id} role="menuitemradio" aria-checked={th.id === theme} className={th.id === theme ? 'menu-on' : ''} onClick={() => { setThemeState(th.id); setTheme(th.id); setOpen(false); }}>
              <Icon name={th.icon} size={18} /> <span className="grow">{th.label}</span>
              {th.id === theme && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A dropdown that looks like the language picker. */
function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (id: string) => void }) {
  return (
    <label className="lang-picker wide">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ViewMenu({ preview, onPreview, onAccounts, onSecurity, onRules, onSmime, onSignatures, onAdmin, source }: { preview: boolean; onPreview: (v: boolean) => void; onAccounts: () => void; onSecurity: () => void; onRules?: () => void; onSmime?: () => void; onSignatures?: () => void; onAdmin?: () => void; source: string }) {
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
      <button className="top-btn" title={t('View settings')} onClick={() => setOpen((v) => !v)}>
        <Icon name="settings" />
      </button>
      {open && (
        <div className="menu view-menu">
          <div className="menu-label">{t('Color')}</div>
          <Appearance modes={false} />
          <div className="menu-row">
            <div className="menu-label">{t('Date format')}</div>
            <Choice
              label={t('Date format')}
              value={dateFmtPref()}
              options={[['auto', t('Automatic')], ['dmy', 'DD/MM/YYYY'], ['mdy', 'MM/DD/YYYY'], ['ymd', 'YYYY-MM-DD']]}
              onChange={(id) => id !== dateFmtPref() && setDateFmt(id as DateFmt)}
            />
          </div>
          <div className="menu-row">
            <div className="menu-label">{t('Time format')}</div>
            <Choice
              label={t('Time format')}
              value={clockPref()}
              options={[['auto', t('Automatic')], ['12', t('12-hour')], ['24', t('24-hour')]]}
              onChange={(id) => id !== clockPref() && setClock(id as Clock)}
            />
          </div>
          <div className="menu-label">{t('Message list')}</div>
          <label className="menu-check">
            <input type="checkbox" checked={preview} onChange={(e) => onPreview(e.target.checked)} /> {t('Show preview text')}
          </label>
          <div className="menu-row">
            <div className="menu-label">{t('Language')}</div>
            <LangPicker className="wide" />
          </div>
          <div className="menu-label">{t('Mail accounts')}</div>
          <button className="menu-btn" onClick={() => { setOpen(false); onAccounts(); }}>
            <Icon name="people" size={16} /> {t('Manage accounts…')}
          </button>
          {onSignatures && (
            <button className="menu-btn" onClick={() => { setOpen(false); onSignatures(); }}>
              <Icon name="drafts" size={16} /> {t('Signatures & templates…')}
            </button>
          )}
          {onRules && (
            <button className="menu-btn" onClick={() => { setOpen(false); onRules(); }}>
              <Icon name="folder" size={16} /> {t('Mail rules…')}
            </button>
          )}
          {onSmime && (
            <button className="menu-btn" onClick={() => { setOpen(false); onSmime(); }}>
              <Icon name="shield" size={16} /> {t('Secure mail (S/MIME)…')}
            </button>
          )}
          {onAdmin && (
            <button className="menu-btn" onClick={() => { setOpen(false); onAdmin(); }}>
              <Icon name="people" size={16} /> {t('Administration…')}
            </button>
          )}
          <button className="menu-btn" onClick={() => { setOpen(false); onSecurity(); }}>
            <Icon name="check" size={16} /> {t('Sign-in security…')}
          </button>
          <div className="about">
            goodmail · AGPL-3.0 ·{' '}
            <a href={source} target="_blank" rel="noopener noreferrer">{t('Source code')}</a>
          </div>
        </div>
      )}
    </div>
  );
}

/** One compact row: auto / light / dark as icon dots, then the accent color dots. */
export function Appearance({ modes = true }: { modes?: boolean }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  return (
    <div className="swatches-row appearance">
      {modes && THEMES.map((th) => (
        <button
          key={th.id}
          className={`mode-dot ${th.id === theme ? 'on' : ''}`}
          title={t(th.label)}
          aria-label={t(th.label)}
          aria-pressed={th.id === theme}
          onClick={() => {
            setThemeState(th.id);
            setTheme(th.id);
          }}
        >
          <Icon name={th.icon} size={15} />
        </button>
      ))}
      {modes && <span className="dot-sep" />}
      <AccentPicker />
    </div>
  );
}

function AccentPicker() {
  const [accent, set] = useState(loadAccent);
  return (
    <div className="accent-dots" role="radiogroup" aria-label={t('Color')}>
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          role="radio"
          aria-checked={a.id === accent}
          className={`accent-dot ${a.id === accent ? 'on' : ''}`}
          style={{ background: a.light }}
          title={t(a.name)}
          aria-label={t(a.name)}
          onClick={() => {
            set(a.id);
            setAccent(a.id);
          }}
        />
      ))}
    </div>
  );
}
