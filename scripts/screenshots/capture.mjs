// Drive the demo goodmail in headless Chrome and save README screenshots.
import { chromium } from 'playwright-core';

const [, , URL = 'http://localhost:3100', OUT = './shots'] = process.argv;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const now = new Date();
const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
const at = (dayOffset, h, m = 0) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayOffset, h, m);
const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const ev = (uid, title, s, mins, extra = '') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${title}\r\nDTSTART:${f(s)}\r\nDTEND:${f(new Date(s.valueOf() + mins * 60e3))}\r\n${extra}END:VEVENT\r\n`;
const ics =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
  ev('standup', 'Team stand-up', at(0, 9, 30), 15, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\nLOCATION:Video call\r\n') +
  ev('one-on-one', '1:1 with Priya', at(0, 14), 30, 'LOCATION:Room 2A\r\n') +
  ev('focus', 'Focus time', at(2, 10), 120) +
  ev('lunch', 'Lunch with Sam', at(1, 12, 30), 60, 'LOCATION:Ramen on Elm Street\r\n') +
  ev('gym1', 'Gym', at(1, 18), 60, 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH\r\n') +
  ev('design', 'Design review', at(3, 15), 60, 'LOCATION:Room 4B\r\n') +
  ev('roadmap', 'Roadmap sign-off', at(4, 11), 45, 'LOCATION:Video call\r\n') +
  ev('dentist', 'Dentist', at(4, 8), 45) +
  ev('dinner', 'Dinner at Maria’s', at(4, 19, 30), 150) +
  ev('climb', 'Climbing', at(5, 10), 120) +
  `BEGIN:VEVENT\r\nUID:market\r\nSUMMARY:Farmers market\r\nDTSTART;VALUE=DATE:${fd(at(5, 0))}\r\nDTEND;VALUE=DATE:${fd(at(6, 0))}\r\nEND:VEVENT\r\n` +
  'END:VCALENDAR\r\n';
const COLORS = { standup: '#0f6cbd', 'one-on-one': '#8764b8', focus: '#038387', lunch: '#ca5010', gym1: '#498205', design: '#c239b3', roadmap: '#0f6cbd', dentist: '#d13438', dinner: '#ca5010', climb: '#498205', market: '#986f0b' };

const vcf = [
  ['Priya Raman', 'priya.raman@example.org', '+44 20 7946 0123', 'Studio North'],
  ['Jonas Becker', 'jonas@example.de', '+49 30 901820', 'Becker & Partner'],
  ['Maria Santos', 'maria.santos@example.com', '+351 21 000 1234', ''],
  ['Sam Okafor', 'sam.okafor@example.net', '+1 555 0142', 'Harbor Coworking'],
  ['Lena Fischer', 'lena.fischer@example.de', '+49 89 1234567', 'Fischer Workshops'],
  ['Tom Lindqvist', 'tom@example.se', '+46 8 123 456', ''],
  ['Ana Kovač', 'ana.kovac@example.hr', '', 'Kovač Design'],
  ['Ben Carter', 'ben.carter@example.com', '+1 555 0199', ''],
  ['Chloé Martin', 'chloe.martin@example.fr', '+33 1 23 45 67 89', 'Atelier Martin'],
  ['David Kim', 'david.kim@example.com', '', 'Northwind'],
  ['Elena Rossi', 'elena.rossi@example.it', '+39 06 1234 5678', ''],
  ['Felix Wagner', 'felix.wagner@example.at', '', ''],
]
  .map(([n, e, p, o]) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${n}\r\nEMAIL:${e}\r\n${p ? `TEL:${p}\r\n` : ''}${o ? `ORG:${o}\r\n` : ''}${n === 'Priya Raman' ? 'NOTE:Product designer. Prefers mornings for reviews.\r\n' : ''}END:VCARD\r\n`)
  .join('');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function session(opts, prefs) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.evaluate((p) => { for (const [k, v] of Object.entries(p)) localStorage.setItem('gm:' + k, JSON.stringify(v)); }, prefs);
  await page.goto(URL);
  if (await page.locator('input[type=password]').count()) {
    await page.fill('input[autocomplete=username]', 'alex');
    await page.fill('input[type=password]', 'demo');
    await page.click('button.primary');
  }
  await page.waitForSelector('.item', { timeout: 15000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}
const api = (page, method, path, body) =>
  page.evaluate(
    async ([m, p, b]) => (await fetch(p, { method: m, headers: { 'x-goodmail': '1', 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json(),
    [method, path, body],
  );

const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' };
const prefs = { preview: true, pane: 'right', theme: 'light', calView: 'week', folderW: 230, listW: 400 };

// ---- seed + light mail
{
  const { ctx, page } = await session(desk, prefs);
  await api(page, 'POST', '/api/contacts/import', { text: vcf, format: 'vcf' });
  await api(page, 'POST', '/api/events/import', { text: ics, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  for (const e of await api(page, 'GET', '/api/events')) await api(page, 'POST', '/api/events', { ...e, color: COLORS[e.uid] || '' });
  await page.click('text=Design review moved to Thursday');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/mail-light.png` });

  // calendar
  await page.click('button[title=Calendar]');
  await page.waitForSelector('.tg-ev');
  await page.waitForTimeout(600);
  await page.evaluate(() => { const s = document.querySelector('.tg-scroll'); if (s) s.scrollTop = 48 * 7.75; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/calendar.png` });

  // contacts
  await page.click('button[title=Contacts]');
  await page.click('.contact-item >> text=Priya Raman');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/contacts.png` });
  await ctx.close();
}

// ---- dark mail with the newsletter (shows remote-content blocking)
{
  const { ctx, page } = await session({ ...desk, colorScheme: 'dark' }, { ...prefs, theme: 'dark' });
  await page.click('text=Slow mornings, small gardens');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/mail-dark.png` });
  await ctx.close();
}

// ---- phone
{
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light' };
  const { ctx, page } = await session(phone, prefs);
  await page.screenshot({ path: `${OUT}/phone-list.png` });
  await page.click('text=Photos from Saturday');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/phone-message.png` });
  await ctx.close();
}

await browser.close();
console.log('done');
