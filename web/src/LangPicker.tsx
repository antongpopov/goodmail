import { LANGUAGES, currentLang, setLang, t } from './i18n.ts';

/** Language dropdown; switching reloads the page so every string and date re-renders. */
export function LangPicker({ className = '' }: { className?: string }) {
  return (
    <label className={`lang-picker ${className}`}>
      <span className="sr-only">{t('Language')}</span>
      <select value={currentLang()} onChange={(e) => setLang(e.target.value)} aria-label={t('Language')}>
        {LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
