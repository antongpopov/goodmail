# goodmail

A webmail client that talks plain IMAP + SMTP to **any** mail server, with an Outlook-style
three-pane UI: folder tree, date-grouped message list with previews, reading pane, inline composer.

- Sign in with just an e-mail address and password — a config file maps the domain to its servers
- "Keep me signed in" for a year (sealed cookie; nothing stored server-side but a key)
- Folder tree with unread counts, drag-and-drop to folders, create folders
- Message list grouped Today / Yesterday / This week…, preview lines, unread/flag/attachment markers,
  hover actions, Ctrl/Shift multi-select, infinite scroll, All / Unread / Flagged filters
- Server-side search (subject, from, to, body)
- Reading pane renders HTML mail sanitized (DOMPurify) in a script-less sandboxed iframe with its own CSP;
  **remote images and trackers are blocked** until you allow them once or per sender
- Reply, reply all, forward with quoted original; rich-text composer, attachments (button or drag-drop),
  sent mail saved to Sent; Delete → Trash, Archive, Mark as junk / Not junk (toolbar, hover button, message header or `!`), Move
- Keyboard: `j`/`k` move · `r` reply · `a` reply all · `f` forward · `e` archive · `Del` delete ·
  `u` read/unread · `!` junk / not junk · `n` new · `/` search · `⌘/Ctrl+Enter` send
- **Your own extra accounts**: each user can add iCloud, Gmail, Yahoo, GMX, WEB.DE, Fastmail or any IMAP
  mailbox (app passwords); one folder tree per account and a From picker. Passwords are stored encrypted with a
  key derived from the server key *and* the user's login password. User-entered servers must be public hosts on
  standard mail ports (no access to the server's private network).
- **Address book**: per-account contacts, vCard + CSV import/export (Apple, Google, Outlook, Thunderbird),
  duplicate merge by email, "add sender" button, To/Cc autocomplete
- **Calendar**: Outlook-style day / work week / week / month views, mini month, recurring events,
  .ics import/export, and an "Add to calendar" button on invitations (Outlook/Teams time zones understood)
- Light / dark / auto theme, reading pane right / below / hidden, works down to phone width

## Run

```bash
npm install
cp goodmail.conf.example goodmail.conf   # edit domains
npm run dev        # API on :3000 + Vite on :5173 (needs Node ≥ 23.6, runs the TS server directly)
```

Production:

```bash
npm run build      # dist/ (web) + dist-server/index.mjs (single-file server bundle, Node ≥ 20)
NODE_ENV=production PORT=3000 node dist-server/index.mjs
```

Put it behind a TLS reverse proxy (the login cookie is `Secure` in production).
`deploy/goodmail.service` is an example systemd unit.

## Configuration — `goodmail.conf`

```ini
domain1=example.com
imap1=mail.example.com            # host[:port], default 993 (TLS); 143 = STARTTLS
smtp1=mail.example.com:587        # default: imap host, 465 (TLS); 587 = STARTTLS

domain2=*                        # catch-all for any other domain
imap2=mail.example.net
ca2=/etc/goodmail/ca.pem         # optional extra CA bundle
ciphers2=HIGH:!DHE               # optional OpenSSL cipher list
login2=local                     # send "user" instead of "user@domain" as the IMAP/SMTP username
insecure2=true                   # accept self-signed certificates

defaultdomain=example.com       # "bo" logs in as bo@example.com
autodiscover=false               # true: guess servers for unlisted domains (autoconfig / ISPDB / MX)
title=goodmail
```

The file is re-read automatically when it changes.

| Environment | Default | |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | listen address |
| `GOODMAIL_CONFIG` | `./goodmail.conf` | config file |
| `GOODMAIL_DATA` | `./data` | `secret.key` (cookie encryption key), `accounts/`, `contacts/`, `calendar/` (one JSON file per account) |
| `GOODMAIL_SECRET` | — | use this instead of `secret.key` |
| `GOODMAIL_TRUST_PROXY` | `false` | trust `X-Forwarded-For` (set behind a proxy) |

## Security model

- The login cookie contains the credentials encrypted with AES-256-GCM under the server key, so sessions
  survive restarts without a database. Deleting `secret.key` signs everyone out.
- Open IMAP connections live in memory per session and are closed after 10 minutes idle.
- Mutating API calls require a custom header (CSRF), cookies are `HttpOnly; SameSite=Strict`.
- Login attempts are rate-limited per IP.

## License

MIT
