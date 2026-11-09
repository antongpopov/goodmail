import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import type { AdminAlias, AdminDomain, AdminMailbox, AdminMe } from './api.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

/** A readable random password (no look-alike characters). */
function generate(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Mailbox and alias administration for the domains this person administers (decided by the mail server, not here). */
export function AdminDialog({ me, self, onClose, flash }: { me: AdminMe; self: string; onClose: () => void; flash: (m: string) => void }) {
  const [domain, setDomain] = useState(me.domains[0] || '');
  const [data, setData] = useState<AdminDomain | null>(null);
  const [tab, setTab] = useState<'mailboxes' | 'aliases'>('mailboxes');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [box, setBox] = useState({ local: '', name: '', password: '' });
  const [editBox, setEditBox] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', password: '' });
  const [aliasForm, setAliasForm] = useState<{ original: string | null; local: string; goto: string } | null>(null);
  const [shownPw, setShownPw] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.adminDomain(domain));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [domain]);
  useEffect(() => {
    setData(null);
    setAdding(false);
    setEditBox(null);
    setAliasForm(null);
    setShownPw('');
    if (domain) void load();
  }, [domain, load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      flash(ok);
      after?.();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createBox = () => {
    const address = `${box.local.trim().toLowerCase()}@${domain}`;
    void run(() => api.adminCreateMailbox({ address, name: box.name, password: box.password }), t('Created {email}', { email: address }), () => {
      setShownPw(box.password);
      setAdding(false);
      setBox({ local: '', name: '', password: '' });
    });
  };
  const saveBox = (m: AdminMailbox) => {
    const body: { address: string; name?: string; password?: string } = { address: m.address };
    if (edit.name !== m.name) body.name = edit.name;
    if (edit.password) body.password = edit.password;
    if (!('name' in body) && !body.password) return setEditBox(null);
    void run(() => api.adminUpdateMailbox(body), t('Saved'), () => {
      if (edit.password) setShownPw(edit.password);
      setEditBox(null);
    });
  };
  const toggleBox = (m: AdminMailbox) => void run(() => api.adminUpdateMailbox({ address: m.address, active: !m.active }), m.active ? t('Disabled {email}', { email: m.address }) : t('Enabled {email}', { email: m.address }));
  const deleteBox = (m: AdminMailbox) => {
    if (!confirm(t('Delete the mailbox {email}?', { email: m.address }) + '\n\n' + t('Its mail will no longer be reachable. This cannot be undone from here.'))) return;
    void run(() => api.adminDeleteMailbox(m.address), t('Deleted {email}', { email: m.address }));
  };
  const saveAlias = () => {
    if (!aliasForm) return;
    const address = `${aliasForm.local.trim().toLowerCase()}@${domain}`;
    void run(() => api.adminSaveAlias({ address, goto: aliasForm.goto.split(/[,\s;]+/).filter(Boolean) }), t('Saved'), () => setAliasForm(null));
  };
  const deleteAlias = (a: AdminAlias) => {
    if (!confirm(t('Delete the alias {email}?', { email: a.address }))) return;
    void run(() => api.adminDeleteAlias(a.address), t('Deleted {email}', { email: a.address }));
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(t('Copied'));
    } catch {
      flash(t('Copy failed'));
    }
  };

  const limitNote = (n: number, used: number) => (n > 0 ? ` · ${used}/${n}` : '');

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal accounts-dialog admin-dialog">
        <div className="dlg-head">
          <h2>{t('Administration')}</h2>
          <button className="tb icon" onClick={onClose} title={t('Close')}>
            <Icon name="close" />
          </button>
        </div>
        {me.domains.length > 1 && (
          <select value={domain} onChange={(e) => setDomain(e.target.value)} className="from-select sig-acct">
            {me.domains.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        <div className="segment">
          <button className={tab === 'mailboxes' ? 'on' : ''} onClick={() => setTab('mailboxes')}>{t('Mailboxes')}{data ? ` (${data.mailboxes.length})` : ''}</button>
          <button className={tab === 'aliases' ? 'on' : ''} onClick={() => setTab('aliases')}>{t('Aliases')}{data ? ` (${data.aliases.length})` : ''}</button>
        </div>
        {error && <p className="error">{error}</p>}
        {shownPw && (
          <div className="banner">
            {t('Password to give to the user (shown once):')} <code>{shownPw}</code>
            <button className="link-btn" onClick={() => void copy(shownPw)}>{t('Copy')}</button>
            <button className="link-btn" onClick={() => setShownPw('')}>{t('Hide')}</button>
          </div>
        )}
        {!data && !error && <span className="spinner" />}

        {data && tab === 'mailboxes' && (
          <div className="admin-pane">
            {data.mailboxes.map((m) => (
              <div key={m.address} className={`admin-item ${m.active ? '' : 'off'}`}>
                <div className="admin-line">
                  <div className="admin-main">
                    <b>{m.name || m.address.split('@')[0]}</b>
                    <span className="muted"> {m.address}</span>
                    {!m.active && <span className="tag"> {t('disabled')}</span>}
                    {m.forwards.length > 0 && <div className="muted small">{t('Also forwards to')}: {m.forwards.join(', ')}</div>}
                  </div>
                  <button className="pill-btn" onClick={() => { setEditBox(editBox === m.address ? null : m.address); setEdit({ name: m.name, password: '' }); }}>{t('Edit')}</button>
                  <button className="pill-btn" disabled={busy || m.address === self} onClick={() => toggleBox(m)}>{m.active ? t('Disable') : t('Enable')}</button>
                  <button className="pill-btn danger" disabled={busy || m.address === self} onClick={() => deleteBox(m)}>{t('Delete')}</button>
                </div>
                {editBox === m.address && (
                  <div className="pw-form admin-form">
                    <label>{t('Name')}<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} /></label>
                    <label>
                      {t('New password')}
                      <span className="rule-row">
                        <input className="grow" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder={t('leave empty to keep')} autoComplete="off" />
                        <button className="pill-btn" onClick={() => setEdit({ ...edit, password: generate() })}>{t('Generate')}</button>
                      </span>
                    </label>
                    <div className="rule-row">
                      <button className="primary" disabled={busy} onClick={() => saveBox(m)}>{t('Save')}</button>
                      <button className="link-btn" onClick={() => setEditBox(null)}>{t('Cancel')}</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {adding ? (
              <div className="pw-form admin-form">
                <label>
                  {t('Address')}
                  <span className="rule-row">
                    <input className="grow" value={box.local} onChange={(e) => setBox({ ...box, local: e.target.value })} placeholder="name" autoCapitalize="none" autoCorrect="off" />
                    <span className="muted">@{domain}</span>
                  </span>
                </label>
                <label>{t('Name')}<input value={box.name} onChange={(e) => setBox({ ...box, name: e.target.value })} maxLength={80} /></label>
                <label>
                  {t('Password')}
                  <span className="rule-row">
                    <input className="grow" value={box.password} onChange={(e) => setBox({ ...box, password: e.target.value })} autoComplete="off" />
                    <button className="pill-btn" onClick={() => setBox({ ...box, password: generate() })}>{t('Generate')}</button>
                  </span>
                </label>
                <div className="rule-row">
                  <button className="primary" disabled={busy || !box.local.trim() || box.password.length < 10} onClick={createBox}>{t('Create mailbox')}</button>
                  <button className="link-btn" onClick={() => setAdding(false)}>{t('Cancel')}</button>
                </div>
              </div>
            ) : (
              <button className="primary admin-add" onClick={() => { setAdding(true); setBox({ local: '', name: '', password: generate() }); }}>
                <Icon name="plus" size={14} /> {t('New mailbox')}{limitNote(data.limits.mailboxes, data.mailboxes.length)}
              </button>
            )}
          </div>
        )}

        {data && tab === 'aliases' && (
          <div className="admin-pane">
            {data.aliases.length === 0 && <p className="muted">{t('No aliases yet.')}</p>}
            {data.aliases.map((a) => (
              <div key={a.address} className="admin-item">
                <div className="admin-line">
                  <div className="admin-main">
                    <b>{a.address.startsWith('@') ? t('Everything else ({address})', { address: a.address }) : a.address}</b>
                    <div className="muted small">→ {a.goto.join(', ')}</div>
                  </div>
                  <button className="pill-btn" onClick={() => setAliasForm({ original: a.address, local: a.address.split('@')[0], goto: a.goto.join('\n') })}>{t('Edit')}</button>
                  <button className="pill-btn danger" disabled={busy} onClick={() => deleteAlias(a)}>{t('Delete')}</button>
                </div>
              </div>
            ))}
            {aliasForm ? (
              <div className="pw-form admin-form">
                <label>
                  {t('Address')}
                  <span className="rule-row">
                    <input className="grow" value={aliasForm.local} onChange={(e) => setAliasForm({ ...aliasForm, local: e.target.value })} placeholder={t('empty = everything else')} disabled={aliasForm.original !== null} autoCapitalize="none" autoCorrect="off" />
                    <span className="muted">@{domain}</span>
                  </span>
                </label>
                <label>
                  {t('Deliver to (one address per line)')}
                  <textarea rows={3} value={aliasForm.goto} onChange={(e) => setAliasForm({ ...aliasForm, goto: e.target.value })} />
                </label>
                <div className="rule-row">
                  <button className="primary" disabled={busy || !aliasForm.goto.trim()} onClick={saveAlias}>{t('Save')}</button>
                  <button className="link-btn" onClick={() => setAliasForm(null)}>{t('Cancel')}</button>
                </div>
              </div>
            ) : (
              <button className="primary admin-add" onClick={() => setAliasForm({ original: null, local: '', goto: '' })}>
                <Icon name="plus" size={14} /> {t('New alias')}{limitNote(data.limits.aliases, data.aliases.length)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
