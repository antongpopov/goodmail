import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import type { SmimeStatus, SmimeInfo, SmimeSignature } from './api.ts';
import { Icon } from './icons.tsx';
import { t, L } from './i18n.ts';
import { store, save } from './util.ts';

const day = (iso: string) => new Date(iso).toLocaleDateString(L(), { year: 'numeric', month: 'short', day: 'numeric' });
const b64 = (buf: ArrayBuffer) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
};

/** Defaults for the Sign / Encrypt buttons in the composer. */
export const smimePrefs = {
  sign: () => store('smimeSign', false) as boolean,
  encrypt: () => store('smimeEncrypt', false) as boolean,
  set: (k: 'smimeSign' | 'smimeEncrypt', v: boolean) => save(k, v),
};

/** Secure mail: your certificate, the CA certificate, correspondents' certificates. */
export function SmimeDialog({ onClose, flash }: { onClose: () => void; flash: (m: string) => void }) {
  const [st, setSt] = useState<SmimeStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pw, setPw] = useState('');
  const [filePw, setFilePw] = useState('');
  const [signDef, setSignDef] = useState(smimePrefs.sign());
  const [encDef, setEncDef] = useState(smimePrefs.encrypt());
  const p12 = useRef<HTMLInputElement>(null);
  const cer = useRef<HTMLInputElement>(null);
  const [importPw, setImportPw] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);

  const reload = () => api.smime().then(setSt).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (ok) flash(ok);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await api.smimeExport(pw, filePw);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mail-certificate.p12';
      a.click();
      URL.revokeObjectURL(a.href);
      setExporting(false);
      setPw('');
      setFilePw('');
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
          <h2>{t('Secure mail (S/MIME)')}</h2>
          <button className="tb icon" onClick={onClose} title={t('Close')}>
            <Icon name="close" />
          </button>
        </div>
        {!st ? (
          <p className="muted">{error || t('Loading…')}</p>
        ) : !st.available ? (
          <p className="error">{t('S/MIME needs the openssl command on the server.')}</p>
        ) : (
          <>
            <p className="muted small">{t('Sign your mail so people can see it really is from you, and encrypt it so only the recipient can read it. Works with Apple Mail, Outlook and Thunderbird.')}</p>

            <section className="sec-item">
              <div className="sec-head">
                <Icon name="shield" />
                <div className="grow">
                  <b>{t('Your certificate')}</b>
                  {st.cert ? (
                    <div className="muted small">
                      {st.cert.emails.join(', ')} · {t('valid until {date}', { date: day(st.cert.notAfter) })}
                      {st.cert.expired ? ` · ${t('expired')}` : ''}
                      <br />
                      {t('issued by {name}', { name: st.cert.issuer })}
                    </div>
                  ) : (
                    <div className="muted small">{t('You have no certificate yet.')}</div>
                  )}
                </div>
                {!st.cert && st.canIssue && (
                  <button className="pill-btn" disabled={busy} onClick={() => void run(() => api.smimeEnable(), t('Certificate created'))}>
                    {t('Create certificate')}
                  </button>
                )}
              </div>
              {!st.cert && (
                <div className="sec-pad">
                  <div className="muted small">{t('Or use a certificate you already have (a .p12 / .pfx file):')}</div>
                  <div className="unlock-row">
                    <input ref={p12} type="file" accept=".p12,.pfx" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                    <input type="password" placeholder={t('File password')} value={importPw} onChange={(e) => setImportPw(e.target.value)} />
                    <button
                      className="pill-btn"
                      disabled={busy || !importFile}
                      onClick={() => void run(async () => api.smimeImport(b64(await importFile!.arrayBuffer()), importPw), t('Certificate imported'))}
                    >
                      {t('Import')}
                    </button>
                  </div>
                </div>
              )}
              {st.cert && (
                <div className="sec-sub">
                  <span className="grow muted small">{t('Install it in your mail apps to sign and read encrypted mail there too.')}</span>
                  {!exporting && <button className="link-btn" onClick={() => setExporting(true)}>{t('Download .p12')}</button>}
                  <button
                    className="link-btn"
                    onClick={() => {
                      const p = prompt(t('Remove your certificate? Encrypted mail you received can no longer be read here. Enter your mail password to confirm.'));
                      if (p) void run(() => api.smimeRemove(p), t('Certificate removed'));
                    }}
                  >
                    {t('Remove')}
                  </button>
                </div>
              )}
              {exporting && (
                <form className="sec-pad pw-form" onSubmit={(e) => { e.preventDefault(); void download(); }}>
                  <input type="password" autoComplete="current-password" placeholder={t('Your mail password')} value={pw} onChange={(e) => setPw(e.target.value)} required />
                  <input type="password" autoComplete="new-password" placeholder={t('Choose a password for the file (6+ characters)')} value={filePw} onChange={(e) => setFilePw(e.target.value)} minLength={6} required />
                  <div className="ev-actions">
                    <span className="grow" />
                    <button type="button" className="pill-btn" onClick={() => setExporting(false)}>{t('Cancel')}</button>
                    <button className="primary" disabled={busy}>{t('Download')}</button>
                  </div>
                </form>
              )}
            </section>

            {st.cert && (
              <section className="sec-item">
                <label className="menu-check sec-sub">
                  <input type="checkbox" checked={signDef} onChange={(e) => { setSignDef(e.target.checked); smimePrefs.set('smimeSign', e.target.checked); }} />
                  <span>{t('Sign new messages by default')}</span>
                </label>
                <label className="menu-check sec-sub">
                  <input type="checkbox" checked={encDef} onChange={(e) => { setEncDef(e.target.checked); smimePrefs.set('smimeEncrypt', e.target.checked); }} />
                  <span>{t('Encrypt new messages by default when everyone has a certificate')}</span>
                </label>
              </section>
            )}

            {st.ca && (
              <section className="sec-item">
                <div className="sec-head">
                  <Icon name="lock" />
                  <div className="grow">
                    <b>{t('Certificate authority')}</b>
                    <div className="muted small">
                      {st.ca.name} · {t('valid until {date}', { date: day(st.ca.notAfter) })}
                      <br />
                      {t('Certificates made here are trusted by this webmail. To have other people and apps trust them, they install this certificate:')}
                    </div>
                  </div>
                  <a className="pill-btn" href="/api/smime/ca.crt" download>{t('Download')}</a>
                </div>
              </section>
            )}

            <section className="sec-item">
              <div className="sec-head">
                <Icon name="people" />
                <div className="grow">
                  <b>{t('People you can encrypt to')}</b>
                  <div className="muted small">{t('Collected from signed mail you receive, or add a certificate file. Colleagues on this server are found automatically.')}</div>
                </div>
                <button className="pill-btn" disabled={busy} onClick={() => cer.current?.click()}>{t('Add certificate')}</button>
                <input
                  ref={cer}
                  type="file"
                  accept=".pem,.crt,.cer"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) await run(async () => api.smimeAddCert(b64(await f.arrayBuffer())), t('Certificate added'));
                  }}
                />
              </div>
              {(st.contacts || []).map((c) => (
                <div key={c.email} className="sec-sub">
                  <span className="grow">
                    {c.email} <span className="muted small">· {c.issuer} · {t('valid until {date}', { date: day(c.notAfter) })}</span>
                  </span>
                  <button className="link-btn" onClick={() => void run(() => api.smimeForgetCert(c.email))}>{t('Remove')}</button>
                </div>
              ))}
            </section>
            {error && <div className="error">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

const SIG_TEXT: Record<SmimeSignature['status'], () => string> = {
  ok: () => t('Signed and verified'),
  untrusted: () => t('Signed, but the certificate is not trusted'),
  expired: () => t('Signed, but the certificate has expired'),
  mismatch: () => t('Signed by a different address than the sender'),
  invalid: () => t('The signature is not valid — the message may have been changed'),
};

/** The line above a message that was signed and/or encrypted. */
export function SmimeBadge({ info }: { info: SmimeInfo }) {
  const sig = info.signed;
  const good = sig?.status === 'ok';
  return (
    <div className="smime-badges">
      {info.encrypted && (
        <div className={`smime-badge ${info.readable ? 'good' : 'bad'}`}>
          <Icon name="lock" size={15} />{' '}
          {info.readable
            ? t('Encrypted — only you could read this')
            : info.reason === 'no-certificate'
              ? t('Encrypted. Create an S/MIME certificate (⚙ → Secure mail) to read it.')
              : t('Encrypted for a different certificate than yours, so it cannot be read here.')}
        </div>
      )}
      {sig && (
        <div className={`smime-badge ${good ? 'good' : sig.status === 'invalid' || sig.status === 'mismatch' ? 'bad' : 'warn'}`} title={sig.signer ? `${sig.signer.name} · ${sig.signer.issuer}` : ''}>
          <Icon name="shield" size={15} /> {SIG_TEXT[sig.status]()}
          {sig.signer && <span className="muted small"> · {sig.signer.name || sig.signer.emails[0]}</span>}
        </div>
      )}
    </div>
  );
}
