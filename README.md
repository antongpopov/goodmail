# goodmail

A webmail client that talks plain IMAP + SMTP to **any** mail server, with an Outlook-style
three-pane UI: folder tree, date-grouped message list with previews, reading pane, inline composer.

![goodmail inbox with reading pane](docs/screenshots/mail-light.png)

| Dark mode, remote images blocked | Calendar — week view |
|---|---|
| ![Dark mode with a newsletter; tracking image blocked](docs/screenshots/mail-dark.png) | ![Calendar week view](docs/screenshots/calendar.png) |
| **Address book** | **On a phone** |
| ![Address book](docs/screenshots/contacts.png) | <img src="docs/screenshots/phone-list.png" alt="Message list on a phone" width="49%"> <img src="docs/screenshots/phone-message.png" alt="Reading a message on a phone" width="49%"> |

<sub>Screenshots use invented demo data — see [scripts/screenshots](scripts/screenshots).</sub>

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
- **Languages**: English, Dansk, Deutsch, Svenska, Norsk, Français, Español — picked from the browser,
  switchable on the sign-in page and under ⚙. Dates and weekdays follow the language. Adding a language is one
  file in `web/src/locales/` (English text is the key, so anything untranslated falls back to English).
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
title2=Example Mail              # app name these users see after signing in

defaultdomain=example.com       # "bo" logs in as bo@example.com
autodiscover=false               # true: guess servers for unlisted domains (autoconfig / ISPDB / MX)
title=goodmail                   # sign-in page, and domains without their own titleN
```

The file is re-read automatically when it changes.

| Environment | Default | |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | listen address |
| `GOODMAIL_CONFIG` | `./goodmail.conf` | config file |
| `GOODMAIL_DATA` | `./data` | `secret.key` (cookie encryption key), `accounts/`, `contacts/`, `calendar/` (one JSON file per account) |
| `GOODMAIL_SECRET` | — | use this instead of `secret.key` |
| `GOODMAIL_SOURCE_URL` | this repo | where the in-app "Source code" link points (AGPL §13 — set it for modified versions) |
| `GOODMAIL_TRUST_PROXY` | `false` | trust `X-Forwarded-For` (set behind a proxy) |

## Security model

- The login cookie contains the credentials encrypted with AES-256-GCM under the server key, so sessions
  survive restarts without a database. Deleting `secret.key` signs everyone out.
- Open IMAP connections live in memory per session and are closed after 10 minutes idle.
- Mutating API calls require a custom header (CSRF), cookies are `HttpOnly; SameSite=Strict`.
- Login attempts are rate-limited per IP.

## License

Copyright (C) 2026 Anton Popov

goodmail is free software: you can redistribute it and/or modify it under the terms of the
**GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later) — see [LICENSE](LICENSE).

In short: you may use, self-host, modify and share it. If you run a **modified** version for other people
over a network, you must offer those users the source code of your version. goodmail shows a
"Source code" link for this; point it at your fork with `GOODMAIL_SOURCE_URL`.

Third-party dependencies keep their own (permissive: MIT, BSD, ISC, Apache-2.0/MPL-2.0) licenses.
