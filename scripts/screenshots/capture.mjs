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
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.evaluate((p) => { for (const [k, v] of Object.entries(p)) localStorage.setItem('gm:' + k, JSON.stringify(v)); }, prefs);
  await page.goto(URL);
  await page.waitForSelector('input[type=password], .item', { timeout: 15000 }); // the form may render a moment after load
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

  // filter and sort menu, calendar side panel
  await page.click('button[aria-label="Filter and sort"]');
  await page.waitForSelector('.filter-menu');
  await page.waitForTimeout(300);
  await page.locator('.filter-menu').screenshot({ path: `${OUT}/filter-menu.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 880);
  await page.click('button[aria-label="Calendar panel"]');
  await page.waitForSelector('.side-ev');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/side-panel.png` });
  await page.click('button[aria-label="Calendar panel"]');

  // to-do
  const today = new Date().toISOString().slice(0, 10);
  const list = await api(page, 'POST', '/api/tasks/lists', { name: 'Work' });
  const task = (title, extra = {}) => api(page, 'POST', '/api/tasks', { today, task: { title, ...extra } });
  await task('Send the Q4 figures to Priya', { myDay: today, important: true, due: today, steps: [{ text: 'Check the margin table', done: true }, { text: 'Export as PDF', done: false }] });
  await task('Book the dentist', { myDay: today });
  await task('Renew the domain', { list: list.id, due: today, repeat: 'YEARLY', important: true });
  await task('Plan the offsite', { list: list.id, notes: 'Ideas: lake house, two nights, 12 people.' });
  const done = await task('Reply to Jonas', { myDay: today });
  await api(page, 'POST', '/api/tasks', { today, task: { ...done.task, done: true, doneAt: Date.now() } });
  await page.click('button[title="To-Do"]');
  await page.waitForSelector('.task');
  await page.locator('.task-body', { hasText: 'Send the Q4 figures' }).click();
  await page.waitForSelector('.task-detail');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/tasks.png` });

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
  await page.locator('.msg-actions button[aria-label="More"]').click();
  await page.screenshot({ path: `${OUT}/phone-more.png` });
  await page.locator('.more-menu button:has-text("Move")').click();
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/phone-move.png` });
  await ctx.close();
}

// ---- feature shots: folders, rules, composer + templates, S/MIME, security
{
  const { ctx, page } = await session(desk, prefs);
  const menuItem = async (label) => {
    await page.click('button[title="View settings"]');
    await page.click(`.view-menu >> text=${label}`);
    await page.waitForTimeout(900);
  };

  // folder menu (⋯) on a folder with subfolders
  await page.locator('.folders .folder', { hasText: 'Projects' }).first().hover();
  await page.locator('.folders .folder', { hasText: 'Projects' }).first().locator('.fmenu-btn').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/folders.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 880);

  // mail rules
  const rule = (name, conditions, actions, match = 'all') => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, enabled: true, match, conditions, actions });
  await api(page, 'PUT', '/api/rules', {
    rules: [
      rule('Newsletters', [{ field: 'from', op: 'contains', value: 'weekendread.example' }], [{ type: 'move', value: 'Archive' }, { type: 'read' }]),
      rule('Invoices from Lena', [{ field: 'from', op: 'is', value: 'lena.fischer@example.de' }, { field: 'subject', op: 'contains', value: 'Invoice' }], [{ type: 'flag' }, { type: 'move', value: 'Projects' }]),
      rule('Travel bookings', [{ field: 'subject', op: 'contains', value: 'Booking' }, { field: 'from', op: 'contains', value: 'skyway.example' }], [{ type: 'move', value: 'Travel' }], 'any'),
    ],
  });
  await menuItem('Mail rules');
  await page.screenshot({ path: `${OUT}/rules.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // "create rule from this message" (right-click)
  await page.click('text=Invoice 2026-114', { button: 'right' });
  await page.click('.msg-menu >> text=Create rule from this message');
  await page.waitForSelector('.rule-form');
  await page.locator('.rule-row select.grow').selectOption({ label: 'Projects' }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/rule-editor.png` });
  await page.keyboard.press('Escape'); // closes the whole dialog (asks first about unsaved changes; the dialog handler accepts)
  await page.waitForTimeout(300);

  // composer with the signature and the templates menu
  for (const [name, subject, html] of [
    ['Opening hours', 'Our opening hours', '<p>Hello {firstname},</p><p>we are open Monday to Friday, 9:00–17:00. You are welcome to drop by.</p>'],
    ['Meeting follow-up', '', '<p>Hi {firstname},</p><p>thanks for the conversation today ({date}). As agreed, I will send the draft by Friday.</p>'],
    ['Out of office', 'Out of office', '<p>Thank you for your message. I am away until the 20th and will reply when I am back.</p>'],
  ])
    await api(page, 'POST', '/api/prefs/templates', { name, subject, html });
  await page.reload();
  await page.waitForSelector('.item');
  await api(page, 'POST', '/api/smime/enable', {});
  await page.reload();
  await page.waitForSelector('.item');
  await page.click('.toolbar .tb.new');
  await page.waitForSelector('.editor');
  await page.fill('#gm-to', 'Priya Raman <priya.raman@example.org>');
  await page.locator('.compose-bar .tb.toggle', { hasText: 'Sign' }).click();
  await page.locator('.compose-bar .tb', { hasText: 'Templates' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/compose.png` });
  await page.locator('.tpl-menu .menu-btn', { hasText: 'Meeting follow-up' }).click();
  await page.waitForTimeout(300);
  await page.locator('.compose-bar .icon[title^="Discard"]').click();
  await page.waitForTimeout(300);

  // S/MIME: make a certificate, send ourselves a signed + encrypted message, open it
  await api(page, 'POST', '/api/send', {
    to: 'alex@example.com',
    subject: 'Q4 figures — confidential',
    text: 'Hi Alex,\n\nthe Q4 numbers are attached in the table below. Please keep this between us until the board meeting.\n\nBest,\nAlex',
    html: '<p>Hi Alex,</p><p>the Q4 numbers are attached in the table below. Please keep this between us until the board meeting.</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><td>Revenue</td><td>€ 1.82 M</td></tr><tr><td>Margin</td><td>23 %</td></tr></table><p>Best,<br>Alex</p>',
    sign: true,
    encrypt: true,
  });
  await page.reload();
  await page.waitForSelector('.item');
  await page.locator('.folders .folder', { hasText: 'Sent' }).first().click();
  await page.click('text=Q4 figures');
  await page.waitForSelector('.smime-badge');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/smime.png` });
  await menuItem('Secure mail');
  await page.screenshot({ path: `${OUT}/smime-settings.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // view headers + settings menu + administration
  await page.locator('.folders .folder', { hasText: 'Inbox' }).first().click();
  await page.click('text=Design review moved to Thursday');
  await page.waitForTimeout(1000);
  await page.locator('.top-acts button[title="View headers"]').click();
  await page.waitForSelector('.headers-text');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/headers.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.click('button[title="View settings"]');
  await page.waitForTimeout(300);
  await page.locator('.view-menu').screenshot({ path: `${OUT}/settings-menu.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 880);

  // select all (toolbar tickbox) and the admin-only Debug window
  await page.locator('.selbox').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/select-all.png` });
  await page.locator('.selbox').first().click();
  await page.click('button[aria-label="Debug"]');
  await page.click('text=Inbox');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/debug.png` });
  await page.click('button[aria-label="Close debug window"]');

  await menuItem('Administration');
  await page.waitForSelector('.admin-item');
  await page.screenshot({ path: `${OUT}/admin.png` });
  await page.locator('.admin-dialog .segment button', { hasText: 'Domains' }).click();
  await page.waitForSelector('.admin-item');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/admin-domains.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // sign-in security (2-step, passkeys, password, reset address)
  await menuItem('Sign-in security');
  await page.screenshot({ path: `${OUT}/security.png` });
  await ctx.close();
}

// ---- phone: the folder drawer with the ⋯ buttons
{
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light' };
  const { ctx, page } = await session(phone, prefs);
  await page.click('.top-btn.phone-only');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/phone-menu.png` });
  await ctx.close();
}

await browser.close();
console.log('done');
