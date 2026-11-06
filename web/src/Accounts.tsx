import { useState } from 'react';
import { api } from './api.ts';
import type { MailAccount } from './api.ts';
import { Icon } from './icons.tsx';

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
    help: 'Use an app-specific password: Apple Account → Sign-In and Security → App-Specific Passwords.',
    link: 'https://account.apple.com/account/manage', domains: /@(icloud|me|mac)\.com$/i,
  },
  {
    id: 'gmail', label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 587,
    help: 'Turn on 2-Step Verification, then create an app password (Google Account → Security → App passwords).',
    link: 'https://myaccount.google.com/apppasswords', domains: /@(gmail|googlemail)\.com$/i,
  },
  {
    id: 'yahoo', label: 'Yahoo', imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 587,
    help: 'Generate an app password under Account Security.', link: 'https://login.yahoo.com/account/security', domains: /@(yahoo|ymail)\./i,
  },
  {
    id: 'gmx', label: 'GMX', imapHost: 'imap.gmx.net', imapPort: 993, smtpHost: 'mail.gmx.net', smtpPort: 587,
    help: 'First enable IMAP: E-Mail → Settings → POP3 & IMAP. Use your normal password (or an app password if you use 2FA).', domains: /@gmx\./i,
  },
  {
    id: 'webde', label: 'WEB.DE', imapHost: 'imap.web.de', imapPort: 993, smtpHost: 'smtp.web.de', smtpPort: 587,
    help: 'First enable IMAP: E-Mail → Settings → POP3/IMAP Abruf. Use your normal password (or an app password if you use 2FA).', domains: /@web\.de$/i,
  },
  {
    id: 'fastmail', label: 'Fastmail', imapHost: 'imap.fastmail.com', imapPort: 993, smtpHost: 'smtp.fastmail.com', smtpPort: 587,
    help: 'Create an app password: Settings → Privacy & Security → Manage app passwords.', link: 'https://app.fastmail.com/settings/security/apps', domains: /@fastmail\./i,
  },
  {
    id: 'outlook', label: 'Outlook.com', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, help: '',
    domains: /@(outlook|hotmail|live|msn)\./i, disabled: 'Microsoft no longer accepts passwords for IMAP; it needs "Sign in with Microsoft", which is not available yet.',
  },
  { id: 'imap', label: 'Other (IMAP)', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, help: 'Enter your provider’s IMAP and SMTP servers. Many providers require an app password.' },
];

export function AccountsDialog({ accounts, onClose, onChanged, flash }: { accounts: MailAccount[]; onClose: () => void; onChanged: () => void; flash: (m: string) => void }) {
  const [adding, setAdding] = useState<Preset | null>(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, user: '' });
  const [busy, setBusy] = useState(false);
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
      flash(`Added ${form.email}`);
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
    if (!confirm(`Remove ${a.email} from goodmail? Nothing is deleted on the mail server.`)) return;
    try {
      await api.removeAccount(a.id);
      onChanged();
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const extras = accounts.filter((a) => a.id !== 'main');

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal accounts-dialog" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dlg-head">
          <h2>{adding ? `Add ${adding.label} account` : 'Accounts'}</h2>
          <button className="tb icon" onClick={adding ? () => setAdding(null) : onClose} title={adding ? 'Back' : 'Close'}>
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
                    <div>{a.email}</div>
                    <div className="muted small">{a.id === 'main' ? 'Signed-in account' : a.locked ? 'Locked — add it again with its password' : a.imapHost}</div>
                  </div>
                  {a.id !== 'main' && (
                    <button className="tb icon" title="Remove" onClick={() => void remove(a)}>
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="menu-label">Add an account</div>
            <div className="preset-grid">
              {PRESETS.map((p) => (
                <button key={p.id} className="preset" onClick={() => pick(p)} disabled={extras.length >= 10}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="muted small">Passwords are stored encrypted on this server and can only be unlocked with your own sign-in password.</p>
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
                    Open
                  </a>
                )}
              </p>
            )}
            <label>
              Email address
              <input type="email" value={form.email} onChange={(e) => void onEmail(e.target.value)} required autoFocus />
            </label>
            <label>
              {adding.id === 'imap' ? 'Password' : 'App password'}
              <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} required />
            </label>
            <label>
              Your name <span className="muted small">(shown to recipients)</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            {adding.id === 'imap' && (
              <div className="srv-grid">
                <label>IMAP server<input value={form.imapHost} onChange={(e) => set('imapHost', e.target.value)} placeholder="imap.example.com" required /></label>
                <label>Port<select value={form.imapPort} onChange={(e) => set('imapPort', Number(e.target.value))}><option value={993}>993 (TLS)</option><option value={143}>143 (STARTTLS)</option></select></label>
                <label>SMTP server<input value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} placeholder="smtp.example.com" required /></label>
                <label>Port<select value={form.smtpPort} onChange={(e) => set('smtpPort', Number(e.target.value))}><option value={587}>587 (STARTTLS)</option><option value={465}>465 (TLS)</option><option value={25}>25</option></select></label>
                <label className="wide">Username <span className="muted small">if not the email address</span><input value={form.user} onChange={(e) => set('user', e.target.value)} placeholder={form.email} /></label>
                <button type="button" className="link-btn wide" onClick={() => void guess()} disabled={!form.email.includes('@')}>
                  Look up server settings for this address
                </button>
              </div>
            )}
            {error && <div className="error">{error}</div>}
            <div className="ev-actions">
              <span className="grow" />
              <button type="button" className="pill-btn" onClick={() => setAdding(null)}>Back</button>
              <button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Add account'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
