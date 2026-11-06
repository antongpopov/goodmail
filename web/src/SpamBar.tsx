import { t } from './i18n.ts';

/** Green → yellow → red as the spam score approaches the filter's junk threshold. */
export function SpamBar({ spam }: { spam: { score: number; threshold: number; reject?: number; engine: string } }) {
  const level = Math.max(0, Math.min(1, spam.score / Math.max(0.1, spam.threshold)));
  const color = `hsl(${Math.round(120 * (1 - level))} 70% 45%)`;
  const label = level < 0.34 ? t('Not spam') : level < 1 ? t('Possibly spam') : t('Likely spam');
  const tip = t('Spam score {score} (junk at {threshold}{reject}) · {engine}', {
    score: spam.score.toFixed(1),
    threshold: spam.threshold,
    reject: spam.reject ? t(', rejected at {n}', { n: spam.reject }) : '',
    engine: spam.engine,
  });
  return (
    <div className="spam" title={tip} aria-label={tip}>
      <span className="spam-label">{label}</span>
      <span className="spam-track">
        <span className="spam-fill" style={{ width: `${Math.max(6, level * 100)}%`, background: color }} />
      </span>
    </div>
  );
}
