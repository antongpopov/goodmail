import type React from 'react';
import { Avatar } from './Avatar.tsx';
import { SpamBar } from './SpamBar.tsx';
import { Icon } from './icons.tsx';
import type { Addr, Summary } from './api.ts';
import { displayName, listTime } from './util.ts';
import { t } from './i18n.ts';

interface Props {
  m: Summary;
  who: Addr; // sender, or first recipient in Sent/Drafts
  isSentFolder: boolean;
  selected: boolean;
  selectedUids: Set<number>; // for drag: dragging a selected row drags the whole selection
  preview: boolean;
  inJunk: boolean;
  compact?: boolean; // Gmail-style single line: sender | subject – preview | time (used for the "below" reading pane)
  onSelect: (m: Summary, e: React.MouseEvent) => void;
  onFlag: (uids: number[], flag: '\\Seen' | '\\Flagged', on: boolean) => void;
  onToggleJunk: (uids: number[]) => void;
  onDelete: (uids: number[]) => void;
}

/** One row of the message list. */
export function MessageItem({ m, who, isSentFolder, selected, selectedUids, preview, inJunk, compact, onSelect, onFlag, onToggleJunk, onDelete }: Props) {
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
    onClick: (e: React.MouseEvent) => onSelect(m, e),
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const uids = selectedUids.has(m.uid) ? [...selectedUids] : [m.uid];
      e.dataTransfer.setData('application/x-goodmail', JSON.stringify(uids));
    },
  };
  const state = `${m.seen ? '' : 'unread'} ${selected ? 'sel' : ''} ${m.flagged ? 'flagged' : ''} ${isSpam ? 'spam' : ''}`;

  if (compact) {
    return (
      <div {...common} className={`item compact ${state}`}>
        <span className="c-sender">{label}</span>
        <span className="c-text">
          <span className="c-subject">{m.subject || t('(no subject)')}</span>
          {m.snippet && <span className="c-snip"> – {m.snippet}</span>}
        </span>
        {isSpam && m.spam && <SpamBar spam={m.spam} compact />}
        {meta}
        {actions}
      </div>
    );
  }

  return (
    <div {...common} className={`item ${state}`}>
      <Avatar addr={who} />
      <div className="item-main">
        <div className="row1">
          <span className="sender">{label}</span>
          {actions}
        </div>
        <div className="row2">
          <span className="subject">{m.subject || t('(no subject)')}</span>
          {meta}
        </div>
        {preview && <div className="row3">{m.snippet || ' '}</div>}
        {isSpam && m.spam && <SpamBar spam={m.spam} />}
      </div>
    </div>
  );
}
