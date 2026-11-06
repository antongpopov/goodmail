import { useState } from 'react';
import { api } from './api.ts';
import type { Me } from './api.ts';
import { store, save } from './util.ts';

export function Login({ onLogin, appName, source }: { onLogin: (m: Me) => void; appName: string; source: string }) {
  const [email, setEmail] = useState(() => store('lastEmail', ''));
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => store('remember', true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const me = await api.login({ email, password, remember });
      save('lastEmail', email);
      save('remember', remember);
      onLogin(me);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <span>{appName}</span>
        </div>
        <h1>Sign in</h1>
        <label>
          Email address
          <input type="text" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={!!email} />
        </label>
        <label className="chk">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small about">
          Powered by goodmail · AGPL-3.0 ·{' '}
          <a href={source} target="_blank" rel="noopener noreferrer">Source code</a>
        </p>
      </form>
    </div>
  );
}
