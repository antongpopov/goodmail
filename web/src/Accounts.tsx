import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { MailAccount } from './api.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

interface Preset {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  help: string;
  link?: string;
  domains?: RegExp;
  disabled?: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'icloud', label: 'iCloud', imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587,
    help: t('Use an app-specific password: Apple Account → Sign-In and Security → App-Specific Passwords.'),
    link: 'https://account.apple.com/account/manage', domains: /@(icloud|me|mac)\.com$/i,
  },
  {
    id: 'gmail', label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 587,
    help: t('Turn on 2-Step Verification, then create an app password (Google Account → Security → App passwords).'),
    link: 'https://myaccount.google.com/apppasswords', domains: /@(gmail|googlemail)\.com$/i,
  },
  {
    id: 'yahoo', label: 'Yahoo', imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 587,
    help: t('Generate an app password under Account Security.'), link: 'https://login.yahoo.com/account/security', domains: /@(yahoo|ymail)\./i,
  },
  {
    id: 'gmx', label: 'GMX', imapHost: 'imap.gmx.net', imapPort: 993, smtpHost: 'mail.gmx.net', smtpPort: 587,
    help: t('First enable IMAP: E-Mail → Settings → POP3 & IMAP. Use your normal password (or an app password if you use 2FA).'), domains: /@gmx\./i,
  },
  {
    id: 'webde', label: 'WEB.DE', imapHost: 'imap.web.de', imapPort: 993, smtpHost: 'smtp.web.de', smtpPort: 587,
    help: t('First enable IMAP: E-Mail → Settings → POP3/IMAP Abruf. Use your normal password (or an app password if you use 2FA).'), domains: /@web\.de$/i,
  },
  {
    id: 'fastmail', label: 'Fastmail', imapHost: 'imap.fastmail.com', imapPort: 993, smtpHost: 'smtp.fastmail.com', smtpPort: 587,
    help: t('Create an app password: Settings → Privacy & Security → Manage app passwords.'), link: 'https://app.fastmail.com/settings/security/apps', domains: /@fastmail\./i,
  },
  {
    id: 'outlook', label: 'Outlook.com', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, help: '',
    domains: /@(outlook|hotmail|live|msn)\./i, disabled: t('Microsoft no longer accepts passwords for IMAP; it needs "Sign in with Microsoft", which is not available yet.'),
  },
  { id: 'imap', label: t('Other (IMAP)'), imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, help: t('Enter your provider’s IMAP and SMTP servers. Many providers require an app password.') },
];

export function AccountsDialog({ accounts, onClose, onChanged, onMainName, flash }: { accounts: MailAccount[]; onClose: () => void; onChanged: () => void; onMainName: (name: string) => void; flash: (m: string) => void }) {
  const [adding, setAdding] = useState<Preset | null>(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, user: '' });
  const [busy, setBusy] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const pick = (p: Preset) => {
    setError('');
    setAdding(p);
    setForm((f) => ({ ...f, imapHost: p.imapHost, imapPort: p.imapPort, smtpHost: p.smtpHost, smtpPort: p.smtpPort, password: '' }));
  };

  // Typing an address of a known provider switches to its preset.
  const onEmail = async (email: string) => {
    set('email', email);
    const p = PRESETS.find((x) => x.domains?.test(email));
    if (p && p.id !== adding?.id) pick(p);
  };

  const guess = async () => {
    try {
      const g = await api.guessAccount(form.email);
      setForm((f) => ({ ...f, imapHost: g.imapHost, imapPort: g.imapPort, smtpHost: g.smtpHost, smtpPort: g.smtpPort }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const save = async () => {
    if (!adding) return;
    setBusy(true);
    setError('');
    try {
      await api.addAccount({ ...form, provider: adding.id, user: form.user || form.email });
      flash(t('Added {email}', { email: form.email }));
      setAdding(null);
      setForm({ email: '', password: '', name: '', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, user: '' });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: MailAccount) => {
    if (!confirm(t('Remove {email} from goodmail? Nothing is deleted on the mail server.', { email: a.email }))) return;
    try {
      await api.removeAccount(a.id);
      onChanged();
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const rename = async (a: MailAccount) => {
    const name = prompt(t('Full name for {email}', { email: a.email }), a.name || '');
    if (name === null || name.trim() === (a.name || '')) return;
    try {
      if (a.id === 'main') {
        await api.setMyName(name);
        onMainName(name.trim());
      } else await api.renameAccount(a.id, name);
      onChanged();
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const extras = accounts.filter((a) => a.id !== 'main');
  const locked = extras.filter((a) => a.locked);

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.unlockAccounts(oldPw);
      setOldPw('');
      flash(t('Unlocked {n} account(s)', { n: r.unlocked }));
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Re-enter just this account's own (app) password. */
  const reenter = (a: MailAccount) => {
    const p = PRESETS.find((x) => x.id === a.provider) ?? PRESETS[PRESETS.length - 1];
    pick(p);
    setForm((f) => ({ ...f, email: a.email, imapHost: p.id === 'imap' ? a.imapHost : f.imapHost }));
  };

  // Escape closes the dialog wherever the focus is
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal accounts-dialog" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dlg-head">
          <h2>{adding ? t('Add {provider} account', { provider: adding.label }) : t('Accounts')}</h2>
          <button className="tb icon" onClick={adding ? () => setAdding(null) : onClose} title={adding ? t('Back') : t('Close')}>
            <Icon name="close" />
          </button>
        </div>

        {!adding ? (
          <>
            <div className="acct-list">
              {accounts.map((a) => (
                <div key={a.id} className="acct-row">
                  <Icon name={a.id === 'main' ? 'mail' : 'inbox'} />
                  <div className="grow">
                    <div>{a.name ? <><b>{a.name}</b> <span className="muted">{a.email}</span></> : a.email}</div>
                    <div className="muted small">{a.id === 'main' ? t('Signed-in account') : a.locked ? t('Locked — add it again with its password') : a.imapHost}</div>
                  </div>
                  {a.locked && (
                    <button className="link-btn" onClick={() => reenter(a)}>
                      {t('Enter its password')}
                    </button>
                  )}
                  <button className="tb icon" title={t('Change name')} onClick={() => void rename(a)}>
                    <Icon name="compose" />
                  </button>
                  {a.id !== 'main' && (
                    <button className="tb icon" title={t('Remove')} onClick={() => void remove(a)}>
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {locked.length > 0 && (
              <form
                className="unlock-box"
                onSubmit={(e) => {
                  e.preventDefault();
                  void unlock();
                }}
              >
                <p>{t('Changed your sign-in password? Locked accounts were saved with the old one. Enter your previous sign-in password to unlock them all.')}</p>
                <div className="unlock-row">
                  <input type="password" autoComplete="off" placeholder={t('Previous sign-in password')} value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
                  <button className="primary" disabled={busy || !oldPw}>{t('Unlock')}</button>
                </div>
                {error && <div className="error">{error}</div>}
              </form>
            )}
            <div className="menu-label">{t('Add an account')}</div>
            <div className="preset-grid">
              {PRESETS.map((p) => (
                <button key={p.id} className="preset" onClick={() => pick(p)} disabled={extras.length >= 10}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="muted small">{t('Passwords are stored encrypted on this server and can only be unlocked with your own sign-in password.')}</p>
          </>
        ) : adding.disabled ? (
          <p className="acct-note">{adding.disabled}</p>
        ) : (
          <form
            className="acct-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {adding.help && (
              <p className="acct-note">
                {adding.help}{' '}
                {adding.link && (
                  <a href={adding.link} target="_blank" rel="noopener noreferrer">
                    {t('Open')}
                  </a>
                )}
              </p>
            )}
            <label>
              {t('Email address')}
              <input type="email" value={form.email} onChange={(e) => void onEmail(e.target.value)} required autoFocus />
            </label>
            <label>
              {adding.id === 'imap' ? t('Password') : t('App password')}
              <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} required />
            </label>
            <label>
              {t('Your name')} <span className="muted small">{t('(shown to recipients)')}</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            {adding.id === 'imap' && (
              <div className="srv-grid">
                <label>{t('IMAP server')}<input value={form.imapHost} onChange={(e) => set('imapHost', e.target.value)} placeholder="imap.example.com" required /></label>
                <label>{t('Port')}<select value={form.imapPort} onChange={(e) => set('imapPort', Number(e.target.value))}><option value={993}>993 (TLS)</option><option value={143}>143 (STARTTLS)</option></select></label>
                <label>{t('SMTP server')}<input value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} placeholder="smtp.example.com" required /></label>
                <label>{t('Port')}<select value={form.smtpPort} onChange={(e) => set('smtpPort', Number(e.target.value))}><option value={587}>587 (STARTTLS)</option><option value={465}>465 (TLS)</option><option value={25}>25</option></select></label>
                <label className="wide">{t('Username')} <span className="muted small">{t('if not the email address')}</span><input value={form.user} onChange={(e) => set('user', e.target.value)} placeholder={form.email} /></label>
                <button type="button" className="link-btn wide" onClick={() => void guess()} disabled={!form.email.includes('@')}>
                  {t('Look up server settings for this address')}
                </button>
              </div>
            )}
            {error && <div className="error">{error}</div>}
            <div className="ev-actions">
              <span className="grow" />
              <button type="button" className="pill-btn" onClick={() => setAdding(null)}>{t('Back')}</button>
              <button className="primary" disabled={busy}>{busy ? t('Checking…') : t('Add account')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
