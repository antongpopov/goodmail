# goodmail

A webmail client that talks plain IMAP + SMTP to **any** mail server, with an Outlook-style
three-pane UI: folder tree, date-grouped message list with previews, reading pane, inline composer.

![goodmail inbox with reading pane](docs/screenshots/mail-light.png?v=20261110)

| Dark mode, remote images blocked | Calendar — week view |
|---|---|
| ![Dark mode with a newsletter; tracking image blocked](docs/screenshots/mail-dark.png?v=20261110) | ![Calendar week view](docs/screenshots/calendar.png?v=20261110) |
| **To-Do** — My Day, Important, Planned, your own lists | **Calendar side panel** — month and upcoming events |
| ![To-Do with a task open](docs/screenshots/tasks.png?v=20261110) | ![Mail with the calendar side panel](docs/screenshots/side-panel.png?v=20261110) |
| **Folders** — ⋯ menu, subfolders, drag and drop | **Mail rules** — run on the server |
| ![Folder menu with new subfolder, rename and delete](docs/screenshots/folders.png?v=20261110) | ![Mail rules list](docs/screenshots/rules.png?v=20261110) |
| **Create a rule from any message** | **Composer** — signature and templates |
| ![Rule editor pre-filled from a message](docs/screenshots/rule-editor.png?v=20261110) | ![Composer with signature and the templates menu](docs/screenshots/compose.png?v=20261110) |
| **S/MIME** — signed and encrypted message | **S/MIME settings** — certificate, CA, correspondents |
| ![An encrypted, signed and verified message](docs/screenshots/smime.png?v=20261110) | ![Secure mail settings](docs/screenshots/smime-settings.png?v=20261110) |
| **Sign-in security** — password, 2-step, passkeys, reset address | **Address book** |
| ![Sign-in security dialog](docs/screenshots/security.png?v=20261110) | ![Address book](docs/screenshots/contacts.png?v=20261110) |
| **Administration** — mailboxes and aliases of a domain | **Domains** — for the main administrator |
| ![Administration: a domain's mailboxes](docs/screenshots/admin.png?v=20261110) | ![Administration: domains and their administrators (main administrator)](docs/screenshots/admin-domains.png?v=20261110) |
| **View headers** — the raw header block | **Settings** — colour, date, time and language |
| ![Raw message headers](docs/screenshots/headers.png?v=20261110) | ![Settings menu with the accent colours and dropdowns for date format, time format and language](docs/screenshots/settings-menu.png?v=20261110) |
| **Filter and sort** — unread, flagged, to me, has files; sort by date, from, subject, size or flag | |
| <img src="docs/screenshots/filter-menu.png?v=20261110" alt="Filter and sort menu" width="45%"> | |
| **On a phone** | **Phone — folder drawer with ⋯ buttons** |
| <img src="docs/screenshots/phone-list.png?v=20261110" alt="Message list on a phone" width="32%"> <img src="docs/screenshots/phone-message.png?v=20261110" alt="Reading a message on a phone" width="32%"> <img src="docs/screenshots/phone-move.png?v=20261110" alt="Moving a message on a phone" width="32%"> | <img src="docs/screenshots/phone-menu.png?v=20261110" alt="Folder drawer on a phone" width="60%"> |

<sub>Screenshots use invented demo data — see [scripts/screenshots](scripts/screenshots).</sub>

More documentation: the [wiki](https://github.com/antongpopov/goodmail/wiki).

- Sign in with just an e-mail address and password — a config file maps the domain to its servers
- "Keep me signed in" for a year (a sealed cookie: no session database, and your mail password is never stored in readable form; per-user
  extras such as contacts, calendar and preferences are small JSON files — see "Data and backups")
- Folder tree with unread counts; drag an account header to put the accounts in the order you like (kept per device). Drag messages onto a folder to move them; drag **folders** onto another folder (or
  onto empty space for the top level) to re-arrange them. ⋯ / right-click on a folder: new subfolder, rename, delete
  (a deleted folder, subfolders included, goes to Trash; one already in Trash is deleted for good and the dialog says
  so). Inbox, Sent, Drafts, Trash, Junk and Archive can't be renamed, moved or deleted
- **Move or copy between mailboxes**: the Move menu lists the folders of all your accounts with a Move / Copy switch; the message is read from one mailbox and added to the other (flags and date kept; a moved original goes to the source Trash)
- Message list grouped Today / Yesterday / This week…, preview lines, unread/flag/attachment markers,
  hover actions, Ctrl/Shift multi-select, infinite scroll, a Filter and sort menu
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
- **Combined mailboxes**: with two or more accounts the folder list starts with **All inboxes** and **All sent** (and, if you
  switch them on, All drafts / junk / trash / archive): one list, newest first, from all your mailboxes. Every row knows its own
  mailbox, so reading, replying (From is the mailbox the message came to), flagging, archiving and deleting act on the right
  one. Unread / Flagged filters and search work across them. ⚙ → Accounts chooses which combined folders show and which
  mailboxes they include (per device). Paging is approximate: each mailbox contributes its newest page, merged by date
- **Address book**: per-account contacts, vCard + CSV import/export (Apple, Google, Outlook, Thunderbird),
  duplicate merge by email, "add sender" button, To/Cc autocomplete
- **To-Do**: an Outlook-style task list: My Day, Important, Planned, Tasks and your own lists, steps, due dates, repeating tasks
  and notes; "Flagged email" jumps to your flagged mail. Stored per account as a small JSON file on the server, so it follows you to every device
- **Filter and sort** menu in the message list (Unread, Flagged, To me, Has files; sort by date, from, subject, size or flag, either direction)
- **Calendar side panel** in the mail view (toggle in the top bar): a month and your upcoming events, like Outlook
- **Calendar**: Outlook-style day / work week / week / month views, mini month, recurring events,
  .ics import/export, and an "Add to calendar" button on invitations (Outlook/Teams time zones understood)
- **Two-step sign-in** (per user, ⚙ → Sign-in security): authenticator app (TOTP), passkeys (Face ID / Touch ID /
  Windows Hello / security keys), a code mailed to a backup address (sent through the user's own mailbox), and
  one-time recovery codes. The login cookie is issued only after the second step. Passkeys can also sign in
  **without a password** (per passkey, on by default): the server then keeps an encrypted copy of the mail password
  for that passkey, refreshed on the next password sign-in after a password change. Passkeys need the site's real
  host name — behind a proxy keep `Host` (`ProxyPreserveHost On`) or set `GOODMAIL_ORIGIN=https://mail.example.com`
- **Signatures and templates** (⚙ → Signatures & templates): one signature per account, added to the end of new mail and
  replies above the quoted text (switching the From account swaps it; you can still edit or delete it in the message). An
  administrator can set a default for a domain with `signatureN=` (see below). **Templates** are ready-made texts with a
  name and an optional subject, inserted from the composer's *Templates* button — or save what you just wrote as one.
  Placeholders: `{name}` and `{firstname}` of the first recipient, `{date}`, `{me}`. Both are stored on the server, so they
  follow the user to every device
- **Mail rules** (⚙ → Mail rules, needs `sieveN=`): "when a message arrives and all/any of these match → move to a folder,
  mark read, flag, forward a copy, delete, stop". Rules are compiled to a Sieve script and stored on the mail server over
  ManageSieve, so they also run while you are signed out. A script written elsewhere is never overwritten without asking.
  Every message has a ⋯ button (and a right-click menu, and a button in the reading pane) with "Create rule from this
  message…": the editor opens with the sender (or, in Sent, the recipient) already filled in
- **Administration** (⚙ → Administration, needs `admincmdN=`): domain administrators create, rename, disable and delete
  mailboxes, reset passwords and manage aliases (including a catch-all) for their own domains only; one main administrator also
  manages the domains and who administers each. A warning marks administrators who have no two-step sign-in. See
  "Administration" below
- **Change password** (⚙ → Sign-in security, needs `passwordcmdN=`): current + new password; the mail server side is a
  command you provide, see "Changing passwords" below
- **Forgot password** (needs `passwordcmdN=` plus `resetfrom=`/`resetsmtp=`): each user saves a **second address**
  outside their own mailbox (⚙ → Sign-in security → Password reset address, confirmed with a code). From the sign-in
  page, "Forgot your password?" mails a one-time code to that address, then the user picks a new password. The page
  answers the same for unknown addresses, codes last 15 minutes with 5 tries, requests are rate-limited, and the mailbox
  itself gets a notice afterwards. Two-step sign-in still applies after a reset
- **S/MIME — sign, encrypt, verify** (needs `smime=true` and the `openssl` command): messages from people who sign
  their mail show "Signed and verified" (or why not); encrypted mail is decrypted for you, signed or not. In the
  composer, **Sign** and **Encrypt** buttons. Each user gets a certificate from goodmail's own little certificate
  authority with one click (or imports a .p12 from a real CA), and can download it as a .p12 for Apple Mail / Outlook /
  Thunderbird. Certificates of correspondents are collected from signed mail, added by hand, or found automatically for
  colleagues on the same install. See "S/MIME" below
- **Spam meter** under the date: green → yellow → red from the filter's score (rspamd or SpamAssassin headers;
  only the topmost header is trusted). Fully red at the junk threshold — rspamd 6 by default, `spamthreshold=` to change
- **View headers**: the `</>` button in the message toolbar shows the raw header block (Received chain, SPF/DKIM/DMARC
  results, spam scores) with a Copy button
- **Fast on slow servers**: opened messages are cached server-side (`GOODMAIL_CACHE_MB`, default 150), folder lists
  show instantly from the last visit and refresh behind, and the next messages are prefetched without marking them read
- **Languages**: English, Dansk, Deutsch, Svenska, Norsk, Français, Español — picked from the browser,
  switchable on the sign-in page and under ⚙. Dates and weekdays follow the language. Adding a language is one
  file in `web/src/locales/` (English text is the key, so anything untranslated falls back to English).
- **Date and time formats** (⚙ → Date format: automatic, `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`; Time format: automatic, 12-hour,
  24-hour): apply to the message list, the calendar and the event editor, whose date and time fields have their own dropdowns
  and understand typing like `9/11/2026`, `2:45 pm`, `1445` or `9.30`. Stored per browser
- Light / dark / auto theme with 8 accent colors (blue, teal, green, purple, pink, red, orange, graphite), reading pane right / below / hidden, works down to phone width

## Run

```bash
npm install
npm run setup      # a short wizard: asks for your domains and servers, checks them, writes goodmail.conf
```

Or do it by hand:

```bash
npm install
cp goodmail.conf.example goodmail.conf   # edit domains
npm run dev        # API on :3000 + Vite on :5173 (needs Node ≥ 23.6, runs the TS server directly)
npm test           # unit tests (vault, 2FA, config, rules, passwords, S/MIME against real openssl, contacts, calendar, tasks, i18n, utils)
                   # + a live-server smoke test; the S/MIME tests skip themselves when openssl with `cms` is missing
npm run typecheck  # tsc over server, web and tests
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
title2.de=Beispiel-Mail          # the same name in German (see "Localized app name" below)

signature2=Best regards\n{name}\nExample Ltd   # default signature for these users (\n = new line; {name}, {email}); a user's own replaces it
sieve2=mail.example.net          # ManageSieve host[:port], default 4190 (STARTTLS) → turns on "Mail rules"
passwordcmd2=ssh -i /etc/goodmail/pw-key pw@mail.example.net   # → turns on "Change password" (see below)
passwordmin2=12                  # shortest accepted new password (default 10; passwordmin= for all domains)
admincmd2=ssh -i /etc/goodmail/admin-key adm@mail.example.net   # → turns on ⚙ → Administration for domain administrators (see "Administration" below)

resetfrom=goodmail@example.net   # "Forgot password": sender of the code mails …
resetsmtp=mail.example.net:587   # … and its SMTP server (resetuser= / resetpass= are its login)

smime=true                       # sign / encrypt / verify (needs openssl); smimeca=auto|off, smimecaname=, smimedays=, smimetrust=

defaultdomain=example.com       # "bo" logs in as bo@example.com
autodiscover=false               # true: guess servers for unlisted domains (autoconfig / ISPDB / MX)
title=goodmail                   # sign-in page, and domains without their own titleN
title.da=Min mail                # optional per-language variants of the global title
title.fr=Ma messagerie
```

The file is re-read automatically when it changes.

### Several domains, one install

One goodmail can serve any number of mail domains. List them all in a `domainN=` line (comma separated) — or one line
per domain when they use different servers — and give each domain a host name of the form **`goodmail.<domain>`**
(or any `<name>.<domain>`):

```ini
domain1=example.com, example.org, example.net
imap1=mail.example.com
smtp1=mail.example.com:587
```

* **Login by host.** On `goodmail.example.org` a login without `@` is completed with *that* domain
  (`bo` → `bo@example.org`); everywhere else `defaultdomain` applies. Full addresses always work, on any host.
* **DNS + web server.** Point `goodmail.<domain>` at the server (A/AAAA, DNS-only if the zone is behind Cloudflare),
  add every host name as a `ServerAlias` of the one virtual host, and put them all on one certificate — see
  [`deploy/apache-multidomain.conf`](deploy/apache-multidomain.conf). Keep `ProxyPreserveHost On`.
* **Passkeys are per host name** (a WebAuthn rule): a passkey made on `goodmail.example.org` does not work on
  `goodmail.example.com`. Don't set `GOODMAIL_ORIGIN` when you serve several hosts — it pins one.
* Titles can differ per domain (`titleN`, `titleN.<lang>`), see below.

**Localized app name.** `title` and `titleN` can be given per language with a `.<code>` suffix, using the codes of
the language picker (`da`, `de`, `en`, `es`, `fr`, `nb`, `sv`). The sign-in page and the browser tab/header show the
variant that matches the visitor's chosen (or browser) language, and fall back to the plain `title` when there is none.
A domain that has its own `titleN` uses only its own `titleN.<code>` lines; domains without one use the global `title.<code>` lines.

**Mail rules** need a ManageSieve service (Dovecot Pigeonhole: `protocols = … sieve`, port 4190, STARTTLS). goodmail
signs in with the user's own mailbox password, keeps its rules in a script called `goodmail` (the editable model is stored
in a comment on the script's first line) and activates it. If the mailbox already has an active script that goodmail did
not write, the editor says so and replaces it only after the user ticks "Replace the existing filter" — a copy is kept as
`goodmail-previous`. Folder names are used exactly as the IMAP server lists them.

**Changing passwords.** Mail servers store passwords in very different places, so goodmail does not guess: it runs the
command from `passwordcmdN` (split into arguments, never through a shell) and writes one JSON line to its stdin:
`{"login":"user@example.com","user":"<imap username>","old":"…","new":"…"}`. Exit status 0 means the password is now
changed; any other status is a failure, and the first line the command printed on stdout (if any) is shown to the user
(`Password is too weak`) — stderr is only logged. The user's current password was already checked against the session,
and the new one is checked for length (`passwordmin`) and control characters. Afterwards goodmail confirms that the new
password opens the mailbox, re-encrypts the user's saved extra accounts and passwordless passkeys under it, and signs the
browser in again; other devices have to sign in again. A typical command is `ssh` to the mail server with a key that is
locked to one forced command, which hashes the password and updates the user database. `ops/goodmail-setpw` is such a
helper for Postfix + Dovecot + PostfixAdmin (BLF-CRYPT into the `mailbox` table): install it as root on the mail server, add
`command="sudo -n /usr/local/sbin/goodmail-setpw",from="<web server IP>",no-pty,no-port-forwarding <public key>` to the
forced-command user's `authorized_keys`, and allow just that script in sudoers.

**Administration.** `admincmdN=` turns on ⚙ → Administration for people who administer mail domains: create, disable,
rename, reset the password of and delete mailboxes, and manage aliases (including a catch-all), only for their own domains.
As with passwords, goodmail does not touch the mail database itself: it runs the command (split into arguments, never through a
shell) and writes one JSON line to its stdin, `{"op":"mailbox.create","caller":"user@example.com",…}`, and the command answers
with one JSON line, `{"ok":true,…}` or `{"error":"text shown to the user"}`. Operations: `whoami`, `domain.get`, `mailbox.create`,
`mailbox.update` (name, active, password, forwards and keep-a-copy), `mailbox.delete`, `alias.save`, `alias.delete`, and for the main administrator
(`superadmin = 1`) `domain.list`, `domain.save`, `domain.delete` (only when empty) and `admins.set` — the Domains tab, where domains and each
domain's administrators are managed. **The command decides who may do
what, on every call** — goodmail only says which mailbox the user signed in with, so a bug in the web interface cannot widen
anyone's rights. `ops/goodmail-admin` does this for Postfix + Dovecot + PostfixAdmin, using PostfixAdmin's own tables: a person
is a domain administrator when there is an active row in `admin` whose username is their *mailbox address*, linked to their
domains in `domain_admins` (`superadmin = 1` or `ALL` = every domain). Changes are written to PostfixAdmin's `log` table, so
both tools stay in step. Safeguards: nobody can disable or delete their own mailbox or a domain's last mailbox, domain limits
are respected, administrators without two-step sign-in are flagged, and nothing is shown to people who are not administrators. When a mailbox is deleted the
administrator can choose to remove its mail files too; they are then moved aside to `/var/vmail/_deleted/` (root-only, so a mistake can be undone) rather than erased,
and otherwise they stay where they are.
Install it like `goodmail-setpw` (root-owned script, a forced-command SSH user with `command="sudo -n
/usr/local/sbin/goodmail-admin",from="<web server IP>",no-pty,no-port-forwarding <public key>`, and one sudoers line); it needs
python3 with `bcrypt` and the `mysql` client as root. Add a person with `INSERT INTO admin (username,password,superadmin,created,
modified,active) VALUES ('person@example.com','*',0,NOW(),NOW(),1)` (the `*` password means no separate PostfixAdmin login) and a
row in `domain_admins` per domain.

**S/MIME.** `smime=true` turns it on. Cryptography is done by the `openssl cms` command (OpenSSL ≥ 1.1.1; macOS's
built-in LibreSSL is not enough — set `GOODMAIL_OPENSSL=/opt/homebrew/bin/openssl`), because that is what real-world S/MIME
needs (RSA PKCS#1 v1.5 key transport, which browsers no longer provide). Private keys never leave the server and are stored
encrypted: a user's key under a key derived from the server key *and* their mail password, the CA key under the server key.
They exist in plain form only in a private temp directory for the length of one openssl call.

* **Certificate authority.** `smimeca=auto` (default) creates a CA (`smimecaname=`, 10 years) on first use under
  `GOODMAIL_DATA/smime/` and issues 2048-bit RSA certificates (`smimedays=`, default 730) with the `emailProtection` usage and the
  address in the certificate. `smimeca=off` means users import certificates they already have. The CA certificate is public at
  `/api/smime/ca.crt` and listed under ⚙ → Secure mail: **people who install it trust your users' signatures**. Back up
  `GOODMAIL_DATA/smime/ca.json` and `secret.key` together; losing either means issuing new certificates.
* **Trust.** A signature is "verified" when it chains to your CA, to `smimetrust=` (a PEM file of extra roots) or to a public
  root (Node's bundled Mozilla list), and the certificate's address matches the From address. Otherwise the message says why
  (untrusted, expired, different address, altered).
* **Encrypting** needs a certificate for every recipient — remembered from signed mail they sent you, added by hand, or a
  colleague on the same install — and your own, so you can read your Sent copy. Sign-then-encrypt is used when both are on.
* **Real certificates.** Under ⚙ → Secure mail, "Get a certificate from a public authority" explains how to get one from a
  public CA and import the .p12 / .pfx. Those are trusted by everyone's mail app without installing your CA. A simple
  start is Actalis' ["Mailbox Validated"](https://www.actalis.com/s-mime-certificates) certificate (free for the first year at the
  time of writing; check their current terms): they email a confirmation link, you generate the certificate in the
  browser, export it from the keychain as a .p12 / .pfx and import it here and in your phone's mail app. Importing replaces a
  certificate that came from goodmail's own CA. Gmail only does S/MIME in Google Workspace; Apple Mail, Outlook and
  Thunderbird do it natively.
* **Checked with** Apple Mail on iPhone (signature shown as verified once the CA is trusted); Outlook and Thunderbird
  interoperability is expected but not yet tested.
* **Not covered (yet):** PGP, certificate revocation checking, S/MIME for the extra accounts a user adds, and signing
  drafts. A webmail can't protect against its own server being compromised: the server holds the keys while you're signed in.

**Forgot password.** Nobody is signed in then, so the code can't go out through the user's own mailbox: `resetfrom=` is
a dedicated sender address, `resetsmtp=host[:port]` its server (465 = TLS, 587 = STARTTLS), with `resetuser=`/`resetpass=`
as its login (`resetinsecure=true` accepts a self-signed certificate). The reset itself runs the same `passwordcmdN`
command as a normal change, with `"reset": true` and an empty `"old"` in the JSON. A reset also leaves the user's saved
extra accounts locked until they enter their previous password once, and passwordless passkeys work again after the next
password sign-in.

| Environment | Default | |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | listen address |
| `GOODMAIL_CONFIG` | `./goodmail.conf` | config file |
| `GOODMAIL_DATA` | `./data` | everything goodmail keeps — see "Data and backups" |
| `GOODMAIL_SECRET` | — | use this instead of `secret.key` |
| `GOODMAIL_SOURCE_URL` | this repo | where the in-app "Source code" link points (AGPL §13 — set it for modified versions) |
| `GOODMAIL_CACHE_MB` | `150` | memory for cached parsed messages |
| `GOODMAIL_TRUST_PROXY` | `false` | trust `X-Forwarded-For` (set behind a proxy) |
| `GOODMAIL_ORIGIN` | from the request | pin the site's origin for passkeys (single host only) |
| `GOODMAIL_OPENSSL` | `openssl` | the openssl command used for S/MIME |

## Data and backups

Everything lives under `GOODMAIL_DATA` (default `./data`), one small JSON file per user and kind, named by a hash of the login:

| Folder / file | What |
|---|---|
| `secret.key` | the server key: seals login cookies and encrypts stored secrets. **Without it nobody can sign in and the files below are unreadable** |
| `accounts/` | extra mail accounts users added (passwords encrypted under the server key *and* the user's own password) |
| `contacts/`, `calendar/`, `tasks/` | address books, calendars and to-do lists |
| `prefs/` | signatures and templates |
| `mfa/` | two-step sign-in: authenticator seeds, passkeys, recovery-code hashes, reset address |
| `smime/` | `ca.json` (the certificate authority; its key is encrypted under the server key), `users/` (certificates, keys encrypted under the user's password), `contacts/` (correspondents' certificates) |

Back up the whole folder, always including `secret.key`. Mail itself stays on your mail server; goodmail keeps none.

## Security model

- The login cookie contains the credentials encrypted with AES-256-GCM under the server key, so sessions
  survive restarts without a database. Deleting `secret.key` signs everyone out.
- Open IMAP connections live in memory per session and are closed after 10 minutes idle.
- Mutating API calls require a custom header (CSRF), cookies are `HttpOnly; SameSite=Strict`.
- Login attempts are rate-limited per IP; so are password-reset requests and every code check.
- Secrets at rest are encrypted: extra-account passwords, S/MIME private keys and passkey sign-in copies are tied to the user's own
  password (or the server key) — the files alone are useless. Decrypted S/MIME mail is never cached.
- The password command, the ManageSieve client and openssl are run with fixed argument lists, never through a shell; user text
  reaching a Sieve script or a certificate request is validated and escaped first.
- A webmail that holds your credentials while you are signed in is a trust decision: run it on a server you control.

## License

Copyright (C) 2026 Anton Popov

goodmail is free software: you can redistribute it and/or modify it under the terms of the
**GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later) — see [LICENSE](LICENSE).

In short: you may use, self-host, modify and share it. If you run a **modified** version for other people
over a network, you must offer those users the source code of your version. goodmail shows a
"Source code" link for this; point it at your fork with `GOODMAIL_SOURCE_URL`.

Third-party dependencies keep their own (permissive: MIT, BSD, ISC, Apache-2.0/MPL-2.0) licenses.
