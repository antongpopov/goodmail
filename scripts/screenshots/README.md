# README screenshots

Regenerates `docs/screenshots/` from a fake IMAP/SMTP server filled with invented demo mail,
contacts and calendar events (all names and addresses are made up, `example.*` domains).

```bash
cd scripts/screenshots && npm install
npm run demo &                                   # fake IMAP :1143 + SMTP :1025, login alex / demo
(cd ../.. && npm run build && NODE_ENV=production GOODMAIL_INSECURE_COOKIE=true PORT=3100 \
  GOODMAIL_CONFIG=scripts/screenshots/demo.conf GOODMAIL_DATA=$(mktemp -d) node dist-server/index.mjs) &
npm run capture                                  # uses the installed Google Chrome, headless
```
