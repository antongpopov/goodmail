import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate } from './helpers.ts';

isolate();
const cal = await import('../server/calendar.ts');

test('normalizeEvent: timed event gets a default 1 h length and an id/uid', () => {
  const e = cal.normalizeEvent({ title: ' Meeting ', start: 1_700_000_000_000 });
  assert.equal(e.title, 'Meeting');
  assert.equal(e.allDay, false);
  assert.equal(e.end, 1_700_000_000_000 + 3_600_000);
  assert.ok(e.id && e.uid.endsWith('@goodmail'));
});

test('normalizeEvent: all-day end defaults to the next day, bad end is repaired', () => {
  const e = cal.normalizeEvent({ title: 'Holiday', allDay: true, start: '2026-12-24', end: '2026-12-20' });
  assert.equal(e.end, '2026-12-25');
});

test('normalizeEvent rejects a missing or invalid start', () => {
  assert.throws(() => cal.normalizeEvent({ title: 'x' }), /valid start/);
  assert.throws(() => cal.normalizeEvent({ title: 'x', allDay: true, start: 'tomorrow' }), /valid start/);
});

test('normalizeEvent sanitises recurrence and colour', () => {
  const e = cal.normalizeEvent({
    title: 'Standup', start: 1_700_000_000_000, color: 'red',
    rrule: { freq: 'WEEKLY', interval: 0, count: 99999, byday: ['MO', 'XX', 'FR'] } as any,
  });
  assert.equal(e.color, '');
  assert.equal(e.rrule?.interval, 1);
  assert.equal(e.rrule?.count, 5000);
  assert.deepEqual(e.rrule?.byday, ['MO', 'FR']);
  assert.equal(cal.normalizeEvent({ title: 'x', start: 1, rrule: { freq: 'HOURLY' } as any }).rrule, undefined);
});

test('ICS export → import round-trips timed, all-day and recurring events', () => {
  const list = [
    cal.normalizeEvent({ title: 'Lunch, with Åsa', start: Date.UTC(2026, 10, 9, 11, 0), end: Date.UTC(2026, 10, 9, 12, 30), location: 'Café; Main St', notes: 'Bring\nnotes' }),
    cal.normalizeEvent({ title: 'Holiday', allDay: true, start: '2026-12-24', end: '2026-12-27' }),
    cal.normalizeEvent({ title: 'Weekly', start: Date.UTC(2026, 10, 10, 8, 0), rrule: { freq: 'WEEKLY', interval: 2, count: 5, byday: ['TU'] } }),
  ];
  const back = cal.parseIcs(cal.toIcs(list), 'UTC');
  assert.equal(back.length, 3);
  const lunch = back.find((e) => e.title === 'Lunch, with Åsa')!;
  assert.equal(lunch.start, Date.UTC(2026, 10, 9, 11, 0));
  assert.equal(lunch.end, Date.UTC(2026, 10, 9, 12, 30));
  assert.equal(lunch.location, 'Café; Main St');
  assert.equal(lunch.notes, 'Bring\nnotes');
  const hol = back.find((e) => e.title === 'Holiday')!;
  assert.equal(hol.allDay, true);
  assert.equal(hol.start, '2026-12-24');
  assert.equal(hol.end, '2026-12-27');
  const weekly = back.find((e) => e.title === 'Weekly')!;
  assert.equal(weekly.rrule?.freq, 'WEEKLY');
  assert.equal(weekly.rrule?.interval, 2);
  assert.equal(weekly.rrule?.count, 5);
});

test('parseIcs tolerates junk', () => {
  assert.deepEqual(cal.parseIcs('', 'UTC'), []);
  assert.doesNotThrow(() => cal.parseIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:no dates\nEND:VEVENT\nEND:VCALENDAR', 'UTC'));
});
