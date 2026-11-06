import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import type { Me, Message, MailAccount } from './api.ts';
import { Icon } from './icons.tsx';
import { escapeHtml, fullAddr, fullTime, humanSize, parseRecipients, textToHtml } from './util.ts';
import DOMPurify from 'dompurify';
import { t } from './i18n.ts';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';
export interface ComposeInit { mode: ComposeMode; source?: Message; to?: string }

interface Att { filename: string; type: string; size: number; content: string }

function prefix(subject: string, p: 'Re' | 'Fw') {
  const re = p === 'Re' ? /^(re|aw|sv|antw)\s*:/i : /^(fw|fwd|wg)\s*:/i;
  return re.test(subject.trim()) ? subject : `${p}: ${subject}`;
}

function initial(me: Me, init: ComposeInit) {
  const s = init.source;
  if (!s) return { to: init.to || '', cc: '', subject: '', quote: '' };
  const mine = (a: { address: string }) => a.address.toLowerCase() === me.email.toLowerCase();
  const replyTarget = s.replyTo.length ? s.replyTo : [s.from];
  const header = `<div style="border-top:1px solid #e1e1e1;padding-top:8px;margin-top:16px;font-size:13px">
<b>From:</b> ${escapeHtml(fullAddr(s.from))}<br><b>Sent:</b> ${escapeHtml(fullTime(s.date))}<br>
<b>To:</b> ${escapeHtml(s.to.map(fullAddr).join('; '))}<br>${s.cc.length ? `<b>Cc:</b> ${escapeHtml(s.cc.map(fullAddr).join('; '))}<br>` : ''}
<b>Subject:</b> ${escapeHtml(s.subject)}</div><br>`;
  const body = s.html ? DOMPurify.sanitize(s.html, { FORBID_TAGS: ['style'] }) : textToHtml(s.text);
  const quote = `${header}<blockquote style="margin:0;padding:0;border:0">${body}</blockquote>`;
  if (init.mode === 'forward') return { to: '', cc: '', subject: prefix(s.subject, 'Fw'), quote };
  const to = replyTarget.map(fullAddr).join(', ');
  const cc =
    init.mode === 'replyAll'
      ? [...s.to, ...s.cc].filter((a) => !mine(a) && !replyTarget.some((r) => r.address === a.address)).map(fullAddr).join(', ')
      : '';
  return { to, cc, subject: prefix(s.subject, 'Re'), quote };
}

export function Compose({ me, init, contacts, onClose, onSent, accounts, defaultFrom }: { me: Me; init: ComposeInit; contacts: string[]; onClose: () => void; onSent: () => void; accounts: MailAccount[]; defaultFrom: string }) {
  const [from, setFrom] = useState(() => (accounts.some((a) => a.id === defaultFrom) ? defaultFrom : 'main'));
  const start = useRef(initial(me, init)).current;
  const [to, setTo] = useState(start.to);
  const [cc, setCc] = useState(start.cc);
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(!!start.cc);
  const [subject, setSubject] = useState(start.subject);
  const [atts, setAtts] = useState<Att[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editor = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editor.current) {
      editor.current.innerHTML = `<div><br></div><div><br></div>${start.quote}`;
      if (init.mode === 'new' && !start.to) document.getElementById('gm-to')?.focus();
      else {
        editor.current.focus();
        const r = document.createRange();
        r.setStart(editor.current, 0);
        r.collapse(true);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(r);
      }
    }
  }, [start, init.mode]);

  const cmd = (c: string, v?: string) => {
    document.execCommand(c, false, v);
    editor.current?.focus();
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const read = (f: File) =>
      new Promise<Att>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res({ filename: f.name, type: f.type, size: f.size, content: String(r.result).split(',')[1] || '' });
        r.onerror = rej;
        r.readAsDataURL(f);
      });
    const next = await Promise.all([...files].map(read));
    setAtts((a) => [...a, ...next]);
  };

  const send = async () => {
    if (!parseRecipients(to + ',' + cc + ',' + bcc)) return setError(t('Add at least one recipient.'));
    setBusy(true);
    setError('');
    const html = editor.current?.innerHTML || '';
    const s = init.source;
    try {
      await api.send({
        account: from,
        to: parseRecipients(to),
        cc: parseRecipients(cc),
        bcc: parseRecipients(bcc),
        subject,
        html: `<div style="font-family:Aptos,Calibri,Helvetica,Arial,sans-serif;font-size:14px">${html}</div>`,
        text: editor.current?.innerText || '',
        inReplyTo: s && init.mode !== 'forward' ? s.messageId : undefined,
        references: s && init.mode !== 'forward' ? [...s.references, s.messageId].filter(Boolean) : undefined,
        replyTo: s && init.mode !== 'forward' ? { folder: s.folder, uid: s.uid, account: s.account } : undefined,
        attachments: atts.map(({ filename, type, content }) => ({ filename, type, content })),
      });
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className="compose"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          void send();
        }
        if (e.key === 'Escape' && !busy) onClose();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="compose-bar">
        <button className="primary send" onClick={send} disabled={busy} title={t('Send (⌘/Ctrl+Enter)')}>
          <Icon name="send" /> {busy ? t('Sending…') : t('Send')}
        </button>
        <button className="tb" onClick={() => fileInput.current?.click()} title={t('Attach file')}>
          <Icon name="clip" /> {t('Attach')}
        </button>
        <span className="sep" />
        <button className="tb icon" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')} title={t('Bold')}>
          <Icon name="bold" />
        </button>
        <button className="tb icon" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')} title={t('Italic')}>
          <Icon name="italic" />
        </button>
        <button className="tb icon" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('underline')} title={t('Underline')}>
          <Icon name="underline" />
        </button>
        <button className="tb icon" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertUnorderedList')} title={t('Bullets')}>
          <Icon name="list" />
        </button>
        <button
          className="tb icon"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = prompt(t('Link address'));
            if (url && /^(https?:|mailto:)/i.test(url)) cmd('createLink', url);
          }}
          title={t('Insert link')}
        >
          <Icon name="link" />
        </button>
        <span className="grow" />
        <button className="tb icon" onClick={onClose} title={t('Discard (Esc)')}>
          <Icon name="trash" />
        </button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
      </div>
      <datalist id="gm-contacts">
        {contacts.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="compose-fields">
        {accounts.length > 1 && (
          <div className="field">
            <span className="field-label">{t('From')}</span>
            <select className="from-select" value={from} onChange={(e) => setFrom(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ? `${a.name} <${a.email}>` : a.email}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <span className="field-label">{t('To')}</span>
          <input id="gm-to" list="gm-contacts" value={to} onChange={(e) => setTo(e.target.value)} />
          {!showCc && (
            <button className="link-btn" onClick={() => setShowCc(true)}>
              {t('Cc & Bcc')}
            </button>
          )}
        </div>
        {showCc && (
          <>
            <div className="field">
              <span className="field-label">{t('Cc')}</span>
              <input list="gm-contacts" value={cc} onChange={(e) => setCc(e.target.value)} />
            </div>
            <div className="field">
              <span className="field-label">{t('Bcc')}</span>
              <input list="gm-contacts" value={bcc} onChange={(e) => setBcc(e.target.value)} />
            </div>
          </>
        )}
        <div className="field">
          <input className="subject-input" placeholder={t('Add a subject')} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      </div>
      {atts.length > 0 && (
        <div className="attachments">
          {atts.map((a, i) => (
            <span key={i} className="att">
              <Icon name="clip" size={16} /> {a.filename} <span className="muted">{humanSize(a.size)}</span>
              <button className="x" onClick={() => setAtts((l) => l.filter((_, j) => j !== i))} title={t('Remove')}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div ref={editor} className="editor" contentEditable suppressContentEditableWarning spellCheck />
    </div>
  );
}
