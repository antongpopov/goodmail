// goodmail.conf — maps e-mail domains to IMAP/SMTP servers.
//
//   domain1=example.com
//   imap1=mail.example.com          # host[:port], default 993 (TLS)
//   smtp1=mail.example.com:587      # optional, defaults to the imap host; 465 = TLS, 587 = STARTTLS
//   login1=email                   # optional: "email" (default) or "local" (part before @)
//   insecure1=true                 # optional: accept self-signed certificates
//   ca1=/etc/goodmail/ca.pem       # optional: extra CA bundle to verify the server against
//   ciphers1=HIGH:!DHE             # optional: OpenSSL cipher list (e.g. to skip a weak DH key)
//   title1=Example Mail            # optional: app name shown to these users after sign-in
//
//   domain9=*                      # catch-all for every domain not listed explicitly
//   defaultdomain=example.com     # a login without @ becomes user@defaultdomain
//
//   autodiscover=false             # true = guess servers for domains not listed (ISPDB / imap.<domain>)
//   title=goodmail                 # optional app name (sign-in page, and domains without their own titleN)
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
}

interface Config {
  domains: Map<string, ServerSettings>;
  autodiscover: boolean;
  title: string;
  defaultDomain: string;
}

export const CONFIG_PATH = path.resolve(process.env.GOODMAIL_CONFIG || 'goodmail.conf');

function hostPort(v: string, defPort: number): [string, number] {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(v.trim());
  return [m?.[1] || v.trim(), m?.[2] ? Number(m[2]) : defPort];
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
    };
    // One entry may list several domains: domain1=example.com, example.de
    for (const d of v.split(/[,\s]+/).filter(Boolean)) domains.set(d.toLowerCase(), settings);
  }
  return {
    domains,
    autodiscover: kv.get('autodiscover') === 'true',
    title: kv.get('title') || 'goodmail',
    defaultDomain: (kv.get('defaultdomain') || '').toLowerCase(),
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
    return { domains: new Map(), autodiscover: true, title: 'goodmail', defaultDomain: '' };
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

/** App name for a signed-in user: their domain's titleN, else the global title. Config lookup only, no network. */
export function titleFor(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return (config.domains.get(domain) ?? config.domains.get('*'))?.title || config.title;
}

/** "bo" → "bo@<defaultdomain>" when a default domain is configured. */
export function normalizeLogin(input: string) {
  const v = input.trim().toLowerCase();
  return !v.includes('@') && config.defaultDomain ? `${v}@${config.defaultDomain}` : v;
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
