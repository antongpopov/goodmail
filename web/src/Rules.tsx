import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.ts';
import type { Folder, MailRule, RuleAction, RuleCondition } from './api.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { pathLabel, flatFolders } from './folders.ts';

const FIELDS: { id: RuleCondition['field']; label: () => string }[] = [
  { id: 'from', label: () => t('From') },
  { id: 'to', label: () => t('To') },
  { id: 'cc', label: () => t('Cc') },
  { id: 'recipient', label: () => t('To or Cc') },
  { id: 'subject', label: () => t('Subject') },
  { id: 'list', label: () => t('Mailing list') },
  { id: 'header', label: () => t('Other header…') },
];
const OPS: { id: RuleCondition['op']; label: () => string }[] = [
  { id: 'contains', label: () => t('contains') },
  { id: 'not-contains', label: () => t('does not contain') },
  { id: 'is', label: () => t('is') },
  { id: 'begins', label: () => t('begins with') },
  { id: 'ends', label: () => t('ends with') },
];
const ACTIONS: { id: RuleAction['type']; label: () => string }[] = [
  { id: 'move', label: () => t('Move to folder') },
  { id: 'read', label: () => t('Mark as read') },
  { id: 'flag', label: () => t('Flag it') },
  { id: 'forward', label: () => t('Forward a copy to') },
  { id: 'discard', label: () => t('Delete it') },
  { id: 'stop', label: () => t('Stop applying other rules') },
];

const blank = (): MailRule => ({
  id: Math.random().toString(36).slice(2, 10),
  name: '',
  enabled: true,
  match: 'all',
  conditions: [{ field: 'from', op: 'contains', value: '' }],
  actions: [{ type: 'move', value: '' }],
});

/** Mail rules: "when a message matches …, then …", stored as a Sieve filter on the mail server. */
/** Pre-fills a new rule from a message: who it came from (or went to). */
export interface RuleSeed {
  name: string;
  address: string;
  field: 'from' | 'to';
}

export function RulesDialog({ onClose, flash, seed }: { onClose: () => void; flash: (m: string) => void; seed?: RuleSeed }) {
  const [rules, setRules] = useState<MailRule[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foreign, setForeign] = useState(false);
  const [replace, setReplace] = useState(false);
  const [edit, setEdit] = useState<MailRule | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .rules()
      .then((r) => {
        setRules(r.rules);
        setForeign(r.foreign);
        if (seed) {
          // opened from a message: start a new rule that already matches its sender
          setEdit({ ...blank(), name: seed.name || seed.address, conditions: [{ field: seed.field, op: 'contains', value: seed.address }] });
          setIsNew(true);
        }
      })
      .catch((e) => setError((e as Error).message));
    api.folders('main').then(setFolders).catch(() => {});
  }, []);
  // Escape closes the whole dialog (like ×); a rule with unsaved changes asks first.
  const editBase = useRef<string | null>(null);
  useEffect(() => {
    if (!edit) editBase.current = null;
    else if (editBase.current === null) editBase.current = JSON.stringify(edit);
  }, [edit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (edit && editBase.current !== null && JSON.stringify(edit) !== editBase.current && !confirm(t('Discard your changes to this rule?'))) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, edit]);

  const persist = async (next: MailRule[], okMsg: string) => {
    setBusy(true);
    setError('');
    try {
      await api.saveRules(next, replace);
      setRules(next);
      setForeign(false);
      setReplace(false);
      setEdit(null);
      flash(okMsg);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setForeign(true);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const folderLabel = (path: string) => pathLabel(path, folders);
  const move = (i: number, d: number) => {
    if (!rules) return;
    const next = [...rules];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void persist(next, t('Rules saved'));
  };
  const summary = (r: MailRule) =>
    r.conditions.map((c) => `${FIELDS.find((f) => f.id === c.field)!.label()}${c.field === 'header' ? ` ${c.header}` : ''} ${OPS.find((o) => o.id === c.op)!.label()} “${c.value}”`).join(r.match === 'any' ? ` ${t('or')} ` : ` ${t('and')} `) +
    ' → ' +
    r.actions.map((a) => ACTIONS.find((x) => x.id === a.type)!.label() + (a.type === 'move' ? ` ${folderLabel(a.value || '')}` : a.type === 'forward' ? ` ${a.value}` : '')).join(', ');

  const save = () => {
    if (!edit || !rules) return;
    const r = { ...edit, name: edit.name.trim() || t('Rule {n}', { n: rules.length + 1 }) };
    const next = isNew ? [...rules, r] : rules.map((x) => (x.id === r.id ? r : x));
    void persist(next, t('Rules saved'));
  };
  const setCond = (i: number, p: Partial<RuleCondition>) => setEdit((e) => e && { ...e, conditions: e.conditions.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  const setAct = (i: number, p: Partial<RuleAction>) => setEdit((e) => e && { ...e, actions: e.actions.map((a, k) => (k === i ? { ...a, ...p } : a)) });

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal accounts-dialog rules">
        <div className="dlg-head">
          <h2>{edit ? (isNew ? t('New rule') : t('Edit rule')) : t('Mail rules')}</h2>
          <button className="tb icon" onClick={onClose} title={t('Close')}>
            <Icon name="close" />
          </button>
        </div>

        {!rules ? (
          <p className="muted">{error || t('Loading…')}</p>
        ) : edit ? (
          <form className="rule-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <label className="field">
              <span>{t('Name')}</span>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={t('For example: Newsletters')} maxLength={80} />
            </label>

            <div className="rule-sec">
              <b>{t('When a message arrives and')}</b>{' '}
              <select value={edit.match} onChange={(e) => setEdit({ ...edit, match: e.target.value as 'all' | 'any' })}>
                <option value="all">{t('all of these match')}</option>
                <option value="any">{t('any of these matches')}</option>
              </select>
            </div>
            {edit.conditions.map((c, i) => (
              <div className="rule-row" key={i}>
                <select value={c.field} onChange={(e) => setCond(i, { field: e.target.value as RuleCondition['field'] })}>
                  {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label()}</option>)}
                </select>
                {c.field === 'header' && <input className="short" value={c.header || ''} onChange={(e) => setCond(i, { header: e.target.value })} placeholder="X-Header" />}
                <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as RuleCondition['op'] })}>
                  {OPS.map((o) => <option key={o.id} value={o.id}>{o.label()}</option>)}
                </select>
                <input className="grow" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} required />
                <button type="button" className="tb icon" disabled={edit.conditions.length < 2} title={t('Remove')} onClick={() => setEdit({ ...edit, conditions: edit.conditions.filter((_, k) => k !== i) })}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="link-btn" disabled={edit.conditions.length >= 10} onClick={() => setEdit({ ...edit, conditions: [...edit.conditions, { field: 'subject', op: 'contains', value: '' }] })}>
              + {t('Add condition')}
            </button>

            <div className="rule-sec"><b>{t('Then')}</b></div>
            {edit.actions.map((a, i) => (
              <div className="rule-row" key={i}>
                <select value={a.type} onChange={(e) => setAct(i, { type: e.target.value as RuleAction['type'], value: '' })}>
                  {ACTIONS.map((x) => <option key={x.id} value={x.id}>{x.label()}</option>)}
                </select>
                {a.type === 'move' && (
                  <select className="grow" value={a.value || ''} onChange={(e) => setAct(i, { value: e.target.value })} required>
                    <option value="">{t('Choose a folder…')}</option>
                    {flatFolders(folders).map((f) => <option key={f.path} value={f.path}>{folderLabel(f.path)}</option>)}
                  </select>
                )}
                {a.type === 'forward' && <input className="grow" type="email" value={a.value || ''} onChange={(e) => setAct(i, { value: e.target.value })} placeholder="name@example.com" required />}
                <button type="button" className="tb icon" disabled={edit.actions.length < 2} title={t('Remove')} onClick={() => setEdit({ ...edit, actions: edit.actions.filter((_, k) => k !== i) })}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="link-btn" disabled={edit.actions.length >= 6} onClick={() => setEdit({ ...edit, actions: [...edit.actions, { type: 'read' }] })}>
              + {t('Add action')}
            </button>

            {foreign && (
              <label className="menu-check">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> {t('Replace the existing filter')}
              </label>
            )}
            {error && <div className="error">{error}</div>}
            <div className="ev-actions">
              <span className="grow" />
              <button type="button" className="pill-btn" onClick={() => { setEdit(null); setError(''); }}>{t('Cancel')}</button>
              <button className="primary" disabled={busy}>{t('Save rule')}</button>
            </div>
          </form>
        ) : (
          <>
            <p className="muted small">{t('Rules run on the mail server as messages arrive, from top to bottom — also when you are not signed in.')}</p>
            {foreign && (
              <div className="sec-status">
                <p>{t('This mailbox already has a mail filter that was not made here. Saving rules here will replace it (a copy is kept on the server).')}</p>
                <label className="menu-check">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> {t('Replace the existing filter')}
                </label>
              </div>
            )}
            {rules.length === 0 && <p className="muted">{t('No rules yet.')}</p>}
            {rules.map((r, i) => (
              <div className={`rule-item ${r.enabled ? '' : 'off'}`} key={r.id}>
                <input type="checkbox" checked={r.enabled} disabled={busy || (foreign && !replace)} title={t('On')} onChange={(e) => void persist(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)), t('Rules saved'))} />
                <div className="grow">
                  <b>{r.name}</b>
                  <div className="muted small">{summary(r)}</div>
                </div>
                <button className="tb icon" disabled={busy || i === 0 || (foreign && !replace)} title={t('Move up')} onClick={() => move(i, -1)}>▲</button>
                <button className="tb icon" disabled={busy || i === rules.length - 1 || (foreign && !replace)} title={t('Move down')} onClick={() => move(i, 1)}>▼</button>
                <button className="link-btn" onClick={() => { setEdit(structuredClone(r)); setIsNew(false); setError(''); }}>{t('Edit')}</button>
                <button className="link-btn" disabled={busy || (foreign && !replace)} onClick={() => void persist(rules.filter((x) => x.id !== r.id), t('Rules saved'))}>{t('Remove')}</button>
              </div>
            ))}
            {error && <div className="error">{error}</div>}
            <div className="ev-actions">
              <span className="grow" />
              <button className="primary" disabled={busy || (foreign && !replace)} onClick={() => { setEdit(blank()); setIsNew(true); setError(''); }}>
                <Icon name="plus" size={14} /> {t('New rule')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
