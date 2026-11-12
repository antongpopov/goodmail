// Optional debug window (goodmail.conf: debug=true, or GOODMAIL_DEBUG=true): keeps the last events of what the server does for
// each signed-in user in memory — HTTP calls, IMAP commands with their timing, folder opens — and the UI shows them in a panel.
// Nothing is written to disk. Credentials are never logged (LOGIN/AUTHENTICATE are skipped) and nobody sees another user's events.
import { debugEnabled } from './config.ts';

export interface DebugEvent {
  n: number;
  t: number;
  src: 'http' | 'imap' | 'server';
  account: string;
  sid: string;
  text: string;
  ms?: number;
  level?: 'slow' | 'error';
  /** Gmail-style "[THROTTLED]": the server is deliberately slowing this connection down. */
  throttled?: boolean;
}

const MAX = 1000;
const ring: DebugEvent[] = [];
let seq = 0;

export const debugOn = () => debugEnabled();

export function debugLog(e: Omit<DebugEvent, 'n' | 't'>) {
  if (!debugOn()) return;
  ring.push({ n: ++seq, t: Date.now(), ...e });
  if (ring.length > MAX) ring.shift();
}

/** The events a user may see: those of their session and of their mailboxes, newer than `since`. */
export function debugEventsFor(owner: { sid: string; accounts: string[] }, since: number): DebugEvent[] {
  return ring.filter((e) => e.n > since && ((e.sid && e.sid === owner.sid) || (e.account && owner.accounts.includes(e.account)))).slice(-400);
}

export const debugReset = () => { ring.length = 0; };

/**
 * Turns imapflow's log entries for one connection into debug events: one per finished command (with how long the server
 * took), plus connects and waits for the mailbox lock. LOGIN/AUTHENTICATE lines are skipped, so no credentials get logged.
 */
export function imapTracer(account: string): (e: any) => void {
  const pending = new Map<string, { t: number; cmd: string }>();
  let lockAsked = 0;
  return (e) => {
    if (!debugOn() || e?.hidden) return;
    const msg = String(e?.msg ?? '');
    const key = (tag: string) => `${e.cid}:${tag}`;
    if (e.src === 'c') {
      const m = /^(\S+) ([A-Za-z][A-Za-z0-9.]*)([\s\S]*)$/.exec(msg);
      if (!m || /^(LOGIN|AUTHENTICATE)$/i.test(m[2])) return;
      if (pending.size > 200) pending.clear();
      pending.set(key(m[1]), { t: Date.now(), cmd: `${m[2]}${m[3]}`.replace(/\s+/g, ' ').trim().slice(0, 120) });
    } else if (e.src === 's') {
      const m = /^(\S+) (OK|NO|BAD)\b([\s\S]*)$/.exec(msg);
      const p = m && pending.get(key(m[1]));
      if (!m || !p) return;
      pending.delete(key(m[1]));
      const ms = Date.now() - p.t;
      debugLog({ src: 'imap', account, sid: '', text: `${p.cmd} → ${m[2]}`, ms, throttled: /\[THROTTLED\]/.test(m[3]) || undefined, level: m[2] !== 'OK' ? 'error' : ms >= 2000 ? 'slow' : undefined });
    } else if (e.src === 'connection' && /^Established/.test(msg)) {
      debugLog({ src: 'imap', account, sid: '', text: 'connected' });
    } else if (msg === 'Requesting lock') {
      lockAsked = Date.now();
    } else if (msg.startsWith('Mailbox lock acquired') && lockAsked) {
      const ms = Date.now() - lockAsked;
      if (ms >= 100) debugLog({ src: 'imap', account, sid: '', text: `waited for the mailbox lock ${msg.replace('Mailbox lock acquired', '').trim()}`, ms, level: ms >= 2000 ? 'slow' : undefined });
    }
  };
}
