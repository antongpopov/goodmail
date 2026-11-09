import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.ts';
import type { CalEvent, RRule } from './api.ts';
import { Icon } from './icons.tsx';
import { store, save } from './util.ts';
import { t, L, weekdays, timeOpts } from './i18n.ts';

type View = 'day' | 'workweek' | 'week' | 'month';
const HOUR = 48; // px per hour in the time grid
const COLORS = ['#0f6cbd', '#038387', '#498205', '#ca5010', '#c239b3', '#8764b8', '#d13438', '#986f0b'];
const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

// ---------- date helpers (local time) ----------
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7)); // Monday
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const fromInputs = (date: string, time: string) => {
  const d = parseYmd(date);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  d.setHours(h, mi, 0, 0);
  return d;
};
/** "9", "930", "09:30", "9.30 pm", "21h" → "HH:MM", or null. */
function parseClock(text: string): string | null {
  const m = /^\s*(\d{1,2})(?:\s*[:.h]?\s*(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(text.replace(/\s+/g, ' '));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === 'p' ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const showClock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(L(), { hour: '2-digit', minute: '2-digit', ...timeOpts() });
};
const SLOTS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

/** A time field that follows the 12 / 24-hour setting, with a dropdown of 15-minute choices (and free typing). */
function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [text, setText] = useState(() => showClock(value));
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const moved = useRef(false); // arrow keys used since the last typing
  useEffect(() => setText(showClock(value)), [value]);
  // index of the slot at or after the current value (what the list scrolls to and highlights)
  const nearest = (v: string) => {
    const i = SLOTS.findIndex((sl) => sl >= v);
    return i < 0 ? SLOTS.length - 1 : i;
  };
  const [hi, setHi] = useState(() => nearest(value));
  useEffect(() => {
    if (open) setHi(nearest(parseClock(text) || value));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`);
    if (el && list.current) list.current.scrollTop = el.offsetTop - list.current.clientHeight / 2 + el.offsetHeight / 2;
  }, [open, hi]);
  const commit = (raw: string) => {
    const v = parseClock(raw);
    if (v) onChange(v);
    setText(showClock(v || value));
  };
  const pick = (sl: string) => {
    onChange(sl);
    setText(showClock(sl));
    setOpen(false);
  };
  return (
    <span className="time-wrap">
      <input
        className="time-input"
        value={text}
        autoComplete="off"
        required
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          moved.current = false;
          setText(e.target.value);
          const v = parseClock(e.target.value);
          if (v) setHi(nearest(v));
        }}
        onBlur={(e) => {
          setOpen(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            moved.current = true;
            setHi((i) => Math.max(0, Math.min(SLOTS.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (moved.current) pick(SLOTS[hi]);
            else {
              commit(text);
              setOpen(false);
            }
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="time-list" ref={list} onMouseDown={(e) => e.preventDefault()}>
          {SLOTS.map((sl, i) => (
            <button type="button" key={sl} data-i={i} className={`${sl === value ? 'cur' : ''} ${i === hi ? 'hi' : ''}`} onClick={() => pick(sl)}>
              {showClock(sl)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
const fmtTime = (d: Date) => d.toLocaleTimeString(L(), { hour: '2-digit', minute: '2-digit', ...timeOpts() });

interface Occ {
  ev: CalEvent;
  start: Date;
  end: Date;
  key: string;
}

function evStart(ev: CalEvent) {
  return ev.allDay ? parseYmd(String(ev.start)) : new Date(Number(ev.start));
}
function evEnd(ev: CalEvent) {
  return ev.allDay ? parseYmd(String(ev.end)) : new Date(Number(ev.end));
}

/** Expand an event (and its recurrence) into the occurrences overlapping [from, to). */
function expand(ev: CalEvent, from: Date, to: Date): Occ[] {
  const s0 = evStart(ev);
  const e0 = evEnd(ev);
  const dur = e0.valueOf() - s0.valueOf();
  const dayDur = Math.round(dur / 86400000);
  const mk = (s: Date): Occ => ({ ev, start: s, end: ev.allDay ? addDays(s, Math.max(1, dayDur)) : new Date(s.valueOf() + dur), key: `${ev.id}:${s.valueOf()}` });
  const hit = (o: Occ) => o.start < to && o.end > from;
  const r = ev.rrule;
  if (!r) {
    const o = mk(s0);
    return hit(o) ? [o] : [];
  }
  const ex = new Set((ev.exdates || []).map((x) => (ev.allDay ? String(x) : String(Math.round(Number(x) / 60000)))));
  const excluded = (d: Date) => ex.has(ev.allDay ? ymd(d) : String(Math.round(d.valueOf() / 60000)));
  const out: Occ[] = [];
  const until = r.until ? new Date(r.until) : null;
  let n = 0;
  const push = (d: Date) => {
    if (d < s0) return true;
    if (until && d > until) return false;
    if (r.count && n >= r.count) return false;
    n++;
    if (d >= to) return false;
    const o = mk(d);
    if (!excluded(d) && hit(o)) out.push(o);
    return true;
  };
  const time = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), s0.getHours(), s0.getMinutes());
  // Jump close to the visible range for open-ended daily/weekly series.
  let skip = 0;
  if (!r.count && (r.freq === 'DAILY' || r.freq === 'WEEKLY')) {
    const period = (r.freq === 'DAILY' ? 1 : 7) * r.interval;
    skip = Math.max(0, Math.floor((startOfDay(from).valueOf() - startOfDay(s0).valueOf()) / 86400000 / period) - 1) * period;
  }
  for (let i = 0; i < 3000; i++) {
    if (r.freq === 'WEEKLY' && r.byday?.length) {
      const wk = addDays(startOfWeek(s0), skip + i * 7 * r.interval);
      let go = true;
      for (const d of [...r.byday].sort((a, b) => DOW.indexOf(a) - DOW.indexOf(b))) {
        go = push(time(addDays(wk, DOW.indexOf(d))));
        if (!go) break;
      }
      if (!go) break;
    } else {
      let d: Date;
      if (r.freq === 'DAILY') d = time(addDays(s0, skip + i * r.interval));
      else if (r.freq === 'WEEKLY') d = time(addDays(s0, skip + i * 7 * r.interval));
      else if (r.freq === 'MONTHLY') {
        d = new Date(s0.getFullYear(), s0.getMonth() + i * r.interval, s0.getDate(), s0.getHours(), s0.getMinutes());
        if (d.getDate() !== s0.getDate()) continue; // e.g. the 31st in a 30-day month
      } else {
        d = new Date(s0.getFullYear() + i * r.interval, s0.getMonth(), s0.getDate(), s0.getHours(), s0.getMinutes());
        if (d.getMonth() !== s0.getMonth()) continue;
      }
      if (!push(d)) break;
    }
  }
  return out;
}

/** Side-by-side columns for overlapping timed events in one day. */
function layout(items: Occ[]) {
  const sorted = [...items].sort((a, b) => a.start.valueOf() - b.start.valueOf() || b.end.valueOf() - a.end.valueOf());
  const placed: { o: Occ; col: number; cols: number }[] = [];
  let cluster: { o: Occ; col: number; cols: number }[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => (c.cols = cols));
    placed.push(...cluster);
    cluster = [];
  };
  for (const o of sorted) {
    if (cluster.length && o.start.valueOf() >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.o.end > o.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ o, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, o.end.valueOf());
  }
  flush();
  return placed;
}

const tint = (c: string) => `color-mix(in srgb, ${c} 22%, var(--surface))`;

// ---------- event dialog ----------

type Repeat = 'none' | 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
interface Draft {
  id?: string;
  uid?: string;
  title: string;
  allDay: boolean;
  sDate: string;
  sTime: string;
  eDate: string;
  eTime: string;
  location: string;
  notes: string;
  color: string;
  repeat: Repeat;
  until: string;
  exdates?: (number | string)[];
  occStart?: Date;
}

function draftFrom(ev: CalEvent, occ?: Occ): Draft {
  const s = evStart(ev);
  const e = evEnd(ev);
  const r = ev.rrule;
  const repeat: Repeat = !r
    ? 'none'
    : r.freq === 'WEEKLY' && r.byday?.join(',') === 'MO,TU,WE,TH,FR'
      ? 'WEEKDAYS'
      : (r.freq as Repeat);
  const endShown = ev.allDay ? addDays(e, -1) : e; // all-day end is exclusive
  return {
    id: ev.id,
    uid: ev.uid,
    title: ev.title,
    allDay: ev.allDay,
    sDate: ymd(s),
    sTime: hm(s),
    eDate: ymd(endShown),
    eTime: hm(e),
    location: ev.location,
    notes: ev.notes,
    color: ev.color || COLORS[0],
    repeat,
    until: r?.until ? ymd(new Date(r.until)) : '',
    exdates: ev.exdates,
    occStart: occ?.start,
  };
}

function newDraft(start: Date, allDay = false): Draft {
  const end = new Date(start.valueOf() + 3600_000);
  return { title: '', allDay, sDate: ymd(start), sTime: hm(start), eDate: ymd(allDay ? start : end), eTime: hm(end), location: '', notes: '', color: COLORS[0], repeat: 'none', until: '' };
}

function toEvent(d: Draft): Partial<CalEvent> {
  const rrule: RRule | undefined =
    d.repeat === 'none'
      ? undefined
      : {
          freq: d.repeat === 'WEEKDAYS' ? 'WEEKLY' : d.repeat,
          interval: 1,
          ...(d.repeat === 'WEEKDAYS' ? { byday: ['MO', 'TU', 'WE', 'TH', 'FR'] } : {}),
          ...(d.until ? { until: fromInputs(d.until, '23:59').valueOf() } : {}),
        };
  return {
    id: d.id,
    uid: d.uid,
    title: d.title.trim() || t('(No title)'),
    allDay: d.allDay,
    start: d.allDay ? d.sDate : fromInputs(d.sDate, d.sTime).valueOf(),
    end: d.allDay ? ymd(addDays(parseYmd(d.eDate < d.sDate ? d.sDate : d.eDate), 1)) : fromInputs(d.eDate, d.eTime).valueOf(),
    location: d.location,
    notes: d.notes,
    color: d.color,
    rrule,
    exdates: d.exdates,
  };
}

function EventDialog({ draft, onClose, onSaved, flash }: { draft: Draft; onClose: () => void; onSaved: () => void; flash: (m: string) => void }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onSaved();
    } catch (err) {
      flash((err as Error).message);
      setBusy(false);
    }
  };
  const submit = () => {
    if (!d.allDay && fromInputs(d.eDate, d.eTime) <= fromInputs(d.sDate, d.sTime)) return flash(t('The event ends before it starts'));
    void run(() => api.saveEvent(toEvent(d)));
  };
  const deleteOne = () =>
    run(() => {
      const occ = d.occStart!;
      const ex = [...(d.exdates || []), d.allDay ? ymd(occ) : occ.valueOf()];
      return api.saveEvent({ ...toEvent(draft), exdates: ex });
    });

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal event-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      >
        <div className="ev-color-bar" style={{ background: d.color }} />
        <input className="ev-title" placeholder={t('Add a title')} value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        <div className="ev-row">
          <Icon name="clock" size={18} />
          <div className="ev-times">
            <input type="date" value={d.sDate} onChange={(e) => { const v = e.target.value; setD((x) => ({ ...x, sDate: v, eDate: x.eDate < v ? v : x.eDate })); }} required />
            {!d.allDay && <TimeInput value={d.sTime} onChange={(v) => set('sTime', v)} />}
            <span className="muted">{t('to')}</span>
            <input type="date" value={d.eDate} onChange={(e) => set('eDate', e.target.value)} required />
            {!d.allDay && <TimeInput value={d.eTime} onChange={(v) => set('eTime', v)} />}
            <label className="menu-check">
              <input type="checkbox" checked={d.allDay} onChange={(e) => set('allDay', e.target.checked)} /> {t('All day')}
            </label>
          </div>
        </div>
        <div className="ev-row">
          <Icon name="sync" size={18} />
          <select value={d.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)}>
            <option value="none">{t('Does not repeat')}</option>
            <option value="DAILY">{t('Every day')}</option>
            <option value="WEEKDAYS">{t('Every weekday (Mon–Fri)')}</option>
            <option value="WEEKLY">{t('Every week')}</option>
            <option value="MONTHLY">{t('Every month')}</option>
            <option value="YEARLY">{t('Every year')}</option>
          </select>
          {d.repeat !== 'none' && (
            <>
              <span className="muted">{t('until')}</span>
              <input type="date" value={d.until} onChange={(e) => set('until', e.target.value)} />
            </>
          )}
        </div>
        <div className="ev-row">
          <Icon name="pin" size={18} />
          <input className="grow" placeholder={t('Add a location')} value={d.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div className="ev-row top">
          <Icon name="drafts" size={18} />
          <textarea className="grow" rows={4} placeholder={t('Add a description')} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="ev-row">
          <span className="ico-space" />
          <div className="swatches">
            {COLORS.map((c) => (
              <button type="button" key={c} className={`swatch ${d.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} title={t('Color')} />
            ))}
          </div>
        </div>
        <div className="ev-actions">
          {d.id && (
            <>
              {draft.repeat !== 'none' && d.occStart ? (
                <>
                  <button type="button" className="pill-btn danger" disabled={busy} onClick={() => void deleteOne()}>{t('Delete this one')}</button>
                  <button type="button" className="pill-btn danger" disabled={busy} onClick={() => confirm(t('Delete every occurrence?')) && void run(() => api.deleteEvents([d.id!]))}>{t('Delete series')}</button>
                </>
              ) : (
                <button type="button" className="pill-btn danger" disabled={busy} onClick={() => void run(() => api.deleteEvents([d.id!]))}>{t('Delete')}</button>
              )}
            </>
          )}
          <span className="grow" />
          <button type="button" className="pill-btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
        </div>
        {draft.repeat !== 'none' && d.id && <p className="muted small ev-hint">{t('Changes apply to the whole series.')}</p>}
      </form>
    </div>
  );
}

// ---------- mini month ----------

function MiniMonth({ cursor, onPick, range }: { cursor: Date; onPick: (d: Date) => void; range: [Date, Date] }) {
  const [month, setMonth] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  useEffect(() => setMonth(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), [cursor]);
  const first = startOfWeek(month);
  const today = new Date();
  return (
    <div className="mini">
      <div className="mini-head">
        <b>{month.toLocaleDateString(L(), { month: 'long', year: 'numeric' })}</b>
        <span className="grow" />
        <button className="tb icon" onClick={() => setMonth(addMonths(month, -1))} title={t('Previous month')}><Icon name="chevronRight" size={16} /></button>
        <button className="tb icon" onClick={() => setMonth(addMonths(month, 1))} title={t('Next month')}><Icon name="chevronRight" size={16} /></button>
      </div>
      <div className="mini-grid">
        {weekdays('narrow').map((l, i) => <span key={i} className="mini-dow">{l}</span>)}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(first, i);
          const cls = [
            'mini-day',
            d.getMonth() !== month.getMonth() ? 'other' : '',
            sameDay(d, today) ? 'today' : '',
            d >= range[0] && d < range[1] ? 'inrange' : '',
          ].join(' ');
          return (
            <button key={i} className={cls} onClick={() => onPick(d)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- main ----------

export function Calendar({ flash, isPhone }: { flash: (m: string) => void; isPhone: boolean }) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [viewPref, setViewPref] = useState<View>(() => store('calView', 'week'));
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [now, setNow] = useState(new Date());
  const scroller = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const view: View = isPhone && (viewPref === 'week' || viewPref === 'workweek') ? 'day' : viewPref;

  const reload = useCallback(() => api.events().then(setEvents).catch((e) => flash((e as Error).message)), [flash]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const setView = (v: View) => {
    setViewPref(v);
    save('calView', v);
  };

  const days = useMemo(() => {
    if (view === 'day') return [cursor];
    if (view === 'month') {
      const first = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      return Array.from({ length: 42 }, (_, i) => addDays(first, i));
    }
    const w = startOfWeek(cursor);
    return Array.from({ length: view === 'workweek' ? 5 : 7 }, (_, i) => addDays(w, i));
  }, [view, cursor]);
  const range: [Date, Date] = [days[0], addDays(days[days.length - 1], 1)];

  const occs = useMemo(() => events.flatMap((e) => expand(e, range[0], range[1])), [events, range[0].valueOf(), range[1].valueOf()]);

  // Scroll the time grid to ~7:30 when the view changes.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = HOUR * 7.5;
  }, [view]);

  const step = (dir: number) => {
    if (view === 'day') setCursor(addDays(cursor, dir));
    else if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else setCursor(addDays(cursor, 7 * dir));
  };

  const title = (() => {
    if (view === 'day') return cursor.toLocaleDateString(L(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (view === 'month') return cursor.toLocaleDateString(L(), { month: 'long', year: 'numeric' });
    const a = days[0];
    const b = days[days.length - 1];
    if (a.getMonth() === b.getMonth()) return a.toLocaleDateString(L(), { month: 'long', year: 'numeric' });
    return `${a.toLocaleDateString(L(), { month: 'short' })} – ${b.toLocaleDateString(L(), { month: 'short', year: 'numeric' })}`;
  })();

  const openOcc = (o: Occ) => setDraft(draftFrom(o.ev, o));
  const saved = () => {
    setDraft(null);
    void reload();
  };

  const doImport = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const r = await api.importEvents(await f.text());
      await reload();
      flash(t('Imported {added} new, updated {updated} · {total} events', { added: r.added, updated: r.updated, total: r.total }));
    } catch (err) {
      flash((err as Error).message);
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  const chip = (o: Occ, showTime: boolean) => (
    <button
      key={o.key}
      className="chip"
      style={{ background: tint(o.ev.color || COLORS[0]), borderLeftColor: o.ev.color || COLORS[0] }}
      onClick={(e) => {
        e.stopPropagation();
        openOcc(o);
      }}
      title={o.ev.title}
    >
      {showTime && !o.ev.allDay && <span className="chip-time">{fmtTime(o.start)}</span>}
      {o.ev.title}
    </button>
  );

  const today = startOfDay(now);
  const allDayOccs = (d: Date) => occs.filter((o) => (o.ev.allDay || o.end.valueOf() - o.start.valueOf() >= 86400000) && o.start < addDays(d, 1) && o.end > d);
  const timedOccs = (d: Date) => occs.filter((o) => !o.ev.allDay && o.end.valueOf() - o.start.valueOf() < 86400000 && o.start < addDays(d, 1) && o.end > d);

  return (
    <div className="calendar">
      <aside className="cal-side">
        <button className="tb new cal-new" onClick={() => setDraft(newDraft(nextSlot(cursor)))}>
          <Icon name="plus" /> {t('New event')}
        </button>
        <MiniMonth cursor={cursor} range={range} onPick={(d) => setCursor(d)} />
        <div className="menu-label cal-label">{t('My calendars')}</div>
        <div className="cal-item"><span className="dot" style={{ background: COLORS[0] }} /> {t('Calendar')} <span className="muted small">{events.length}</span></div>
        <div className="cal-tools">
          <button className="tb" onClick={() => file.current?.click()}><Icon name="import" size={16} /> {t('Import .ics')}</button>
          <a className="tb" href={api.icsExportUrl}><Icon name="export" size={16} /> {t('Export .ics')}</a>
        </div>
        <input ref={file} type="file" accept=".ics,text/calendar" hidden onChange={(e) => void doImport(e.target.files)} />
      </aside>

      <section className="cal-main">
        <div className="cal-bar">
          <button className="tb new phone-only" onClick={() => setDraft(newDraft(nextSlot(cursor)))}><Icon name="plus" /></button>
          <button className="pill-btn" onClick={() => setCursor(startOfDay(new Date()))}>{t('Today')}</button>
          <button className="tb icon flip" onClick={() => step(-1)} title={t('Previous')}><Icon name="chevronRight" /></button>
          <button className="tb icon" onClick={() => step(1)} title={t('Next')}><Icon name="chevronRight" /></button>
          <h2 className="cal-title">{title}</h2>
          <span className="grow" />
          <div className="segment cal-views">
            {(['day', 'workweek', 'week', 'month'] as View[]).map((v) => (
              <button key={v} className={`${view === v ? 'on' : ''} ${v === 'workweek' || v === 'week' ? 'desk-view' : ''}`} onClick={() => setView(v)}>
                {{ day: t('Day'), workweek: t('Work week'), week: t('Week'), month: t('Month') }[v]}
              </button>
            ))}
          </div>
        </div>

        {view === 'month' ? (
          <div className="month">
            {weekdays('short').map((l) => <div key={l} className="month-dow">{l}</div>)}
            {days.map((d) => {
              const list = occs
                .filter((o) => o.start < addDays(d, 1) && o.end > d)
                .sort((a, b) => Number(b.ev.allDay) - Number(a.ev.allDay) || a.start.valueOf() - b.start.valueOf());
              const max = 3;
              return (
                <div
                  key={d.valueOf()}
                  className={`month-cell ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''}`}
                  onClick={() => setDraft(newDraft(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9)))}
                >
                  <button className="month-num" onClick={(e) => { e.stopPropagation(); setCursor(d); setView('day'); }}>
                    {d.getDate() === 1 ? d.toLocaleDateString(L(), { day: 'numeric', month: 'short' }) : d.getDate()}
                  </button>
                  {list.slice(0, max).map((o) => chip(o, true))}
                  {list.length > max && (
                    <button className="more-link" onClick={(e) => { e.stopPropagation(); setCursor(d); setView('day'); }}>
                      {t('{n} more', { n: list.length - max })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tgrid" style={{ ['--cols' as string]: days.length }}>
            <div className="tg-head">
              <div className="tg-gutter" />
              {days.map((d) => (
                <div key={d.valueOf()} className={`tg-day ${sameDay(d, today) ? 'today' : ''}`}>
                  <span className="tg-dow">{d.toLocaleDateString(L(), { weekday: 'short' })}</span>
                  <span className="tg-num">{d.getDate()}</span>
                </div>
              ))}
            </div>
            <div className="tg-allday">
              <div className="tg-gutter small muted">{t('all-day')}</div>
              {days.map((d) => (
                <div key={d.valueOf()} className="tg-allday-cell" onClick={() => setDraft(newDraft(d, true))}>
                  {allDayOccs(d).map((o) => chip(o, false))}
                </div>
              ))}
            </div>
            <div className="tg-scroll" ref={scroller}>
              <div className="tg-body" style={{ height: HOUR * 24 }}>
                <div className="tg-hours">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="tg-hour" style={{ top: h * HOUR }}>
                      {h === 0 ? '' : new Date(2000, 0, 1, h).toLocaleTimeString(L(), { hour: 'numeric', ...timeOpts() })}
                    </div>
                  ))}
                </div>
                {days.map((d) => {
                  const dayStart = d.valueOf();
                  const items = layout(timedOccs(d));
                  return (
                    <div
                      key={dayStart}
                      className={`tg-col ${sameDay(d, today) ? 'today' : ''}`}
                      onClick={(e) => {
                        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                        const mins = Math.floor(y / HOUR * 2) * 30;
                        setDraft(newDraft(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, mins)));
                      }}
                    >
                      {items.map(({ o, col, cols }) => {
                        const s = Math.max(o.start.valueOf(), dayStart);
                        const e = Math.min(o.end.valueOf(), dayStart + 86400000);
                        const top = ((s - dayStart) / 3600000) * HOUR;
                        const h = Math.max(20, ((e - s) / 3600000) * HOUR - 2);
                        const c = o.ev.color || COLORS[0];
                        return (
                          <button
                            key={o.key}
                            className={`tg-ev ${h < 36 ? 'short' : ''}`}
                            style={{ top, height: h, left: `calc(${(col / cols) * 100}% + 1px)`, width: `calc(${100 / cols}% - 3px)`, background: tint(c), borderLeftColor: c }}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              openOcc(o);
                            }}
                          >
                            <b>{o.ev.title}</b>
                            <span>{fmtTime(o.start)} – {fmtTime(o.end)}</span>
                            {o.ev.location && h >= 52 && <span>{o.ev.location}</span>}
                          </button>
                        );
                      })}
                      {sameDay(d, now) && <div className="now-line" style={{ top: ((now.valueOf() - dayStart) / 3600000) * HOUR }} />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>
      {draft && <EventDialog draft={draft} onClose={() => setDraft(null)} onSaved={saved} flash={flash} />}
    </div>
  );
}

/** Next half-hour slot on the given day (today: from now; other days: 9:00). */
function nextSlot(day: Date) {
  const n = new Date();
  if (!sameDay(day, n)) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);
  const m = Math.ceil((n.getHours() * 60 + n.getMinutes() + 1) / 30) * 30;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
}
