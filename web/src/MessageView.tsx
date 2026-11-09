import { useState } from 'react';
import { api } from './api.ts';
import type { Message } from './api.ts';
import { Avatar } from './Avatar.tsx';
import { Icon } from './icons.tsx';
import { MailBody } from './MailBody.tsx';
import { SmimeBadge } from './Smime.tsx';
import { IconBtn } from './actions.tsx';
import type { Act } from './actions.tsx';
import { displayName, fullTime, humanSize, save, store } from './util.ts';
import { t } from './i18n.ts';

export interface MessageActs {
  reply: Act;
  replyAll: Act;
  forward: Act;
  junk: Act;
  headers: Act;
  rule?: Act;
  // shown on the phone only (the desktop toolbar carries them)
  delete: Act;
  archive: Act;
  move: Act;
  flag: Act;
  unread: Act;
}

/** The opened message: header with actions, sender, banners, attachments and body. */
export function MessageView({ msg, folder, known, acts, onBack, onAddContact, onAddToCalendar }: {
  msg: Message;
  folder: string;
  known: Set<string>;
  acts: MessageActs;
  onBack: () => void;
  onAddContact: (name: string, email: string) => void;
  onAddToCalendar: (url: string) => void;
}) {
  // Remote images: blocked unless the sender is trusted ("always") or the user shows them once for this message.
  const [remoteOk, setRemoteOk] = useState<Record<string, boolean>>(() => store('remoteOk', {}));
  const [showOnce, setShowOnce] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const senderKey = msg.from.address.toLowerCase();
  const remote = showOnce || !!remoteOk[senderKey];

  return (
    <article className="message">
      <div className="msg-head">
        <button className="tb icon back" title={t('Back')} onClick={onBack}>
          <Icon name="chevronRight" />
        </button>
        <h2>{msg.subject || t('(no subject)')}</h2>
        <div className="msg-actions">
          <IconBtn a={acts.reply} />
          <IconBtn a={acts.replyAll} />
          <IconBtn a={acts.forward} />
          <IconBtn a={acts.junk} />
          <IconBtn a={acts.headers} />
          {acts.rule && <IconBtn a={acts.rule} />}
          <span className="phone-only phone-actions">
            <IconBtn a={acts.delete} />
            <IconBtn a={acts.archive} />
            <IconBtn a={acts.move} />
            <IconBtn a={acts.flag} />
            <IconBtn a={acts.unread} />
          </span>
        </div>
      </div>
      <div className="card">
        <div className="sender-row">
          <Avatar addr={msg.from} size={44} />
          <div className="sender-info">
            <div className="from-line">
              <b>{displayName(msg.from)}</b>
              {msg.from.address && !known.has(senderKey) && (
                <button className="add-contact" title={t('Add to contacts')} onClick={() => onAddContact(msg.from.name, msg.from.address)}>
                  <Icon name="plus" size={14} />
                </button>
              )}
              {msg.from.name && <span className="muted"> &lt;{msg.from.address}&gt;</span>}
            </div>
            <div className="to-line">
              <span className="muted">{t('To:')}</span> {msg.to.map(displayName).join('; ') || '—'}
              {msg.cc.length > 0 && (
                <>
                  {'  '}
                  <span className="muted">{t('Cc:')}</span> {msg.cc.map(displayName).join('; ')}
                </>
              )}
            </div>
          </div>
          <div className="date-col">
            <div className="date">{fullTime(msg.date)}</div>
          </div>
        </div>
        {blocked && !remote && (
          <div className="banner">
            <Icon name="image" size={16} /> {t('Some external content was blocked to protect your privacy.')}
            <button className="link-btn" onClick={() => setShowOnce(true)}>{t('Show once')}</button>
            <button
              className="link-btn"
              onClick={() => {
                const r = { ...remoteOk, [senderKey]: true };
                setRemoteOk(r);
                save('remoteOk', r);
              }}
            >
              {t('Always show from {sender}', { sender: msg.from.address })}
            </button>
          </div>
        )}
        {msg.smime && <SmimeBadge info={msg.smime} />}
        {msg.attachments.length > 0 && (
          <div className="attachments">
            {msg.attachments.map((a) => (
              <a key={a.part} className="att" href={api.attachmentUrl(folder, msg.uid, a)} download={a.filename}>
                <Icon name="clip" size={16} />
                <span className="att-name">{a.filename}</span>
                <span className="muted">{humanSize(a.size)}</span>
              </a>
            ))}
            {msg.attachments
              .filter((a) => a.type === 'text/calendar' || /\.ics$/i.test(a.filename))
              .map((a) => (
                <button key={`cal-${a.part}`} className="att ics" onClick={() => onAddToCalendar(api.attachmentUrl(folder, msg.uid, a))}>
                  <Icon name="calendar" size={16} /> {t('Add to calendar')}
                </button>
              ))}
          </div>
        )}
        <MailBody html={msg.html} text={msg.text} remote={remote} onBlocked={setBlocked} />
      </div>
    </article>
  );
}
