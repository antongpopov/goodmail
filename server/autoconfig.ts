// Guess IMAP/SMTP settings for an unlisted domain: autoconfig.<domain> → Thunderbird ISPDB → MX → imap./smtp.<domain>.
import dns from 'node:dns/promises';

export interface GuessedSettings {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

function pick(xml: string, type: 'incomingServer' | 'outgoingServer', proto: string) {
  const re = new RegExp(`<${type}[^>]*type="${proto}"[^>]*>([\\s\\S]*?)</${type}>`, 'gi');
  for (const m of xml.matchAll(re)) {
    const body = m[1];
    const host = /<hostname>([^<]+)<\/hostname>/i.exec(body)?.[1]?.trim();
    const port = Number(/<port>(\d+)<\/port>/i.exec(body)?.[1]);
    const sock = /<socketType>([^<]+)<\/socketType>/i.exec(body)?.[1]?.trim().toUpperCase();
    if (host && port && sock !== 'PLAIN') return { host, port, secure: sock === 'SSL' };
  }
  return undefined;
}

async function ispdb(domain: string, email: string): Promise<GuessedSettings | undefined> {
  const urls = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://autoconfig.thunderbird.net/v1.1/${domain}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const xml = await r.text();
      const i = pick(xml, 'incomingServer', 'imap');
      const o = pick(xml, 'outgoingServer', 'smtp');
      if (i && o) {
        const sub = (h: string) => h.replace('%EMAILDOMAIN%', domain);
        return {
          imapHost: sub(i.host), imapPort: i.port, imapSecure: i.secure,
          smtpHost: sub(o.host), smtpPort: o.port, smtpSecure: o.secure,
        };
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export async function guessSettings(email: string): Promise<GuessedSettings> {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  const found = domain ? await ispdb(domain, email) : undefined;
  if (found) return found;
  // Fall back to the MX host's domain (catches Google Workspace / M365 custom domains via ISPDB).
  try {
    const mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority)[0]?.exchange;
    const mxDomain = mx?.split('.').slice(-2).join('.');
    if (mxDomain && mxDomain !== domain) {
      const viaMx = await ispdb(mxDomain, email);
      if (viaMx) return viaMx;
    }
  } catch {
    /* no MX */
  }
  return {
    imapHost: `imap.${domain}`, imapPort: 993, imapSecure: true,
    smtpHost: `smtp.${domain}`, smtpPort: 465, smtpSecure: true,
  };
}
