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

const TRACE = process.env.GOODMAIL_IMAP_TRACE === 'true';
const POOL_MAX = 3; // IMAP connections per mailbox for folder work (Gmail allows 15 per account)
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

  /**
   * Folder work (list a page, open a message) holds the connection's mailbox lock for seconds on a slow server, so with a single
   * connection every click, refresh and prefetch queues behind the previous one (Gmail: select waits of 2-17 s). Hand out an idle
   * connection instead; when all are busy, grow the pool in the background (up to POOL_MAX) and queue on the least busy one.
   */
  private pool: ImapFlow[] = [];
  private growing = 0;
  private busy = new Map<ImapFlow, number>();
  async imapIdle(): Promise<ImapFlow> {
    const first = await this.imap();
    this.pool = this.pool.filter((c) => c.usable);
    const all = [first, ...this.pool];
    const load = (c: ImapFlow) => this.busy.get(c) ?? 0;
    const pick = all.reduce((a, b) => (load(b) < load(a) ? b : a));
    if (load(pick) > 0 && all.length + this.growing < POOL_MAX) {
      this.growing++;
      void connectImap(this.account)
        .then((c) => {
          c.on('error', () => {});
          c.on('close', () => {
            this.pool = this.pool.filter((x) => x !== c);
            this.busy.delete(c);
          });
          this.pool.push(c);
        })
        .catch(() => {})
        .finally(() => this.growing--);
    }
    this.busy.set(pick, load(pick) + 1);
    return pick;
  }
  releaseIdle(c: ImapFlow) {
    const n = (this.busy.get(c) ?? 1) - 1;
    if (n > 0) this.busy.set(c, n);
    else this.busy.delete(c);
  }

  /**
   * A second connection used only for the folder list with its per-folder STATUS counts. On Gmail those STATUS calls on big
   * folders (All Mail, Spam) take seconds each; on the shared connection they made opening any folder wait behind them.
   */
  private listClient: ImapFlow | null = null;
  private listConnecting: Promise<ImapFlow> | null = null;
  async imapList(): Promise<ImapFlow> {
    if (this.listClient?.usable) return this.listClient;
    if (this.listConnecting) return this.listConnecting;
    this.listConnecting = connectImap(this.account)
      .then((c) => {
        this.listClient = c;
        c.on('close', () => {
          if (this.listClient === c) this.listClient = null;
        });
        c.on('error', () => {});
        return c;
      })
      .finally(() => {
        this.listConnecting = null;
      });
    return this.listConnecting;
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
    const l = this.listClient;
    this.listClient = null;
    const extra = this.pool;
    this.pool = [];
    this.busy.clear();
    await Promise.all([c, l, ...extra].map((x) => x && x.logout().catch(() => x.close())));
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
    // goodmail polls, so it never needs IDLE; leaving IDLE (and COMPRESS=DEFLATE) cost Gmail seconds per command.
    disableAutoIdle: true,
    disableCompression: true,
    logger: false,
    emitLogs: TRACE,
  });
  if (TRACE) {
    // GOODMAIL_IMAP_TRACE=true: one line per IMAP command/response with the time since the previous one (never prints credentials)
    let last = Date.now();
    c.on('log', (e: any) => {
      const now = Date.now();
      const line = String(e.src ? `${e.src}` : '') + ' ' + String(e.msg || e.cmd || e.response || '').slice(0, 120);
      if (/AUTHENTICATE|LOGIN|PASS/i.test(line) || e.hidden) return;
      console.log(`imap ${a.imapHost} +${now - last}ms ${e.cid || ''} ${e.src || ''} ${e.msg || ''} ${e.cmd || ''}`.slice(0, 200));
      last = now;
    });
  }
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
