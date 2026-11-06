// Per-account calendar: events in <data>/calendar/<sha256(account)>.json, plus iCalendar (.ics) import/export.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './vault.ts';

export interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  until?: number; // ms, inclusive
  count?: number;
  byday?: string[]; // MO,TU,…
}

export interface CalEvent {
  id: string;
  uid: string;
  title: string;
  allDay: boolean;
  /** Timed: UTC ms. All-day: "YYYY-MM-DD" (end exclusive). */
  start: number | string;
  end: number | string;
  location: string;
  notes: string;
  color: string;
  rrule?: RRule;
  exdates?: (number | string)[];
  updated: number;
}

const DIR = path.join(DATA, 'calendar');
const fileFor = (account: string) =>
  path.join(DIR, crypto.createHash('sha256').update(account.toLowerCase()).digest('hex') + '.json');

const queues = new Map<string, Promise<unknown>>();
function serial<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(account) ?? Promise.resolve()).then(fn, fn);
  queues.set(account, next.catch(() => {}));
  return next;
}

export async function loadEvents(account: string): Promise<CalEvent[]> {
  try {
    return JSON.parse(await fs.readFile(fileFor(account), 'utf8')) as CalEvent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function store(account: string, list: CalEvent[]) {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  const file = fileFor(account);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list), { mode: 0o600 });
  await fs.rename(tmp, file);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);

export function normalizeEvent(e: Partial<CalEvent>): CalEvent {
  const allDay = !!e.allDay;
  const pick = (v: unknown) => (allDay ? (DATE_RE.test(String(v)) ? String(v) : '') : Number.isFinite(Number(v)) ? Number(v) : NaN);
  const start = pick(e.start);
  let end = pick(e.end);
  if (start === '' || Number.isNaN(start)) throw Object.assign(new Error('Event needs a valid start'), { status: 400 });
  if (end === '' || Number.isNaN(end) || end <= start) end = allDay ? nextDay(start as string) : (start as number) + 3600_000;
  const r = e.rrule;
  const rrule: RRule | undefined =
    r && ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq)
      ? {
          freq: r.freq,
          interval: Math.max(1, Math.min(999, Number(r.interval) || 1)),
          ...(Number(r.until) ? { until: Number(r.until) } : {}),
          ...(Number(r.count) ? { count: Math.min(5000, Number(r.count)) } : {}),
          ...(Array.isArray(r.byday) && r.byday.length ? { byday: r.byday.filter((d) => /^(MO|TU|WE|TH|FR|SA|SU)$/.test(d)) } : {}),
        }
      : undefined;
  return {
    id: str(e.id, 64) || crypto.randomUUID(),
    uid: str(e.uid, 255) || `${crypto.randomUUID()}@goodmail`,
    title: str(e.title, 500).trim(),
    allDay,
    start,
    end,
    location: str(e.location, 500).trim(),
    notes: str(e.notes, 20000),
    color: /^#[0-9a-f]{6}$/i.test(String(e.color)) ? String(e.color) : '',
    ...(rrule ? { rrule } : {}),
    ...(Array.isArray(e.exdates) && e.exdates.length ? { exdates: e.exdates.slice(0, 1000) } : {}),
    updated: Date.now(),
  };
}

function nextDay(d: string) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export const saveEvent = (account: string, input: Partial<CalEvent>) =>
  serial(account, async () => {
    const list = await loadEvents(account);
    const ev = normalizeEvent(input);
    const i = list.findIndex((x) => x.id === ev.id);
    if (i >= 0) list[i] = ev;
    else list.push(ev);
    await store(account, list);
    return ev;
  });

export const deleteEvents = (account: string, ids: string[]) =>
  serial(account, async () => {
    const drop = new Set(ids);
    const list = (await loadEvents(account)).filter((e) => !drop.has(e.id));
    await store(account, list);
    return list.length;
  });

/** Import replaces events with the same UID (e.g. an updated invitation), adds the rest. */
export const importEvents = (account: string, incoming: Partial<CalEvent>[]) =>
  serial(account, async () => {
    const list = await loadEvents(account);
    let added = 0;
    let updated = 0;
    for (const raw of incoming) {
      let ev: CalEvent;
      try {
        ev = normalizeEvent({ ...raw, id: undefined });
      } catch {
        continue;
      }
      const i = list.findIndex((x) => x.uid === ev.uid);
      if (i >= 0) {
        list[i] = { ...ev, id: list[i].id, color: list[i].color };
        updated++;
      } else {
        list.push(ev);
        added++;
      }
    }
    if (list.length > 50000) throw Object.assign(new Error('Calendar is limited to 50,000 events'), { status: 400 });
    await store(account, list);
    return { added, updated, total: list.length, first: incoming[0]?.start };
  });

// ---------------- iCalendar ----------------

// Outlook / Exchange invitations use Windows zone names.
const WINDOWS_TZ: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'FLE Standard Time': 'Europe/Helsinki',
  'E. Europe Standard Time': 'Europe/Bucharest',
  'GTB Standard Time': 'Europe/Athens',
  'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

function validTz(tz: string | undefined) {
  if (!tz) return undefined;
  const t = WINDOWS_TZ[tz] || tz.replace(/^\/[^/]+\/[^/]+\//, ''); // strip "/mozilla.org/20050126_1/" prefixes
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: t });
    return t;
  } catch {
    return undefined;
  }
}

function tzOffset(ts: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(ts)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}

function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = guess - tzOffset(guess, tz);
  ts = guess - tzOffset(ts, tz); // second pass fixes DST edges
  return ts;
}

/** Parse an iCalendar date/date-time value. */
function parseIcsTime(value: string, params: string, fallbackTz: string): { allDay: boolean; v: number | string } | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || /VALUE=DATE(?!-)/i.test(params)) return { allDay: true, v: `${y}-${mo}-${d}` };
  if (z) return { allDay: false, v: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) };
  const tz = validTz(/TZID=("?)([^;:"]+)\1/i.exec(params)?.[2]) || validTz(fallbackTz) || 'UTC';
  return { allDay: false, v: zonedToUtc(+y, +mo, +d, +h, +mi, +(s || 0), tz) };
}

function unescapeIcs(s: string) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
function escapeIcs(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

function parseDuration(d: string) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d.trim());
  if (!m) return 0;
  const [, sign, w, dd, h, mi, s] = m;
  const ms = ((+(w || 0) * 7 + +(dd || 0)) * 86400 + +(h || 0) * 3600 + +(mi || 0) * 60 + +(s || 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

export function parseIcs(text: string, fallbackTz: string): Partial<CalEvent>[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out: Partial<CalEvent>[] = [];
  let ev: Record<string, { params: string; value: string }[]> | null = null;
  let depth = 0; // ignore VALARM etc. nested inside VEVENT
  for (const line of lines) {
    const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const [, rawProp, params, value] = m;
    const prop = rawProp.toUpperCase();
    if (prop === 'BEGIN') {
      if (value.toUpperCase() === 'VEVENT' && !ev) ev = {};
      else if (ev) depth++;
      continue;
    }
    if (prop === 'END') {
      if (ev && depth > 0) depth--;
      else if (ev && value.toUpperCase() === 'VEVENT') {
        const one = (k: string) => ev![k]?.[0];
        const ds = one('DTSTART');
        const start = ds && parseIcsTime(ds.value, ds.params, fallbackTz);
        if (start && !/^CANCELLED$/i.test(one('STATUS')?.value || '')) {
          const de = one('DTEND');
          let end = de && parseIcsTime(de.value, de.params, fallbackTz)?.v;
          if (end === undefined && one('DURATION')) {
            const dur = parseDuration(one('DURATION')!.value);
            end = start.allDay
              ? new Date(Date.parse(start.v + 'T00:00:00Z') + dur).toISOString().slice(0, 10)
              : (start.v as number) + dur;
          }
          let rrule: RRule | undefined;
          const rr = one('RRULE')?.value;
          if (rr) {
            const kv = Object.fromEntries(rr.split(';').map((p) => p.split('=') as [string, string]));
            const until = kv.UNTIL ? parseIcsTime(kv.UNTIL, '', fallbackTz) : undefined;
            rrule = {
              freq: kv.FREQ as RRule['freq'],
              interval: Number(kv.INTERVAL) || 1,
              ...(until ? { until: until.allDay ? Date.parse(until.v + 'T23:59:59Z') : (until.v as number) } : {}),
              ...(kv.COUNT ? { count: Number(kv.COUNT) } : {}),
              ...(kv.BYDAY ? { byday: kv.BYDAY.split(',').map((d) => d.replace(/^[+-]?\d+/, '')) } : {}),
            };
          }
          const exdates = (ev['EXDATE'] || []).flatMap((x) =>
            x.value.split(',').map((v) => parseIcsTime(v, x.params, fallbackTz)?.v).filter((v) => v !== undefined),
          ) as (number | string)[];
          out.push({
            uid: one('UID')?.value || undefined,
            title: unescapeIcs(one('SUMMARY')?.value || ''),
            location: unescapeIcs(one('LOCATION')?.value || ''),
            notes: unescapeIcs(one('DESCRIPTION')?.value || ''),
            allDay: start.allDay,
            start: start.v,
            end: end ?? start.v,
            ...(rrule ? { rrule } : {}),
            ...(exdates.length ? { exdates } : {}),
          });
        }
        ev = null;
        depth = 0;
      }
      continue;
    }
    if (ev && depth === 0) (ev[prop] ||= []).push({ params, value });
  }
  return out;
}

const icsUtc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDate = (d: string) => d.replace(/-/g, '');

export function toIcs(list: CalEvent[]) {
  const fold = (l: string) => {
    const parts: string[] = [];
    let rest = l;
    while (Buffer.byteLength(rest) > 75) {
      let cut = 74;
      while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
      parts.push(rest.slice(0, cut));
      rest = ' ' + rest.slice(cut);
    }
    parts.push(rest);
    return parts.join('\r\n');
  };
  const t = (v: number | string, allDay: boolean) => (allDay ? `;VALUE=DATE:${icsDate(String(v))}` : `:${icsUtc(Number(v))}`);
  const body = list.flatMap((e) => {
    const rr = e.rrule
      ? [
          'RRULE:' +
            [
              `FREQ=${e.rrule.freq}`,
              e.rrule.interval > 1 ? `INTERVAL=${e.rrule.interval}` : '',
              e.rrule.until ? `UNTIL=${icsUtc(e.rrule.until)}` : '',
              e.rrule.count ? `COUNT=${e.rrule.count}` : '',
              e.rrule.byday?.length ? `BYDAY=${e.rrule.byday.join(',')}` : '',
            ]
              .filter(Boolean)
              .join(';'),
        ]
      : [];
    return [
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icsUtc(e.updated || Date.now())}`,
      `DTSTART${t(e.start, e.allDay)}`,
      `DTEND${t(e.end, e.allDay)}`,
      `SUMMARY:${escapeIcs(e.title)}`,
      ...(e.location ? [`LOCATION:${escapeIcs(e.location)}`] : []),
      ...(e.notes ? [`DESCRIPTION:${escapeIcs(e.notes)}`] : []),
      ...rr,
      ...(e.exdates || []).map((x) => `EXDATE${t(x, e.allDay)}`),
      'END:VEVENT',
    ].map(fold);
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//goodmail//EN', 'CALSCALE:GREGORIAN', ...body, 'END:VCALENDAR', ''].join('\r\n');
}
