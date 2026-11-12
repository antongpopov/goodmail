import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { PORT, requireCsrfHeader } from './http.ts';
import { debugLog, debugOn } from './debug.ts';
import routesAuth from './routes/auth.ts';
import routesTwofactor from './routes/twofactor.ts';
import routesMail from './routes/mail.ts';
import routesAccounts from './routes/accounts.ts';
import routesContacts from './routes/contacts.ts';
import routesCalendar from './routes/calendar.ts';
import routesTasks from './routes/tasks.ts';
import routesSettings from './routes/settings.ts';
import routesReset from './routes/reset.ts';
import routesAdmin from './routes/admin.ts';
import routesSmime from './routes/smime.ts';
import routesPrefs from './routes/prefs.ts';

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
// Debug window: one event per API call with how long it took (never the search text, never a body)
app.use('/api', (req, res, next) => {
  if (!debugOn() || req.path === '/debug') return next();
  const t0 = Date.now();
  const path = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    const q = req.query;
    const bits = ['folder', 'page', 'filter'].filter((k) => q[k] !== undefined && q[k] !== '').map((k) => `${k}=${String(q[k]).slice(0, 40)}`).join(' ');
    debugLog({ src: 'http', account: String(q.account || ''), sid: (req as any).session?.id || '', text: `${req.method} ${path}${bits ? ' ' + bits : ''} → ${res.statusCode}`, ms: Date.now() - t0, level: res.statusCode >= 400 ? 'error' : Date.now() - t0 >= 2000 ? 'slow' : undefined });
  });
  next();
});

app.use(routesAuth);
app.use(routesTwofactor);
app.use(routesMail);
app.use(routesAccounts);
app.use(routesContacts);
app.use(routesCalendar);
app.use(routesTasks);
app.use(routesSettings);
app.use(routesReset);
app.use(routesAdmin);
app.use(routesSmime);
app.use(routesPrefs);

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

