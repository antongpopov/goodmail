import type React from 'react';
import { Avatar } from './Avatar.tsx';
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
  onSelect: (m: Summary, e: React.MouseEvent) => void;
  onFlag: (uids: number[], flag: '\\Seen' | '\\Flagged', on: boolean) => void;
  onToggleJunk: (uids: number[]) => void;
  onDelete: (uids: number[]) => void;
}

/** One row of the message list. */
export function MessageItem({ m, who, isSentFolder, selected, selectedUids, preview, inJunk, onSelect, onFlag, onToggleJunk, onDelete }: Props) {
  return (
    <div
      data-uid={m.uid}
      className={`item ${m.seen ? '' : 'unread'} ${selected ? 'sel' : ''} ${m.flagged ? 'flagged' : ''}`}
      onClick={(e) => onSelect(m, e)}
      draggable
      onDragStart={(e) => {
        const uids = selectedUids.has(m.uid) ? [...selectedUids] : [m.uid];
        e.dataTransfer.setData('application/x-goodmail', JSON.stringify(uids));
      }}
    >
      <Avatar addr={who} />
      <div className="item-main">
        <div className="row1">
          <span className="sender">{isSentFolder ? t('To: {name}', { name: displayName(who) }) : displayName(who)}</span>
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
        </div>
        <div className="row2">
          <span className="subject">{m.subject || t('(no subject)')}</span>
          <span className="meta">
            {m.hasAttachments && <Icon name="clip" size={14} />}
            {m.answered && <Icon name="reply" size={14} />}
            {m.flagged && <span className="flag-mark"><Icon name="flag" size={14} filled /></span>}
            <span className="time">{listTime(m.date)}</span>
          </span>
        </div>
        {preview && <div className="row3">{m.snippet || ' '}</div>}
      </div>
    </div>
  );
}
