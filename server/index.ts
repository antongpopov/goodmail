import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { PORT, requireCsrfHeader } from './http.ts';
import routesAuth from './routes/auth.ts';
import routesTwofactor from './routes/twofactor.ts';
import routesMail from './routes/mail.ts';
import routesAccounts from './routes/accounts.ts';
import routesContacts from './routes/contacts.ts';
import routesCalendar from './routes/calendar.ts';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.GOODMAIL_TRUST_PROXY === 'true');
app.use(express.json({ limit: '40mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; frame-src 'self' blob: about:; connect-src 'self'; object-src 'none'; base-uri 'self'",
  );
  next();
});
app.use('/api', requireCsrfHeader);

app.use(routesAuth);
app.use(routesTwofactor);
app.use(routesMail);
app.use(routesAccounts);
app.use(routesContacts);
app.use(routesCalendar);

// ---------- static SPA ----------

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  // The app has a single page; send any other unknown path home instead of echoing index.html.
  app.use((req, res) => (req.path.startsWith('/api/') ? res.status(404).json({ error: 'not found' }) : res.redirect(302, '/')));
}

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`goodmail listening on http://${HOST}:${PORT}`));

