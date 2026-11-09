import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { LangPicker } from './LangPicker.tsx';
import { loadTheme, setTheme, ACCENTS, loadAccent, setAccent } from './theme.ts';
import type { Theme } from './theme.ts';
import { t, clockPref, setClock, dateFmtPref, setDateFmt } from './i18n.ts';
import type { Clock, DateFmt } from './i18n.ts';

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

export function ViewMenu({ pane, onPane, preview, onPreview, onAccounts, onSecurity, onRules, onSmime, onSignatures, source }: { pane: PaneMode; onPane: (p: PaneMode) => void; preview: boolean; onPreview: (v: boolean) => void; onAccounts: () => void; onSecurity: () => void; onRules?: () => void; onSmime?: () => void; onSignatures?: () => void; source: string }) {
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
          <div className="menu-label">{t('Theme')}</div>
          <Appearance />
          <div className="menu-label">{t('Date format')}</div>
          <div className="segment">
            {([['auto', t('Automatic')], ['dmy', 'DD/MM/YYYY'], ['mdy', 'MM/DD/YYYY'], ['ymd', 'YYYY-MM-DD']] as [DateFmt, string][]).map(([id, label]) => (
              <button key={id} className={id === dateFmtPref() ? 'on' : ''} onClick={() => id !== dateFmtPref() && setDateFmt(id)} style={{ fontSize: 12 }}>
                {label}
              </button>
            ))}
          </div>
          <div className="menu-label">{t('Time format')}</div>
          <div className="segment">
            {([['auto', t('Automatic')], ['12', t('12-hour')], ['24', t('24-hour')]] as [Clock, string][]).map(([id, label]) => (
              <button key={id} className={id === clockPref() ? 'on' : ''} onClick={() => id !== clockPref() && setClock(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="menu-label">{t('Reading pane')}</div>
          <div className="segment">
            {PANES.map((p) => (
              <button key={p.id} className={p.id === pane ? 'on' : ''} onClick={() => onPane(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="menu-label">{t('Message list')}</div>
          <label className="menu-check">
            <input type="checkbox" checked={preview} onChange={(e) => onPreview(e.target.checked)} /> {t('Show preview text')}
          </label>
          <div className="menu-label">{t('Language')}</div>
          <LangPicker className="wide" />
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
export function Appearance() {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  return (
    <div className="swatches-row appearance">
      {THEMES.map((th) => (
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
      <span className="dot-sep" />
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
