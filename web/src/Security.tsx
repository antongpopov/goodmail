import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from './api.ts';
import type { MfaStatus, Features } from './api.ts';
import { Icon } from './icons.tsx';
import { t, L } from './i18n.ts';

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  return t('Passkey on {device}', { device: os });
}

/** Sign-in security: authenticator app, passkeys, backup email, recovery codes. */
export function SecurityDialog({ onClose, flash, features }: { onClose: () => void; flash: (m: string) => void; features?: Features | null }) {
  const [st, setSt] = useState<MfaStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  // authenticator setup
  const [totp, setTotp] = useState<{ secret: string; qr: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  // backup email setup
  const [addr, setAddr] = useState('');
  const [addrSent, setAddrSent] = useState(false);
  const [addrCode, setAddrCode] = useState('');
  // password-reset address
  const [rAddr, setRAddr] = useState('');
  const [rSent, setRSent] = useState(false);
  const [rCode, setRCode] = useState('');
  // removals need the password
  const [confirm, setConfirm] = useState<{ label: string; run: (pw: string) => Promise<MfaStatus> } | null>(null);
  const [pw, setPw] = useState('');
  const [passwordless, setPasswordless] = useState(true);
  // password change
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCur, setPwCur] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwNew2, setPwNew2] = useState('');
  const changePw = () =>
    run(async () => {
      if (pwNew !== pwNew2) throw new Error(t('The two new passwords are not the same'));
      await api.changePassword(pwCur, pwNew);
      setPwOpen(false);
      setPwCur(''); setPwNew(''); setPwNew2('');
      flash(t('Password changed'));
    });

  useEffect(() => {
    api.mfaStatus().then(setSt).catch((e) => setError((e as Error).message));
  }, []);

  const run = async (fn: () => Promise<MfaStatus | void>) => {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      if (r) {
        setSt(r);
        if (r.recovery?.length) setCodes(r.recovery);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startTotp = () =>
    run(async () => {
      const r = await api.totpStart();
      setTotp({ secret: r.secret, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 200 }) });
      setTotpCode('');
    });
  const confirmTotp = () =>
    run(async () => {
      const r = await api.totpConfirm(totpCode);
      setTotp(null);
      flash(t('Authenticator app turned on'));
      return r;
    });
  const addPasskey = () =>
    run(async () => {
      const optionsJSON = await api.passkeyOptions(passwordless);
      let response;
      try {
        response = await startRegistration({ optionsJSON });
      } catch {
        throw new Error(t('The passkey prompt was cancelled'));
      }
      const r = await api.passkeyVerify(response, deviceName(), passwordless);
      flash(t('Passkey added'));
      return r;
    });
  const sendAddr = () =>
    run(async () => {
      await api.backupEmailStart(addr);
      setAddrSent(true);
      setAddrCode('');
    });
  const confirmAddr = () =>
    run(async () => {
      const r = await api.backupEmailConfirm(addrCode);
      setAddrSent(false);
      setAddr('');
      flash(t('Backup email turned on'));
      return r;
    });
  const sendReset = () =>
    run(async () => {
      await api.resetEmailStart(rAddr);
      setRSent(true);
      setRCode('');
    });
  const confirmReset = () =>
    run(async () => {
      const r = await api.resetEmailConfirm(rCode);
      setRSent(false);
      setRAddr('');
      flash(t('Reset address saved'));
      return r;
    });
  const ask = (label: string, fn: (pw: string) => Promise<MfaStatus>) => {
    setPw('');
    setConfirm({ label, run: fn });
  };

  const saveCodes = () => {
    const blob = new Blob([`goodmail recovery codes\n\n${codes!.join('\n')}\n\nEach code works once.\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'goodmail-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Escape closes the dialog wherever the focus is
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal accounts-dialog security" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dlg-head">
          <h2>{t('Sign-in security')}</h2>
          <button className="tb icon" onClick={onClose} title={t('Close')}>
            <Icon name="close" />
          </button>
        </div>
        {!st ? (
          <p className="muted">{error || t('Loading…')}</p>
        ) : (
          <>
            <p className={`sec-status ${st.enabled ? 'on' : ''}`}>
              {st.enabled ? t('Two-step verification is on.') : t('Two-step verification is off. Add a method below to protect your sign-in.')}
            </p>

            {codes && (
              <div className="sec-codes">
                <b>{t('Your recovery codes')}</b>
                <p className="muted small">{t('Each code works once, if you lose your other methods. Save them somewhere safe — they are shown only now.')}</p>
                <div className="code-grid">{codes.map((c) => <code key={c}>{c}</code>)}</div>
                <div className="ev-actions">
                  <button className="pill-btn" onClick={saveCodes}>{t('Download')}</button>
                  <button className="pill-btn" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>{t('Copy')}</button>
                  <span className="grow" />
                  <button className="primary" onClick={() => setCodes(null)}>{t('I saved them')}</button>
                </div>
              </div>
            )}

            {features?.password && (
              <section className="sec-item">
                <div className="sec-head">
                  <Icon name="check" />
                  <div className="grow">
                    <b>{t('Password')}</b>
                    <div className="muted small">{t('The password you sign in to your mail with')}</div>
                  </div>
                  {!pwOpen && <button className="pill-btn" onClick={() => setPwOpen(true)}>{t('Change')}</button>}
                </div>
                {pwOpen && (
                  <form className="sec-pad pw-form" onSubmit={(e) => { e.preventDefault(); void changePw(); }}>
                    <input type="password" autoComplete="current-password" value={pwCur} onChange={(e) => setPwCur(e.target.value)} placeholder={t('Current password')} required />
                    <input type="password" autoComplete="new-password" minLength={features.passwordMin} value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder={t('New password ({n}+ characters)', { n: features.passwordMin })} required />
                    <input type="password" autoComplete="new-password" value={pwNew2} onChange={(e) => setPwNew2(e.target.value)} placeholder={t('New password again')} required />
                    <p className="muted small">{t('Other devices and mail apps will ask for the new password.')}</p>
                    <div className="ev-actions">
                      <span className="grow" />
                      <button type="button" className="pill-btn" onClick={() => { setPwOpen(false); setError(''); }}>{t('Cancel')}</button>
                      <button className="primary" disabled={busy}>{t('Change password')}</button>
                    </div>
                  </form>
                )}
              </section>
            )}

            <section className="sec-item">
              <div className="sec-head">
                <Icon name="clock" />
                <div className="grow">
                  <b>{t('Authenticator app')}</b>
                  <div className="muted small">{t('Google Authenticator, Microsoft Authenticator, 1Password, …')}</div>
                </div>
                {st.totp ? (
                  <button className="link-btn" onClick={() => ask(t('Turn off the authenticator app'), (p) => api.mfaRemove('totp', p))}>{t('Remove')}</button>
                ) : (
                  !totp && <button className="pill-btn" disabled={busy} onClick={() => void startTotp()}>{t('Set up')}</button>
                )}
              </div>
              {totp && (
                <form className="sec-setup" onSubmit={(e) => { e.preventDefault(); void confirmTotp(); }}>
                  <img src={totp.qr} alt="QR code" width={160} height={160} />
                  <div>
                    <p className="small">{t('Scan the code with your app, or enter this key:')}</p>
                    <code className="secret">{totp.secret.match(/.{1,4}/g)!.join(' ')}</code>
                    <div className="unlock-row">
                      <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
                      <button className="primary" disabled={busy}>{t('Turn on')}</button>
                    </div>
                  </div>
                </form>
              )}
            </section>

            <section className="sec-item">
              <div className="sec-head">
                <Icon name="people" />
                <div className="grow">
                  <b>{t('Passkeys')}</b>
                  <div className="muted small">{t('Face ID, Touch ID, Windows Hello or a security key')}</div>
                </div>
                <button className="pill-btn" disabled={busy || !window.PublicKeyCredential} onClick={() => void addPasskey()}>{t('Add passkey')}</button>
              </div>
              <label className="menu-check sec-sub">
                <input type="checkbox" checked={passwordless} onChange={(e) => setPasswordless(e.target.checked)} />
                <span>{t('New passkeys can sign in on their own, without the password')}</span>
              </label>
              {st.passkeys.map((p) => (
                <div key={p.id} className="sec-sub">
                  <span className="grow">
                    {p.name} <span className="muted small">· {new Date(p.added).toLocaleDateString(L())}{p.passwordless ? ` · ${t('signs in without password')}` : ''}</span>
                  </span>
                  <button className="link-btn" disabled={busy} onClick={() => void run(() => api.passkeyPasswordless(p.id, !p.passwordless))}>
                    {p.passwordless ? t('Require password too') : t('Allow without password')}
                  </button>
                  <button className="link-btn" onClick={() => ask(t('Remove {name}', { name: p.name }), (pw2) => api.mfaRemove('passkey', pw2, p.id))}>{t('Remove')}</button>
                </div>
              ))}
            </section>

            {features?.reset && (
              <section className="sec-item">
                <div className="sec-head">
                  <Icon name="mail" />
                  <div className="grow">
                    <b>{t('Password reset address')}</b>
                    <div className="muted small">{st.resetEmail ? st.resetEmail : t('If you forget your password, a code is sent here. Use an address outside this mailbox.')}</div>
                  </div>
                  {st.resetEmail && <button className="link-btn" onClick={() => ask(t('Remove the password reset address'), (p) => api.resetEmailRemove(p))}>{t('Remove')}</button>}
                </div>
                {!st.resetEmail && (
                  <form className="unlock-row sec-pad" onSubmit={(e) => { e.preventDefault(); void (rSent ? confirmReset() : sendReset()); }}>
                    {!rSent ? (
                      <>
                        <input type="email" value={rAddr} onChange={(e) => setRAddr(e.target.value)} placeholder={t('another@address.com')} required />
                        <button className="pill-btn" disabled={busy}>{t('Send code')}</button>
                      </>
                    ) : (
                      <>
                        <input value={rCode} onChange={(e) => setRCode(e.target.value)} inputMode="numeric" placeholder={t('Code sent to {to}', { to: rAddr })} required autoFocus />
                        <button className="primary" disabled={busy}>{t('Save')}</button>
                      </>
                    )}
                  </form>
                )}
              </section>
            )}

            <section className="sec-item">
              <div className="sec-head">
                <Icon name="mail" />
                <div className="grow">
                  <b>{t('Backup email')}</b>
                  <div className="muted small">{st.email ? st.email : t('Get a sign-in code at another address')}</div>
                </div>
                {st.email && <button className="link-btn" onClick={() => ask(t('Remove the backup email'), (p) => api.mfaRemove('email', p))}>{t('Remove')}</button>}
              </div>
              {!st.email && (
                <form className="unlock-row sec-pad" onSubmit={(e) => { e.preventDefault(); void (addrSent ? confirmAddr() : sendAddr()); }}>
                  {!addrSent ? (
                    <>
                      <input type="email" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={t('another@address.com')} required />
                      <button className="pill-btn" disabled={busy}>{t('Send code')}</button>
                    </>
                  ) : (
                    <>
                      <input value={addrCode} onChange={(e) => setAddrCode(e.target.value)} inputMode="numeric" placeholder={t('Code sent to {to}', { to: addr })} required autoFocus />
                      <button className="primary" disabled={busy}>{t('Turn on')}</button>
                    </>
                  )}
                </form>
              )}
            </section>

            {st.enabled && (
              <section className="sec-item">
                <div className="sec-head">
                  <Icon name="drafts" />
                  <div className="grow">
                    <b>{t('Recovery codes')}</b>
                    <div className="muted small">{t('{n} unused', { n: st.recoveryLeft })}</div>
                  </div>
                  <button className="link-btn" onClick={() => ask(t('Make new recovery codes (the old ones stop working)'), (p) => api.recoveryNew(p))}>{t('New codes')}</button>
                </div>
              </section>
            )}

            {confirm && (
              <form className="unlock-box" onSubmit={(e) => { e.preventDefault(); const c = confirm; setConfirm(null); void run(() => c.run(pw)); }}>
                <p>{confirm.label} — {t('confirm with your sign-in password')}</p>
                <div className="unlock-row">
                  <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required />
                  <button className="primary">{t('Confirm')}</button>
                  <button type="button" className="pill-btn" onClick={() => setConfirm(null)}>{t('Cancel')}</button>
                </div>
              </form>
            )}
            {error && <div className="error">{error}</div>}
            <p className="muted small">{t('Passwordless passkeys keep an encrypted copy of your mail password on this server, because goodmail needs it to open your mailbox. Codes and other passkeys are a second step after your password.')}</p>
          </>
        )}
      </div>
    </div>
  );
}
