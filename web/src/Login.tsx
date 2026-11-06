import { useState } from 'react';
import { api } from './api.ts';
import type { Me, MfaChallenge } from './api.ts';
import { startAuthentication } from '@simplewebauthn/browser';
import { store, save } from './util.ts';
import { LangPicker } from './LangPicker.tsx';
import { t } from './i18n.ts';

export function Login({ onLogin, appName, source }: { onLogin: (m: Me) => void; appName: string; source: string }) {
  const [email, setEmail] = useState(() => store('lastEmail', ''));
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => store('remember', true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const me = await api.login({ email, password, remember });
      save('lastEmail', email);
      save('remember', remember);
      if (me.mfa) {
        setPassword('');
        setMfa(me.mfa);
      } else onLogin(me);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (mfa) return <MfaStep appName={appName} challenge={mfa} onLogin={onLogin} onBack={() => setMfa(null)} />;

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <span>{appName}</span>
        </div>
        <div className="login-head">
          <h1>{t('Sign in')}</h1>
          <LangPicker />
        </div>
        <label>
          {t('Email address')}
          <input type="text" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} />
        </label>
        <label>
          {t('Password')}
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={!!email} />
        </label>
        <label className="chk">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('Keep me signed in')}
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? t('Signing in…') : t('Sign in')}
        </button>
        <p className="muted small about">
          {t('Powered by goodmail')} · AGPL-3.0 ·{' '}
          <a href={source} target="_blank" rel="noopener noreferrer">{t('Source code')}</a>
        </p>
      </form>
    </div>
  );
}

/** Second sign-in step: passkey, authenticator code, emailed code or a recovery code. */
function MfaStep({ appName, challenge, onLogin, onBack }: { appName: string; challenge: MfaChallenge; onLogin: (m: Me) => void; onBack: () => void }) {
  type Mode = 'totp' | 'email' | 'recovery';
  const [mode, setMode] = useState<Mode | null>(challenge.totp ? 'totp' : null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const ticket = challenge.ticket;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = (method: string, extra: Record<string, unknown>) => run(async () => onLogin(await api.mfaVerify({ ticket, method, ...extra })));
  const passkey = () =>
    run(async () => {
      const optionsJSON = await api.mfaPasskeyOptions(ticket);
      let response;
      try {
        response = await startAuthentication({ optionsJSON });
      } catch {
        throw new Error(t('The passkey prompt was cancelled'));
      }
      onLogin(await api.mfaVerify({ ticket, method: 'passkey', response }));
    });
  const sendEmail = () =>
    run(async () => {
      const r = await api.mfaSendEmail(ticket);
      setSentTo(r.to);
      setMode('email');
      setCode('');
    });

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode) void verify(mode, { code });
        }}
      >
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <span>{appName}</span>
        </div>
        <h1>{t('Two-step verification')}</h1>
        {challenge.passkey && (
          <button type="button" className="primary" disabled={busy} onClick={() => void passkey()}>
            {t('Use a passkey')}
          </button>
        )}
        {mode && (
          <label>
            {mode === 'totp' ? t('Code from your authenticator app') : mode === 'email' ? t('Code sent to {to}', { to: sentTo }) : t('Recovery code')}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={mode === 'recovery' ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder={mode === 'recovery' ? 'XXXXX-XXXXX' : '123456'}
            />
          </label>
        )}
        {mode && (
          <button className={challenge.passkey ? 'pill-btn' : 'primary'} disabled={busy}>
            {busy ? t('Checking…') : t('Verify')}
          </button>
        )}
        {error && <div className="error">{error}</div>}
        <div className="mfa-alts">
          {challenge.totp && mode !== 'totp' && (
            <button type="button" className="link-btn" onClick={() => { setMode('totp'); setCode(''); }}>
              {t('Use your authenticator app')}
            </button>
          )}
          {challenge.email && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => void sendEmail()}>
              {mode === 'email' ? t('Send the code again') : t('Email a code to {to}', { to: challenge.email })}
            </button>
          )}
          {challenge.recovery && mode !== 'recovery' && (
            <button type="button" className="link-btn" onClick={() => { setMode('recovery'); setCode(''); }}>
              {t('Use a recovery code')}
            </button>
          )}
          <button type="button" className="link-btn" onClick={onBack}>
            {t('Back')}
          </button>
        </div>
      </form>
    </div>
  );
}
