import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

export interface Account {
  email: string;
  name: string;
  user: string;
  pass: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** Accept self-signed / mismatched certificates (common on self-hosted servers). */
  insecureTls: boolean;
  ca?: string;
  ciphers?: string;
}

const IDLE_CLOSE_MS = 10 * 60 * 1000; // drop the IMAP socket after 10 min of no requests
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // force re-login after 12 h of inactivity

/** One mailbox: its settings plus a lazily opened, reused IMAP connection. */
export class Conn {
  account: Account;
  private client: ImapFlow | null = null;
  private connecting: Promise<ImapFlow> | null = null;

  constructor(account: Account) {
    this.account = account;
  }

  async imap(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = connectImap(this.account)
      .then((c) => {
        this.client = c;
        c.on('close', () => {
          if (this.client === c) this.client = null;
        });
        c.on('error', () => {});
        return c;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  smtp() {
    const a = this.account;
    return nodemailer.createTransport({
      host: a.smtpHost,
      port: a.smtpPort,
      secure: a.smtpSecure,
      requireTLS: !a.smtpSecure && a.smtpPort === 587,
      auth: { user: a.user, pass: a.pass },
      tls: { rejectUnauthorized: !a.insecureTls, ca: a.ca, ciphers: a.ciphers },
    });
  }

  async closeImap() {
    const c = this.client;
    this.client = null;
    if (c) await c.logout().catch(() => c.close());
  }
}

/**
 * One logged-in browser, keyed by a hash of its login cookie. The cookie carries the
 * sealed credentials (see vault.ts), so after a restart the session is rebuilt from it.
 * Besides the main mailbox it holds the user's own extra accounts (see accounts.ts).
 */
export class Session extends Conn {
  readonly id: string;
  lastUsed = Date.now();
  /** Key for the user's stored extra-account passwords; derived from their main password, memory only. */
  userKey: Buffer | null = null;
  readonly extra = new Map<string, Conn>();

  constructor(account: Account, id = crypto.randomBytes(32).toString('base64url')) {
    super(account);
    this.id = id;
  }

  touch() {
    this.lastUsed = Date.now();
  }

  override imap() {
    this.touch();
    return super.imap();
  }

  /** "main" (or nothing) = the login mailbox; otherwise an extra account id. */
  acct(id: string | undefined): Conn | undefined {
    return !id || id === 'main' ? this : this.extra.get(id);
  }

  async closeAll() {
    await Promise.all([this.closeImap(), ...[...this.extra.values()].map((c) => c.closeImap())]);
  }
}

export function connectImap(a: Account): Promise<ImapFlow> {
  const c = new ImapFlow({
    host: a.imapHost,
    port: a.imapPort,
    secure: a.imapSecure,
    auth: { user: a.user, pass: a.pass },
    tls: { rejectUnauthorized: !a.insecureTls, ca: a.ca, ciphers: a.ciphers },
    logger: false,
    emitLogs: false,
  });
  return c.connect().then(() => c);
}

const sessions = new Map<string, Session>();

export function addSession(s: Session) {
  sessions.set(s.id, s);
}
export function getSession(id: string | undefined) {
  if (!id) return undefined;
  const s = sessions.get(id);
  if (s) s.touch();
  return s;
}
export async function dropSession(id: string) {
  const s = sessions.get(id);
  sessions.delete(id);
  await s?.closeAll();
}

setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now - s.lastUsed > SESSION_TTL_MS) void dropSession(s.id);
    else if (now - s.lastUsed > IDLE_CLOSE_MS) void s.closeAll();
  }
}, 60_000).unref();
