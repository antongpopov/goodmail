import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

/** The raw header block of a message (routing, authentication results, spam scores…). */
export function HeadersDialog({ folder, uid, account, onClose, flash }: { folder: string; uid: number; account?: string; onClose: () => void; flash: (m: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.headers(folder, uid, account).then((r) => live && setText(r.headers), (e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [folder, uid]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || '');
      flash(t('Copied'));
    } catch {
      flash(t('Copy failed'));
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal accounts-dialog headers-dialog">
        <div className="dlg-head">
          <h2>{t('Message headers')}</h2>
          {text && (
            <button className="tb" onClick={() => void copy()}>
              {t('Copy')}
            </button>
          )}
          <button className="tb icon" onClick={onClose} title={t('Close')}>
            <Icon name="close" />
          </button>
        </div>
        {error ? <p className="error">{error}</p> : text === null ? <span className="spinner" /> : <pre className="headers-text">{text}</pre>}
      </div>
    </div>
  );
}
