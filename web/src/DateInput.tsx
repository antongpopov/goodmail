import { useEffect, useRef, useState } from 'react';
import { L, numericDate, weekdays } from './i18n.ts';
import { iso, parseDate } from './dateparse.ts';

const fromIso = (v: string) => {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** A date field in the chosen date format with a month popup (the browser's own date input only follows the OS). */
export function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(() => (value ? numericDate(fromIso(value)) : ''));
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => fromIso(value || iso(new Date())));
  useEffect(() => setText(value ? numericDate(fromIso(value)) : ''), [value]);
  useEffect(() => {
    if (open) setMonth(fromIso(value || iso(new Date())));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const input = useRef<HTMLInputElement>(null);
  const commit = (raw: string) => {
    const v = parseDate(raw);
    if (v) onChange(v);
    setText(v ? numericDate(fromIso(v)) : value ? numericDate(fromIso(value)) : '');
  };
  const pick = (d: Date) => {
    onChange(iso(d));
    setOpen(false);
    input.current?.focus();
  };
  // 6 weeks starting Monday
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = iso(new Date());
  return (
    <span className="time-wrap date-wrap">
      <input
        ref={input}
        className="date-input"
        value={text}
        autoComplete="off"
        required
        placeholder={numericDate(new Date(2026, 11, 31))}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          setOpen(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit((e.target as HTMLInputElement).value);
            setOpen(false);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === 'ArrowDown') setOpen(true);
        }}
      />
      {open && (
        <div className="cal-pop" onMouseDown={(e) => e.preventDefault()}>
          <div className="cal-pop-head">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="‹">‹</button>
            <b>{month.toLocaleDateString(L(), { month: 'long', year: 'numeric' })}</b>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="›">›</button>
          </div>
          <div className="cal-pop-grid">
            {weekdays('narrow').map((w, i) => (
              <span key={i} className="dow">{w}</span>
            ))}
            {days.map((d) => (
              <button
                type="button"
                key={iso(d)}
                className={`${d.getMonth() !== month.getMonth() ? 'other' : ''} ${iso(d) === value ? 'sel' : ''} ${iso(d) === today ? 'today' : ''}`}
                onClick={() => pick(d)}
              >
                {d.getDate()}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
