// goodmail.conf — maps e-mail domains to IMAP/SMTP servers.
//
//   domain1=example.com
//   imap1=mail.example.com          # host[:port], default 993 (TLS)
//   smtp1=mail.example.com:587      # optional, defaults to the imap host; 465 = TLS, 587 = STARTTLS
//   login1=email                   # optional: "email" (default) or "local" (part before @)
//   insecure1=true                 # optional: accept self-signed certificates
//   ca1=/etc/goodmail/ca.pem       # optional: extra CA bundle to verify the server against
//   ciphers1=HIGH:!DHE             # optional: OpenSSL cipher list (e.g. to skip a weak DH key)
//   sieve1=mail.example.com        # optional: ManageSieve server (host[:port], default 4190) → turns on the "Mail rules" editor
//   passwordcmd1=ssh -i /etc/goodmail/pw-key pw@mail.example.com   # optional: command that sets a new password (see README) → turns on "Change password"
//   title1=Example Mail            # optional: app name shown to these users after sign-in
//   title1.de=Beispiel Mail        # optional: the same name for users whose browser language is de (da, de, sv, nb, fr, es, …)
//
//   domain9=*                      # catch-all for every domain not listed explicitly
//   defaultdomain=example.com     # a login without @ becomes user@defaultdomain — except on a host like
//                                 # goodmail.<one of the domains above>, where that domain is used instead
//
//   resetfrom=goodmail@example.com # optional: sender of "forgot password" mails — together with resetsmtp it turns the feature on
//   resetsmtp=mail.example.com:587 # SMTP server that sends them (465 = TLS, 587 = STARTTLS)
//   resetuser=goodmail@example.com # SMTP login for that sender (default: resetfrom)
//   resetpass=…                    # SMTP password for it (keep the file readable by goodmail only)
//   smime=true                     # optional: S/MIME — sign / encrypt / verify mail (needs the `openssl` command)
//   smimeca=auto                   # who issues certificates: auto = a CA goodmail creates itself, off = users import their own
//   smimecaname=Example Mail CA    # name of that CA   ·   smimedays=730  certificate lifetime   ·   smimetrust=/etc/goodmail/roots.pem extra trusted roots
//   autodiscover=false             # true = guess servers for domains not listed (ISPDB / imap.<domain>)
//   spamthreshold=6                # optional: spam score shown as fully red (default: rspamd 6 / SpamAssassin required=)
//   title=goodmail                 # optional app name (sign-in page, and domains without their own titleN)
//   title.da=goodmail              # optional: per-language variants of title (language codes as in the language picker)
import fs from 'node:fs';
import path from 'node:path';
import { guessSettings } from './autoconfig.ts';

export interface ServerSettings {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  insecureTls: boolean;
  login: 'email' | 'local';
  ca?: string;
  ciphers?: string;
  title?: string;
  titles?: Record<string, string>; // per-language variants of title (titleN.<lang>)
  sieveHost?: string; // ManageSieve server for the rules editor
  sievePort?: number;
  passwordCmd?: string[]; // argv of the command that changes the mailbox password
  passwordMin?: number; // shortest accepted new password
}

interface Config {
  domains: Map<string, ServerSettings>;
  autodiscover: boolean;
  title: string;
  titles: Record<string, string>; // per-language variants of title (title.<lang>)
  defaultDomain: string;
  spamThreshold?: number;
  reset?: ResetSender;
  smime?: SmimeConfig;
}

export interface SmimeConfig {
  ca: 'auto' | 'off';
  caName: string;
  days: number;
  trust?: string; // extra trusted root certificates (PEM file)
}

/** The mailbox that sends "forgot password" mails (nobody is signed in then, so it can't be the user's own). */
export interface ResetSender {
  from: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  insecureTls: boolean;
}

export const CONFIG_PATH = path.resolve(process.env.GOODMAIL_CONFIG || 'goodmail.conf');

function hostPort(v: string, defPort: number): [string, number] {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(v.trim());
  return [m?.[1] || v.trim(), m?.[2] ? Number(m[2]) : defPort];
}

/** All "<prefix>.<lang>=value" entries as { lang: value } (language codes lower-case). */
function localized(kv: Map<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of kv) {
    const m = new RegExp('^' + prefix + '\\.([a-z]{2,3}(?:-[a-z0-9]+)?)$').exec(k);
    if (m && v) out[m[1]] = v;
  }
  return out;
}

/** Split a command line into arguments (quotes group words); it is never run through a shell. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(line)); ) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
  return out;
}

export function parseConfig(text: string): Config {
  const kv = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    kv.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  const domains = new Map<string, ServerSettings>();
  for (const [k, v] of kv) {
    const m = /^domain(\w*)$/.exec(k);
    if (!m) continue;
    const n = m[1];
    const imap = kv.get(`imap${n}`);
    if (!imap) {
      console.warn(`goodmail.conf: domain${n}=${v} has no imap${n}=…, ignored`);
      continue;
    }
    const [imapHost, imapPort] = hostPort(imap, 993);
    const [smtpHost, smtpPort] = hostPort(kv.get(`smtp${n}`) || imapHost, 465);
    const settings: ServerSettings = {
      imapHost,
      imapPort,
      imapSecure: imapPort === 993,
      smtpHost,
      smtpPort,
      smtpSecure: smtpPort === 465,
      insecureTls: kv.get(`insecure${n}`) === 'true',
      login: kv.get(`login${n}`) === 'local' ? 'local' : 'email',
      ca: kv.get(`ca${n}`) ? fs.readFileSync(kv.get(`ca${n}`)!, 'utf8') : undefined,
      ciphers: kv.get(`ciphers${n}`) || undefined,
      title: kv.get(`title${n}`) || undefined,
      titles: localized(kv, `title${n}`),
    };
    const sieve = kv.get(`sieve${n}`);
    if (sieve && sieve !== 'off') [settings.sieveHost, settings.sievePort] = hostPort(sieve, 4190);
    const cmd = kv.get(`passwordcmd${n}`);
    if (cmd) settings.passwordCmd = splitArgs(cmd);
    settings.passwordMin = Number(kv.get(`passwordmin${n}`) || kv.get('passwordmin')) || 10;
    // One entry may list several domains: domain1=example.com, example.de
    for (const d of v.split(/[,\s]+/).filter(Boolean)) domains.set(d.toLowerCase(), settings);
  }
  let reset: ResetSender | undefined;
  const rfrom = kv.get('resetfrom');
  const rsmtp = kv.get('resetsmtp');
  if (rfrom && rsmtp) {
    const [host, port] = hostPort(rsmtp, 587);
    reset = { from: rfrom, host, port, secure: port === 465, user: kv.get('resetuser') || rfrom, pass: kv.get('resetpass') || '', insecureTls: kv.get('resetinsecure') === 'true' };
  }
  const smime: SmimeConfig | undefined =
    kv.get('smime') === 'true'
      ? { ca: kv.get('smimeca') === 'off' ? 'off' : 'auto', caName: kv.get('smimecaname') || `${kv.get('title') || 'goodmail'} CA`, days: Number(kv.get('smimedays')) || 730, trust: kv.get('smimetrust') || undefined }
      : undefined;
  return {
    domains,
    reset,
    smime,
    autodiscover: kv.get('autodiscover') === 'true',
    title: kv.get('title') || 'goodmail',
    titles: localized(kv, 'title'),
    defaultDomain: (kv.get('defaultdomain') || '').toLowerCase(),
    spamThreshold: kv.get('spamthreshold') ? Number(kv.get('spamthreshold')) : undefined,
  };
}

function load(): Config {
  try {
    const c = parseConfig(fs.readFileSync(CONFIG_PATH, 'utf8'));
    console.log(`config: ${c.domains.size} domain(s) from ${CONFIG_PATH}${c.autodiscover ? ', autodiscover on' : ''}`);
    return c;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    console.warn(`config: ${CONFIG_PATH} not found — autodiscovering servers for every domain`);
    return { domains: new Map(), autodiscover: true, title: 'goodmail', titles: {}, defaultDomain: '' };
  }
}

let config = load();
fs.watchFile(CONFIG_PATH, { interval: 5000 }, () => {
  try {
    config = load();
  } catch (err) {
    console.error('config reload failed, keeping previous:', (err as Error).message);
  }
}).unref?.();

export const appTitle = () => config.title;
export const resetSender = () => config.reset;
export const smimeConfig = () => config.smime;
/** Per-language variants of the global title, for the sign-in page. */
export const appTitles = () => config.titles;
/** Score at which the spam bar turns fully red (the filter's junk threshold). Default: rspamd 6, SpamAssassin required=. */
export const spamThreshold = () => config.spamThreshold;

/** App name for a signed-in user: their domain's titleN, else the global title. Config lookup only, no network. */
export function titleFor(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return (config.domains.get(domain) ?? config.domains.get('*'))?.title || config.title;
}

/** Per-language variants that go with titleFor(): the domain's own titleN.<lang> when it has its own title, else the global ones. */
export function titlesFor(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  const entry = config.domains.get(domain) ?? config.domains.get('*');
  return entry?.title ? entry.titles ?? {} : config.titles;
}

/**
 * "bo" → "bo@<domain>". On a host like goodmail.example.com, where example.com is one of the configured
 * domains, that domain wins (so each domain's users can type just their name); otherwise `defaultdomain`.
 */
export function normalizeLogin(input: string, host = '') {
  const v = input.trim().toLowerCase();
  if (v.includes('@')) return v;
  const h = host.toLowerCase().replace(/:\d+$/, '');
  const fromHost = h.includes('.') ? h.split('.').slice(1).join('.') : '';
  const dom = (fromHost && config.domains.has(fromHost) ? fromHost : '') || config.defaultDomain;
  return dom ? `${v}@${dom}` : v;
}

/** Servers for an address, or undefined when this install doesn't serve its domain. */
export async function serversFor(email: string): Promise<ServerSettings | undefined> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return undefined;
  const hit = config.domains.get(domain) ?? config.domains.get('*');
  if (hit) return hit;
  if (!config.autodiscover) return undefined;
  return { ...(await guessSettings(email)), insecureTls: false, login: 'email' };
}
