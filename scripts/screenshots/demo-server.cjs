// Demo IMAP + SMTP server with invented, realistic-looking mail for README screenshots.
const hoodiecrow = require('hoodiecrow-imap');
const { SMTPServer } = require('smtp-server');

const ME = 'Alex Morgan <alex@example.com>';
const now = new Date();
const at = (daysAgo, h, m) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m);
  return d > now ? new Date(now - (daysAgo + 1) * 3600e3) : d;
};
let n = 0;
function mail({ from, subject, when, text, html, seen = true, flagged = false, attach, ics, spam = -0.8 }) {
  n++;
  const flags = [...(seen ? ['\\Seen'] : []), ...(flagged ? ['\\Flagged'] : [])];
  const head = `X-Spamd-Result: default: False [${spam.toFixed(2)} / 15.00];\r\n\tDMARC_POLICY_ALLOW(-0.50)[example.com,none]\r\nFrom: ${from}\r\nTo: ${ME}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nMessage-ID: <demo${n}@example.com>\r\nDate: ${when.toUTCString()}\r\nMIME-Version: 1.0\r\n`;
  const alt = `--alt\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n--alt\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html || text.split('\n\n').map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}\r\n--alt--\r\n`;
  let raw;
  if (attach || ics) {
    raw = head + `Content-Type: multipart/mixed; boundary=mix\r\n\r\n--mix\r\nContent-Type: multipart/alternative; boundary=alt\r\n\r\n${alt}`;
    if (attach) raw += `--mix\r\nContent-Type: application/pdf; name="${attach}"\r\nContent-Disposition: attachment; filename="${attach}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('%PDF-1.4 demo').toString('base64')}\r\n`;
    if (ics) raw += `--mix\r\nContent-Type: text/calendar; charset=utf-8; method=REQUEST; name="invite.ics"\r\nContent-Disposition: attachment; filename="invite.ics"\r\n\r\n${ics}\r\n`;
    raw += '--mix--\r\n';
  } else raw = head + `Content-Type: multipart/alternative; boundary=alt\r\n\r\n${alt}`;
  // hoodiecrow stores chars < 256 as single bytes, so hand it UTF-8 bytes as a binary string
  return { raw: Buffer.from(raw, 'utf8').toString('latin1'), flags, internaldate: when };
}

const newsletter = `<div style="max-width:640px;margin:0 auto;font-family:Georgia,serif;color:#222">
<div style="background:#1f3a5f;color:#fff;padding:28px 32px"><div style="font-size:13px;letter-spacing:2px;opacity:.8">THE WEEKEND READ</div>
<div style="font-size:28px;margin-top:6px">Slow mornings, small gardens</div></div>
<img src="https://tracker.example.net/open.gif?u=alex" width="1" height="1">
<div style="padding:24px 32px;font-size:16px;line-height:1.6"><p>This week: why a balcony herb garden is the best ten-minute habit you will pick up this autumn, three soups that freeze beautifully, and a reader's guide to quiet cafés in Lisbon.</p>
<h3 style="font-family:Arial,sans-serif;color:#1f3a5f">1. The ten-minute garden</h3><p>Basil, thyme and chives forgive almost anything. Start with one pot, a sunny railing and a watering can you can see from the kitchen.</p>
<h3 style="font-family:Arial,sans-serif;color:#1f3a5f">2. Soups for the freezer</h3><p>Roasted tomato, red lentil with lemon, and a green minestrone that tastes better on day three.</p></div></div>`;

const icsNext = (() => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 15, 0);
  const f = (x) => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:demo-design-review@example.com\r\nSUMMARY:Design review\r\nDTSTART:${f(d)}\r\nDTEND:${f(new Date(d.valueOf() + 3600e3))}\r\nLOCATION:Room 4B\r\nEND:VEVENT\r\nEND:VCALENDAR`;
})();

const inbox = [
  mail({ from: 'Priya Raman <priya.raman@example.org>', subject: 'Design review moved to Thursday', when: at(0, 9, 42), seen: false, ics: icsNext,
    text: 'Hi Alex,\n\nQuick heads-up: the design review is moving to Thursday at 15:00 so Jonas can join from Berlin. Invite attached.\n\nI will bring printed versions of the new onboarding screens. If you have notes on the empty states, send them over before Wednesday evening and I will fold them in.\n\nThanks!\nPriya' }),
  mail({ from: 'Jonas Becker <jonas@example.de>', subject: 'Re: Q4 roadmap draft', when: at(0, 8, 15), seen: false, attach: 'Roadmap-Q4-v3.pdf',
    text: 'Alex,\n\nAttached is v3 with your comments merged. I moved the offline mode to January; everything else stays as discussed.\n\nCan we lock this on Friday?\n\nJonas' }),
  mail({ from: 'The Weekend Read <hello@weekendread.example>', subject: 'Slow mornings, small gardens', when: at(0, 7, 3), html: newsletter, spam: 3.9,
    text: 'This week: a balcony herb garden, three soups that freeze beautifully, and quiet cafés in Lisbon.' }),
  mail({ from: 'Maria Santos <maria.santos@example.com>', subject: 'Photos from Saturday 📸', when: at(1, 19, 20), flagged: true,
    text: 'Hey!\n\nFinally sorted the photos from the lake — the shared album link is below. The one of the dog jumping off the pier is my favourite.\n\nDinner at ours next week? Thursday or Friday both work.\n\nM.' }),
  mail({ from: 'Northwind Bank <no-reply@northwind.example>', subject: 'Your November statement is ready', when: at(1, 10, 5), spam: 1.6,
    text: 'Your statement for the period ending 31 October is now available in online banking. This is an automated message.' }),
  mail({ from: 'Sam Okafor <sam.okafor@example.net>', subject: 'Lunch tomorrow?', when: at(1, 9, 31),
    text: 'Free for lunch tomorrow around 12:30? The new ramen place on Elm Street finally opened.' }),
  mail({ from: 'Harbor Coworking <community@harbor.example>', subject: 'November members’ evening', when: at(2, 16, 0),
    text: 'Join us on the 20th for pizza, short talks and the annual "worst desk setup" competition. RSVP by replying to this email.' }),
  mail({ from: 'Lena Fischer <lena.fischer@example.de>', subject: 'Invoice 2026-114', when: at(3, 11, 12), attach: 'Invoice-2026-114.pdf',
    text: 'Hello Alex,\n\nplease find attached the invoice for the October workshop. Payment within 14 days would be great.\n\nBest regards,\nLena' }),
  mail({ from: 'GitHub <noreply@github.example>', subject: '[goodmail] New release v0.4.2', when: at(3, 9, 0),
    text: 'A new release is available. See the changelog for details.' }),
  mail({ from: 'Tom Lindqvist <tom@example.se>', subject: 'Cabin weekend — dates?', when: at(4, 21, 44),
    text: 'We are thinking 6–8 December at the cabin. Sauna works again. Let me know if that clashes with anything.' }),
  mail({ from: 'Airline Desk <bookings@skyway.example>', subject: 'Booking confirmed: LIS → BER', when: at(6, 14, 10), flagged: true,
    text: 'Your booking is confirmed. Departure 12 December, 08:35. Online check-in opens 24 hours before departure.' }),
  mail({ from: 'Priya Raman <priya.raman@example.org>', subject: 'Onboarding screens — first pass', when: at(8, 17, 2),
    text: 'First pass of the onboarding screens is in the shared folder. Rough, but the flow is there.' }),
  mail({ from: 'City Library <library@city.example>', subject: 'Reminder: 2 items due next week', when: at(10, 8, 0),
    text: 'This is a friendly reminder that 2 items are due on the 18th. You can renew them online.' }),
  mail({ from: 'Sam Okafor <sam.okafor@example.net>', subject: 'Running club starts again', when: at(13, 18, 30),
    text: 'Tuesdays 7am by the river, 5k easy pace. Bring a friend.' }),
];

hoodiecrow({
  plugins: ['IDLE', 'SPECIAL-USE', 'UIDPLUS', 'MOVE', 'ENABLE', 'LITERALPLUS'],
  users: { alex: { password: 'demo' } },
  storage: {
    INBOX: { messages: inbox.sort((a, b) => a.internaldate - b.internaldate).map(({ raw, flags }) => ({ raw, flags })) },
    '': {
      separator: '/',
      folders: {
        Drafts: { 'special-use': '\\Drafts', messages: [] },
        Sent: { 'special-use': '\\Sent', messages: [] },
        Archive: { 'special-use': '\\Archive', messages: [] },
        Junk: { 'special-use': '\\Junk', messages: [] },
        Trash: { 'special-use': '\\Trash', messages: [] },
        Projects: { messages: [], folders: { Website: { messages: [] }, Roadmap: { messages: [] } } },
        Travel: { messages: [] },
      },
    },
  },
}).listen(1143, () => console.log('demo imap 1143'));

new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onAuth: (a, s, cb) => cb(null, { user: a.username }), onData: (st, s, cb) => st.on('data', () => {}).on('end', cb) })
  .listen(1025, () => console.log('demo smtp 1025'));
