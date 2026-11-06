// In-memory caches that make slow remote IMAP servers feel fast.
// A message's content never changes for a given UID (RFC 3501), so parsed messages can be kept until
// memory pressure evicts them; the folder's UIDVALIDITY guards against servers renumbering a mailbox.

/** Least-recently-used map bounded by an approximate byte budget. */
export class LRU<V> {
  private map = new Map<string, { v: V; bytes: number }>();
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly maxItemBytes: number;

  constructor(maxBytes: number, maxItemBytes: number) {
    this.maxBytes = maxBytes;
    this.maxItemBytes = maxItemBytes;
  }

  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    this.map.delete(k);
    this.map.set(k, e); // most recently used goes to the end
    return e.v;
  }

  set(k: string, v: V, bytes: number) {
    if (bytes > this.maxItemBytes) return;
    this.delete(k);
    this.map.set(k, { v, bytes });
    this.bytes += bytes;
    for (const [key, e] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.map.delete(key);
      this.bytes -= e.bytes;
    }
  }

  delete(k: string) {
    const e = this.map.get(k);
    if (e) {
      this.map.delete(k);
      this.bytes -= e.bytes;
    }
  }

  deletePrefix(prefix: string) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.delete(k);
  }

  stats() {
    return { entries: this.map.size, mb: Math.round(this.bytes / 1e5) / 10 };
  }
}

const MB = 1024 * 1024;
export const messageCache = new LRU<Record<string, unknown>>(Number(process.env.GOODMAIL_CACHE_MB || 150) * MB, 8 * MB);

export const msgKey = (account: string, folder: string, uid: number) => `${account.toLowerCase()}\u0000${folder}\u0000${uid}`;
const folderPrefix = (account: string, folder: string) => `${account.toLowerCase()}\u0000${folder}\u0000`;

const validity = new Map<string, string>();
/** Call whenever a folder is opened; drops its cached messages if the server renumbered it. */
export function checkValidity(account: string, folder: string, uidValidity: unknown) {
  const k = folderPrefix(account, folder);
  const v = String(uidValidity ?? '');
  const old = validity.get(k);
  if (old !== undefined && old !== v) messageCache.deletePrefix(k);
  validity.set(k, v);
}

export function dropMessages(account: string, folder: string, uids: number[]) {
  for (const u of uids) messageCache.delete(msgKey(account, folder, u));
}

export function patchFlag(account: string, folder: string, uids: number[], flagged: boolean) {
  for (const u of uids) {
    const m = messageCache.get(msgKey(account, folder, u));
    if (m) m.flagged = flagged;
  }
}
