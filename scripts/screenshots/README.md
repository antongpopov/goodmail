# README screenshots

Regenerates `docs/screenshots/` from a fake IMAP/SMTP/ManageSieve server filled with invented demo mail,
contacts and calendar events (all names and addresses are made up, `example.*` domains). The demo config turns on
rules, signatures, password change / reset, and S/MIME so those screens can be captured too.

```bash
cd scripts/screenshots && npm install
npm run demo &                                   # fake IMAP :1143 + SMTP :1025 + ManageSieve :4190, login alex / demo
(cd ../.. && npm run build && NODE_ENV=production GOODMAIL_INSECURE_COOKIE=true PORT=3100 \
  GOODMAIL_OPENSSL=/opt/homebrew/bin/openssl \
  GOODMAIL_CONFIG=scripts/screenshots/demo.conf GOODMAIL_DATA=$(mktemp -d) node dist-server/index.mjs) &
npm run capture                                  # uses the installed Google Chrome, headless
```

`GOODMAIL_OPENSSL` is needed on macOS (the system openssl is LibreSSL); Linux can omit it. Start from a fresh `GOODMAIL_DATA`
and a fresh `npm run demo` each time — the run creates a certificate and sends a message to itself.
