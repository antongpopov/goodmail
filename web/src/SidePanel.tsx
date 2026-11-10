import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.ts';
import type { CalEvent } from './api.ts';
import { Icon } from './icons.tsx';
import { t, L } from './i18n.ts';
import { MiniMonth, expand, fmtTime, COLORS } from './Calendar.tsx';
import type { Occ } from './Calendar.tsx';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const DAYS = 14;

function duration(o: Occ) {
  const min = Math.round((o.end.valueOf() - o.start.valueOf()) / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
}

/** Outlook-style side panel: a small month plus what is coming up. */
export function SidePanel({ onOpenCalendar, flash }: { onOpenCalendar: () => void; flash: (m: string) => void }) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => api.events().then((e) => { setEvents(e); setLoaded(true); }).catch((e) => flash((e as Error).message)), [flash]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => { if (!document.hidden) void reload(); }, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  const days = useMemo(() => {
    const from = day;
    const to = addDays(day, DAYS);
    const occs = events.flatMap((ev) => expand(ev, from, to));
    return Array.from({ length: DAYS }, (_, i) => {
      const d = addDays(day, i);
      const next = addDays(d, 1);
      const list = occs
        .filter((o) => o.start < next && o.end > d)
        .sort((a, b) => Number(b.ev.allDay) - Number(a.ev.allDay) || a.start.valueOf() - b.start.valueOf());
      return { d, list };
    }).filter((x) => x.list.length > 0);
  }, [events, day]);

  const today = startOfDay(new Date());
  const label = (d: Date) => {
    const full = d.toLocaleDateString(L(), { weekday: 'long', day: 'numeric', month: 'long' });
    if (sameDay(d, today)) return `${t('Today')} · ${full}`;
    if (sameDay(d, addDays(today, 1))) return `${t('Tomorrow')} · ${full}`;
    return full;
  };

  return (
    <aside className="side-panel" aria-label={t('Calendar')}>
      <div className="side-head">
        <MiniMonth cursor={day} range={[day, addDays(day, 1)]} onPick={(d) => setDay(startOfDay(d))} />
        <div className="side-tools">
          {!sameDay(day, today) && <button className="pill-btn" onClick={() => setDay(today)}>{t('Today')}</button>}
          <span className="grow" />
          <button className="tb" onClick={onOpenCalendar}><Icon name="calendar" size={16} /> {t('Open calendar')}</button>
        </div>
      </div>
      <div className="side-agenda">
        {loaded && days.length === 0 && <div className="muted side-empty">{t('No upcoming events')}</div>}
        {days.map(({ d, list }) => (
          <section key={d.valueOf()}>
            <h3 className={sameDay(d, today) ? 'today' : ''}>{label(d)}</h3>
            {list.map((o) => (
              <button key={o.key + d.valueOf()} className="side-ev" onClick={onOpenCalendar} title={o.ev.title}>
                <span className="side-time">
                  {o.ev.allDay ? t('All day') : fmtTime(o.start)}
                  {!o.ev.allDay && <span className="muted small">{duration(o)}</span>}
                </span>
                <span className="side-bar" style={{ background: o.ev.color || COLORS[0] }} />
                <span className="side-text">
                  <b>{o.ev.title || t('(no subject)')}</b>
                  {o.ev.location && <span className="muted small">{o.ev.location}</span>}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
