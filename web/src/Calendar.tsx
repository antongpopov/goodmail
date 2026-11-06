import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.ts';
import type { CalEvent, RRule } from './api.ts';
import { Icon } from './icons.tsx';
import { store, save } from './util.ts';

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
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
    title: d.title.trim() || '(No title)',
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
    if (!d.allDay && fromInputs(d.eDate, d.eTime) <= fromInputs(d.sDate, d.sTime)) return flash('The event ends before it starts');
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
        <input className="ev-title" placeholder="Add a title" value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        <div className="ev-row">
          <Icon name="clock" size={18} />
          <div className="ev-times">
            <input type="date" value={d.sDate} onChange={(e) => { const v = e.target.value; setD((x) => ({ ...x, sDate: v, eDate: x.eDate < v ? v : x.eDate })); }} required />
            {!d.allDay && <input type="time" value={d.sTime} onChange={(e) => set('sTime', e.target.value)} required />}
            <span className="muted">to</span>
            <input type="date" value={d.eDate} onChange={(e) => set('eDate', e.target.value)} required />
            {!d.allDay && <input type="time" value={d.eTime} onChange={(e) => set('eTime', e.target.value)} required />}
            <label className="menu-check">
              <input type="checkbox" checked={d.allDay} onChange={(e) => set('allDay', e.target.checked)} /> All day
            </label>
          </div>
        </div>
        <div className="ev-row">
          <Icon name="sync" size={18} />
          <select value={d.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)}>
            <option value="none">Does not repeat</option>
            <option value="DAILY">Every day</option>
            <option value="WEEKDAYS">Every weekday (Mon–Fri)</option>
            <option value="WEEKLY">Every week</option>
            <option value="MONTHLY">Every month</option>
            <option value="YEARLY">Every year</option>
          </select>
          {d.repeat !== 'none' && (
            <>
              <span className="muted">until</span>
              <input type="date" value={d.until} onChange={(e) => set('until', e.target.value)} />
            </>
          )}
        </div>
        <div className="ev-row">
          <Icon name="pin" size={18} />
          <input className="grow" placeholder="Add a location" value={d.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div className="ev-row top">
          <Icon name="drafts" size={18} />
          <textarea className="grow" rows={4} placeholder="Add a description" value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="ev-row">
          <span className="ico-space" />
          <div className="swatches">
            {COLORS.map((c) => (
              <button type="button" key={c} className={`swatch ${d.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} title="Color" />
            ))}
          </div>
        </div>
        <div className="ev-actions">
          {d.id && (
            <>
              {draft.repeat !== 'none' && d.occStart ? (
                <>
                  <button type="button" className="pill-btn danger" disabled={busy} onClick={() => void deleteOne()}>Delete this one</button>
                  <button type="button" className="pill-btn danger" disabled={busy} onClick={() => confirm('Delete every occurrence?') && void run(() => api.deleteEvents([d.id!]))}>Delete series</button>
                </>
              ) : (
                <button type="button" className="pill-btn danger" disabled={busy} onClick={() => void run(() => api.deleteEvents([d.id!]))}>Delete</button>
              )}
            </>
          )}
          <span className="grow" />
          <button type="button" className="pill-btn" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
        {draft.repeat !== 'none' && d.id && <p className="muted small ev-hint">Changes apply to the whole series.</p>}
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
        <b>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
        <span className="grow" />
        <button className="tb icon" onClick={() => setMonth(addMonths(month, -1))} title="Previous month"><Icon name="chevronRight" size={16} /></button>
        <button className="tb icon" onClick={() => setMonth(addMonths(month, 1))} title="Next month"><Icon name="chevronRight" size={16} /></button>
      </div>
      <div className="mini-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => <span key={i} className="mini-dow">{l}</span>)}
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
    if (view === 'day') return cursor.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (view === 'month') return cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const a = days[0];
    const b = days[days.length - 1];
    if (a.getMonth() === b.getMonth()) return a.toLocaleDateString([], { month: 'long', year: 'numeric' });
    return `${a.toLocaleDateString([], { month: 'short' })} – ${b.toLocaleDateString([], { month: 'short', year: 'numeric' })}`;
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
      flash(`Imported ${r.added} new, updated ${r.updated} · ${r.total} events`);
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
          <Icon name="plus" /> New event
        </button>
        <MiniMonth cursor={cursor} range={range} onPick={(d) => setCursor(d)} />
        <div className="menu-label cal-label">My calendars</div>
        <div className="cal-item"><span className="dot" style={{ background: COLORS[0] }} /> Calendar <span className="muted small">{events.length}</span></div>
        <div className="cal-tools">
          <button className="tb" onClick={() => file.current?.click()}><Icon name="import" size={16} /> Import .ics</button>
          <a className="tb" href={api.icsExportUrl}><Icon name="export" size={16} /> Export .ics</a>
        </div>
        <input ref={file} type="file" accept=".ics,text/calendar" hidden onChange={(e) => void doImport(e.target.files)} />
      </aside>

      <section className="cal-main">
        <div className="cal-bar">
          <button className="tb new phone-only" onClick={() => setDraft(newDraft(nextSlot(cursor)))}><Icon name="plus" /></button>
          <button className="pill-btn" onClick={() => setCursor(startOfDay(new Date()))}>Today</button>
          <button className="tb icon flip" onClick={() => step(-1)} title="Previous"><Icon name="chevronRight" /></button>
          <button className="tb icon" onClick={() => step(1)} title="Next"><Icon name="chevronRight" /></button>
          <h2 className="cal-title">{title}</h2>
          <span className="grow" />
          <div className="segment cal-views">
            {(['day', 'workweek', 'week', 'month'] as View[]).map((v) => (
              <button key={v} className={`${view === v ? 'on' : ''} ${v === 'workweek' || v === 'week' ? 'desk-view' : ''}`} onClick={() => setView(v)}>
                {{ day: 'Day', workweek: 'Work week', week: 'Week', month: 'Month' }[v]}
              </button>
            ))}
          </div>
        </div>

        {view === 'month' ? (
          <div className="month">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((l) => <div key={l} className="month-dow">{l}</div>)}
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
                    {d.getDate() === 1 ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) : d.getDate()}
                  </button>
                  {list.slice(0, max).map((o) => chip(o, true))}
                  {list.length > max && (
                    <button className="more-link" onClick={(e) => { e.stopPropagation(); setCursor(d); setView('day'); }}>
                      {list.length - max} more
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
                  <span className="tg-dow">{d.toLocaleDateString([], { weekday: 'short' })}</span>
                  <span className="tg-num">{d.getDate()}</span>
                </div>
              ))}
            </div>
            <div className="tg-allday">
              <div className="tg-gutter small muted">all-day</div>
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
                      {h === 0 ? '' : new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}
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
