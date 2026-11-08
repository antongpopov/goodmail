import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { MailAccount, Prefs, Template } from './api.ts';
import { Icon } from './icons.tsx';
import { MiniEditor } from './MiniEditor.tsx';
import { t } from './i18n.ts';

/** Signatures (one per account) and templates (canned replies). */
export function SignaturesDialog({ onClose, prefs, setPrefs, accounts, flash, start = 'signature' }: { onClose: () => void; prefs: Prefs; setPrefs: (p: Prefs) => void; accounts: MailAccount[]; flash: (m: string) => void; start?: 'signature' | 'templates' }) {
  const [tab, setTab] = useState<'signature' | 'templates'>(start);
  const [acct, setAcct] = useState('main');
  const [sig, setSig] = useState('');
  const [edit, setEdit] = useState<Template | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isDefault = acct === 'main' && !(acct in prefs.signatures) && !!prefs.defaultSignature;

  useEffect(() => {
    setSig(prefs.signatures[acct] ?? (acct === 'main' ? prefs.defaultSignature : ''));
  }, [acct]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (edit ? setEdit(null) : onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, edit]);

  const run = async (fn: () => Promise<Omit<Prefs, 'defaultSignature'>>, ok: string, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      const p = await fn();
      setPrefs({ ...p, defaultSignature: prefs.defaultSignature });
      flash(ok);
      after?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal accounts-dialog security">
        <div className="dlg-head">
          <h2>{t('Signatures & templates')}</h2>
          <button className="tb icon" onClick={onClose} title={t('Close')}>
            <Icon name="close" />
          </button>
        </div>
        <div className="segment">
          <button className={tab === 'signature' ? 'on' : ''} onClick={() => setTab('signature')}>{t('Signature')}</button>
          <button className={tab === 'templates' ? 'on' : ''} onClick={() => { setTab('templates'); setEdit(null); }}>{t('Templates')}</button>
        </div>

        {tab === 'signature' ? (
          <div className="sig-pane">
            {accounts.length > 1 && (
              <select value={acct} onChange={(e) => setAcct(e.target.value)} className="from-select sig-acct">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name ? `${a.name} <${a.email}>` : a.email}</option>
                ))}
              </select>
            )}
            <p className="muted small">{t('Added to the end of new messages and replies (above the quoted text). You can still edit or delete it in a message.')}</p>
            {isDefault && <p className="muted small">{t('This is the default signature set up by your administrator. Saving your own replaces it.')}</p>}
            <MiniEditor value={sig} onChange={setSig} />
            {error && <div className="error">{error}</div>}
            <div className="ev-actions">
              {acct in prefs.signatures && prefs.signatures[acct] !== '' && (
                <button className="link-btn" disabled={busy} onClick={() => void run(() => api.saveSignature(acct, ''), t('Signature removed'), () => setSig(''))}>{t('No signature')}</button>
              )}
              <span className="grow" />
              <button className="primary" disabled={busy} onClick={() => void run(() => api.saveSignature(acct, sig), t('Signature saved'))}>{t('Save')}</button>
            </div>
          </div>
        ) : edit ? (
          <form className="sig-pane" onSubmit={(e) => { e.preventDefault(); void run(() => api.saveTemplate(edit), t('Template saved'), () => setEdit(null)); }}>
            <label className="field"><span>{t('Name')}</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={t('For example: Opening hours')} maxLength={80} required autoFocus /></label>
            <label className="field"><span>{t('Subject')}</span><input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} placeholder={t('Optional — used when the subject is empty')} maxLength={200} /></label>
            <MiniEditor value={edit.html} onChange={(html) => setEdit({ ...edit, html })} minHeight={160} />
            <p className="muted small">{t('Placeholders: {name} the recipient, {firstname}, {date} today, {me} you.')}</p>
            {error && <div className="error">{error}</div>}
            <div className="ev-actions">
              <span className="grow" />
              <button type="button" className="pill-btn" onClick={() => setEdit(null)}>{t('Cancel')}</button>
              <button className="primary" disabled={busy}>{t('Save')}</button>
            </div>
          </form>
        ) : (
          <div className="sig-pane">
            <p className="muted small">{t('Ready-made text you insert into a message from the composer (the Templates button).')}</p>
            {prefs.templates.length === 0 && <p className="muted">{t('No templates yet.')}</p>}
            {prefs.templates.map((tp) => (
              <div className="rule-item" key={tp.id}>
                <div className="grow"><b>{tp.name}</b>{tp.subject && <div className="muted small">{tp.subject}</div>}</div>
                <button className="link-btn" onClick={() => { setEdit(structuredClone(tp)); setError(''); }}>{t('Edit')}</button>
                <button className="link-btn" disabled={busy} onClick={() => confirm(t('Delete the template "{name}"?', { name: tp.name })) && void run(() => api.deleteTemplate(tp.id), t('Template deleted'))}>{t('Remove')}</button>
              </div>
            ))}
            {error && <div className="error">{error}</div>}
            <div className="ev-actions">
              <span className="grow" />
              <button className="primary" onClick={() => { setEdit({ id: '', name: '', subject: '', html: '' }); setError(''); }}>
                <Icon name="plus" size={14} /> {t('New template')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
