import { LANGUAGES, currentLang, langPref, setLang, t } from './i18n.ts';

/** Language dropdown ("Automatic" follows the browser); switching reloads the page so every string and date re-renders. */
export function LangPicker({ className = '' }: { className?: string }) {
  const auto = LANGUAGES.find((l) => l.id === currentLang())?.name || 'English';
  return (
    <label className={`lang-picker ${className}`}>
      <span className="sr-only">{t('Language')}</span>
      <select value={langPref()} onChange={(e) => setLang(e.target.value)} aria-label={t('Language')}>
        <option value="auto">{`${t('Automatic')} (${auto})`}</option>
        {LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
