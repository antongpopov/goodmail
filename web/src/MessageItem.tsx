import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar.tsx';
import { SpamBar } from './SpamBar.tsx';
import { Icon } from './icons.tsx';
import type { Addr, Summary } from './api.ts';
import { displayName, listTime } from './util.ts';
import { t } from './i18n.ts';
import type { SwipeAction } from './hooks.ts';

interface Props {
  m: Summary;
  who: Addr; // sender, or first recipient in Sent/Drafts
  isSentFolder: boolean;
  selected: boolean;
  selectedUids: Set<number>; // for drag: dragging a selected row drags the whole selection
  preview: boolean;
  inJunk: boolean;
  compact?: boolean; // Gmail-style single line: sender | subject – preview | time (used when the reading pane is below or hidden)
  onSelect: (m: Summary, e: React.MouseEvent) => void;
  onFlag: (uids: number[], flag: '\\Seen' | '\\Flagged', on: boolean) => void;
  onToggleJunk: (uids: number[]) => void;
  onDelete: (uids: number[]) => void;
  onArchive: (uids: number[]) => void;
  /** What a swipe to the left does on a touch screen (a setting). */
  swipe: SwipeAction;
  /** Present when mail rules are available: adds the ⋯ / right-click menu with "Create rule from this message…". */
  onRule?: (m: Summary) => void;
}

/** One row of the message list. */
export function MessageItem({ m, who, isSentFolder, selected, selectedUids, preview, inJunk, compact, onSelect, onFlag, onToggleJunk, onDelete, onArchive, swipe, onRule }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // swipe to the left: the row follows the finger, and past the threshold the action runs
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const touch = useRef<{ x: number; y: number; dir: '' | 'h' | 'v'; w: number } | null>(null);
  const swiped = useRef(0); // time of the last swipe, so the click that may follow it does not open the message
  const swipeOn = swipe !== 'off';
  const swipeHandlers = swipeOn
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          const p = e.touches[0];
          touch.current = e.touches.length === 1 ? { x: p.clientX, y: p.clientY, dir: '', w: e.currentTarget.getBoundingClientRect().width } : null;
        },
        onTouchMove: (e: React.TouchEvent) => {
          const s = touch.current;
          if (!s || leaving) return;
          const p = e.touches[0];
          const [mx, my] = [p.clientX - s.x, p.clientY - s.y];
          if (!s.dir && Math.max(Math.abs(mx), Math.abs(my)) > 8) s.dir = Math.abs(mx) > Math.abs(my) * 1.5 ? 'h' : 'v';
          if (s.dir === 'h') setDx(Math.max(-s.w, Math.min(0, mx)));
        },
        onTouchEnd: () => {
          const s = touch.current;
          touch.current = null;
          if (!s || s.dir !== 'h') return;
          swiped.current = Date.now();
          if (-dx >= Math.min(120, s.w * 0.35)) {
            setLeaving(true);
            setDx(-s.w);
            setTimeout(() => { void (swipe === 'delete' ? onDelete([m.uid]) : onArchive([m.uid])); }, 180);
          } else setDx(0);
        },
        onTouchCancel: () => { touch.current = null; setDx(0); },
      }
    : {};
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);
  const openMenu = (x: number, y: number) => setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 250)), y: Math.min(y, window.innerHeight - 70) });
  // the bar only appears for mail the filter itself treats as spam (score at or above its junk threshold)
  const isSpam = !!m.spam && m.spam.score >= m.spam.threshold;
  const label = isSentFolder ? t('To: {name}', { name: displayName(who) }) : displayName(who);
  const actions = (
    <span className="item-actions">
      <button title={t('Flag')} className={m.flagged ? 'on' : ''} onClick={(e) => { e.stopPropagation(); void onFlag([m.uid], '\\Flagged', !m.flagged); }}>
        <Icon name="flag" size={16} filled={m.flagged} />
      </button>
      <button title={m.seen ? t('Mark unread') : t('Mark read')} onClick={(e) => { e.stopPropagation(); void onFlag([m.uid], '\\Seen', !m.seen); }}>
        <Icon name="unread" size={16} />
      </button>
      <button title={inJunk ? t('Not junk') : t('Mark as junk')} onClick={(e) => { e.stopPropagation(); void onToggleJunk([m.uid]); }}>
        <Icon name={inJunk ? 'inbox' : 'junk'} size={16} />
      </button>
      <button title={t('Delete')} onClick={(e) => { e.stopPropagation(); void onDelete([m.uid]); }}>
        <Icon name="trash" size={16} />
      </button>
    </span>
  );
  const more = onRule && (
    <button
      className="item-more"
      title={t('More')}
      aria-label={t('More')}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        openMenu(r.right - 240, r.bottom + 4);
      }}
    >
      <Icon name="more" size={16} />
    </button>
  );
  const popup =
    menu &&
    onRule &&
    createPortal(
      <div className="menu msg-menu" style={{ position: 'fixed', left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
        <button className="menu-btn" onClick={() => { setMenu(null); onRule(m); }}>
          <Icon name="folder" size={16} /> {t('Create rule from this message…')}
        </button>
      </div>,
      document.body,
    );
  const meta = (
    <span className="meta">
      {m.hasAttachments && <Icon name="clip" size={14} />}
      {m.answered && <Icon name="reply" size={14} />}
      {m.flagged && <span className="flag-mark"><Icon name="flag" size={14} filled /></span>}
      <span className="time">{listTime(m.date)}</span>
    </span>
  );
  const common = {
    'data-uid': m.uid,
    onClick: (e: React.MouseEvent) => { if (Date.now() - swiped.current > 400) onSelect(m, e); },
    onContextMenu: (e: React.MouseEvent) => {
      if (!onRule) return;
      e.preventDefault();
      openMenu(e.clientX, e.clientY);
    },
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const uids = selectedUids.has(m.uid) ? [...selectedUids] : [m.uid];
      e.dataTransfer.setData('application/x-goodmail', JSON.stringify(uids));
    },
  };
  const moving = swipeOn && dx !== 0;
  const style = swipeOn ? { transform: dx ? `translateX(${dx}px)` : undefined, transition: touch.current?.dir === 'h' ? 'none' : 'transform .18s ease-out' } : undefined;
  const wrap = (row: React.ReactElement) =>
    swipeOn ? (
      <div className="swipe-wrap">
        <div className={`swipe-bg ${swipe}`} style={{ visibility: moving ? 'visible' : 'hidden' }} aria-hidden="true">
          <Icon name={swipe === 'delete' ? 'trash' : 'archive'} size={20} /> {swipe === 'delete' ? t('Delete') : t('Archive')}
        </div>
        {row}
      </div>
    ) : (
      row
    );
  const state = `${moving ? 'swiping' : ''} ${m.seen ? '' : 'unread'} ${selected ? 'sel' : ''} ${m.flagged ? 'flagged' : ''} ${isSpam ? 'spam' : ''}`;

  if (compact) {
    return wrap(
      <div {...common} {...swipeHandlers} style={style} className={`item compact ${state}`}>
        <span className="c-sender">{label}</span>
        <span className="c-text">
          <span className="c-subject">{m.subject || t('(no subject)')}</span>
          {m.snippet && <span className="c-snip"> – {m.snippet}</span>}
        </span>
        {isSpam && m.spam && <SpamBar spam={m.spam} compact />}
        {meta}
        {actions}
        {more}
        {popup}
      </div>,
    );
  }

  return wrap(
    <div {...common} {...swipeHandlers} style={style} className={`item ${state}`}>
      <Avatar addr={who} />
      <div className="item-main">
        <div className="row1">
          <span className="sender">{label}</span>
          {actions}
          {more}
        </div>
        <div className="row2">
          <span className="subject">{m.subject || t('(no subject)')}</span>
          {meta}
        </div>
        {preview && <div className="row3">{m.snippet || ' '}</div>}
        {isSpam && m.spam && <SpamBar spam={m.spam} />}
      </div>
      {popup}
    </div>,
  );
}
