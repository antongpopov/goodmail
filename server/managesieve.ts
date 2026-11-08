// A small ManageSieve (RFC 5804) client: just enough to read, check, store and activate one script.
// Talks plain TCP, upgrades with STARTTLS (or starts TLS right away on port 4191-style servers via `secure`).
import net from 'node:net';
import tls from 'node:tls';

export interface SieveOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean;
  insecureTls?: boolean;
  ca?: string;
  timeoutMs?: number;
}

type Item = string | { literal: string };
interface Reply {
  status: 'OK' | 'NO' | 'BYE';
  /** The text after the status word (quoted string unwrapped). */
  text: string;
  /** Data lines before the status line, each as a list of strings. */
  lines: string[][];
}

const q = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`;

export class ManageSieve {
  private sock!: net.Socket | tls.TLSSocket;
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private err: Error | null = null;
  private o: SieveOptions;
  constructor(o: SieveOptions) {
    this.o = o;
  }

  // ----- transport -----
  private attach(s: net.Socket | tls.TLSSocket) {
    this.sock = s;
    s.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.wake();
    });
    const fail = (e: Error) => {
      this.err = this.err || e;
      this.wake();
    };
    s.on('error', fail);
    s.on('close', () => fail(new Error('connection closed')));
    s.setTimeout(this.o.timeoutMs ?? 15000, () => fail(new Error('timed out')));
  }
  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }
  private async need<T>(take: () => T | undefined): Promise<T> {
    for (;;) {
      const v = take();
      if (v !== undefined) return v;
      if (this.err) throw this.err;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  /** One reply: data lines, then OK/NO/BYE. Literals ({n}\r\n<n bytes>) are folded into the line's items. */
  private async reply(): Promise<Reply> {
    const lines: string[][] = [];
    for (;;) {
      const r = await this.need(() => this.parseLine());
      if (r.kind === 'status') return { status: r.status, text: r.text, lines };
      lines.push(r.items);
    }
  }

  private parseLine():
    | { kind: 'status'; status: 'OK' | 'NO' | 'BYE'; text: string }
    | { kind: 'data'; items: string[] }
    | undefined {
    const b = this.buf;
    let i = 0;
    const items: Item[] = [];
    const raw: string[] = [];
    for (;;) {
      while (b[i] === 0x20) i++;
      if (i >= b.length) return undefined;
      if (b[i] === 0x0d) {
        if (i + 1 >= b.length) return undefined;
        i += 2; // CRLF ends the line
        break;
      }
      if (b[i] === 0x22) {
        // quoted string
        let j = i + 1;
        let out = '';
        for (; j < b.length && b[j] !== 0x22; j++) {
          if (b[j] === 0x5c) j++;
          if (j < b.length) out += String.fromCharCode(b[j]);
        }
        if (j >= b.length) return undefined;
        items.push(Buffer.from(out, 'latin1').toString('utf8'));
        i = j + 1;
      } else if (b[i] === 0x7b) {
        // literal {n} or {n+}
        const end = b.indexOf(0x0a, i);
        if (end < 0) return undefined;
        const n = parseInt(b.toString('latin1', i + 1, end), 10);
        if (!Number.isFinite(n)) throw new Error('bad literal');
        if (b.length < end + 1 + n) return undefined;
        items.push(b.toString('utf8', end + 1, end + 1 + n));
        i = end + 1 + n;
      } else {
        let j = i;
        while (j < b.length && b[j] !== 0x20 && b[j] !== 0x0d) j++;
        if (j >= b.length) return undefined;
        items.push(b.toString('latin1', i, j));
        i = j;
      }
      raw.push(String(items[items.length - 1]));
    }
    this.buf = b.subarray(i);
    const first = String(items[0] ?? '').toUpperCase();
    if (first === 'OK' || first === 'NO' || first === 'BYE') {
      // "NO (QUOTA) "text"" — keep the last string as the human text
      const rest = raw.slice(1).filter((s) => !/^\(.*\)$/.test(s));
      return { kind: 'status', status: first, text: rest[rest.length - 1] || '' };
    }
    return { kind: 'data', items: raw };
  }

  private send(cmd: string) {
    this.sock.write(cmd + '\r\n');
  }
  private async ok(cmd: string, what: string): Promise<Reply> {
    this.send(cmd);
    const r = await this.reply();
    if (r.status !== 'OK') throw Object.assign(new Error(r.text || `${what} failed`), { sieve: what });
    return r;
  }

  // ----- session -----
  async connect() {
    const { host, port } = this.o;
    const opts = { host, port, rejectUnauthorized: !this.o.insecureTls, ca: this.o.ca, servername: net.isIP(host) ? undefined : host };
    await new Promise<void>((resolve, reject) => {
      const s: net.Socket = this.o.secure ? tls.connect(opts, () => resolve()) : net.connect({ host, port }, () => resolve());
      this.attach(s);
      s.once('error', reject);
    });
    const greet = await this.reply();
    if (greet.status !== 'OK') throw new Error('ManageSieve server refused the connection');
    if (!this.o.secure) {
      if (!greet.lines.some((l) => l[0]?.toUpperCase() === 'STARTTLS')) throw new Error('ManageSieve server does not offer STARTTLS');
      this.send('STARTTLS');
      const r = await this.reply();
      if (r.status !== 'OK') throw new Error('STARTTLS refused');
      const old = this.sock as net.Socket;
      old.removeAllListeners('data');
      old.removeAllListeners('close');
      old.removeAllListeners('error');
      this.buf = Buffer.alloc(0);
      const t = tls.connect({ socket: old, ...opts });
      await new Promise<void>((res, rej) => {
        t.once('secureConnect', () => res());
        t.once('error', rej);
      });
      this.attach(t);
      const again = await this.reply(); // capabilities are announced again after TLS
      if (again.status !== 'OK') throw new Error('ManageSieve handshake failed');
    }
    const token = Buffer.from(`\0${this.o.user}\0${this.o.pass}`).toString('base64');
    this.send(`AUTHENTICATE "PLAIN" ${q(token)}`);
    const a = await this.reply();
    if (a.status !== 'OK') throw Object.assign(new Error('The mail server did not accept the sign-in for the rules service'), { auth: true });
  }

  /** Script names with the active one flagged. */
  async list(): Promise<{ name: string; active: boolean }[]> {
    const r = await this.ok('LISTSCRIPTS', 'LISTSCRIPTS');
    return r.lines.map((l) => ({ name: l[0], active: l.slice(1).some((x) => x.toUpperCase() === 'ACTIVE') }));
  }
  async get(name: string): Promise<string | undefined> {
    this.send(`GETSCRIPT ${q(name)}`);
    const r = await this.reply();
    if (r.status !== 'OK') return undefined;
    return r.lines[0]?.[0] ?? '';
  }
  async check(script: string) {
    await this.ok(`CHECKSCRIPT {${Buffer.byteLength(script)}+}\r\n${script}`, 'CHECKSCRIPT');
  }
  async put(name: string, script: string) {
    await this.ok(`PUTSCRIPT ${q(name)} {${Buffer.byteLength(script)}+}\r\n${script}`, 'PUTSCRIPT');
  }
  async activate(name: string) {
    await this.ok(`SETACTIVE ${q(name)}`, 'SETACTIVE');
  }
  async close() {
    try {
      this.sock.write('LOGOUT\r\n');
    } catch {
      /* gone already */
    }
    this.sock?.destroy();
  }
}

/** Open a session, run `fn`, always close it. */
export async function withSieve<T>(o: SieveOptions, fn: (s: ManageSieve) => Promise<T>): Promise<T> {
  const s = new ManageSieve(o);
  try {
    await s.connect();
    return await fn(s);
  } finally {
    await s.close();
  }
}
