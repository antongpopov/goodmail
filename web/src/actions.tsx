import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

/** One mail action (delete, move, flag…). Defined once in App and rendered by the desktop toolbar, the message header and the phone toolbar. */
export interface Act {
  icon: string;
  label: string;
  /** Tooltip; defaults to the label. */
  title?: string;
  run: () => void;
  disabled?: boolean;
  filled?: boolean;
}

/** Icon + label, as on the desktop toolbar. */
export function TextBtn({ a }: { a: Act }) {
  return (
    <button className="tb" disabled={a.disabled} onClick={a.run} title={a.title || a.label}>
      <Icon name={a.icon} filled={a.filled} /> <span className="lbl">{a.label}</span>
    </button>
  );
}

/** Icon only, as in the message header. */
export function IconBtn({ a }: { a: Act }) {
  return (
    <button className="tb icon" disabled={a.disabled} onClick={a.run} title={a.title || a.label}>
      <Icon name={a.icon} filled={a.filled} />
    </button>
  );
}

/** What the pills and the "more" menu need from the open message (see App.messageActs). */
export interface PillActs {
  reply: Act; replyAll: Act; forward: Act; archive: Act; delete: Act; junk: Act; move: Act; flag: Act; headers: Act; rule?: Act; unread: Act;
}

/** A greyed-out action, for the pills while no message is open. */
export const idleAct = (icon: string, label: string): Act => ({ icon, label, run: () => {}, disabled: true });

/** The message actions in three rounded groups (answer · file away · other), as in Apple Mail. */
export function ActionPills({ acts: p }: { acts: PillActs }) {
  return (
    <div className="top-acts desk-only">
      <span className="act-group"><IconBtn a={p.reply} /><IconBtn a={p.replyAll} /><IconBtn a={p.forward} /></span>
      <span className="act-group"><IconBtn a={p.archive} /><IconBtn a={p.delete} /><IconBtn a={p.junk} /></span>
      <span className="act-group"><IconBtn a={p.move} /><IconBtn a={p.flag} /><IconBtn a={p.headers} />{p.rule && <IconBtn a={p.rule} />}</span>
    </div>
  );
}

/** Phone: everything that does not fit next to reply / reply all / forward. */
export function MoreMenu({ acts }: { acts: Act[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="tb icon" title={t('More')} aria-label={t('More')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu menu-right more-menu" role="menu">
          {acts.map((a) => (
            <button key={a.label} role="menuitem" disabled={a.disabled} onClick={() => { setOpen(false); a.run(); }}>
              <Icon name={a.icon} filled={a.filled} size={18} /> <span className="grow">{a.title || a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
