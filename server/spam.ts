// Spam score from the filter's headers (rspamd or SpamAssassin). Only the TOPMOST header is used:
// mail servers prepend headers, so that one was added by our own server; anything below it could be forged.
import { spamThreshold } from './config.ts';

export interface SpamInfo {
  score: number;
  threshold: number; // where the filter treats mail as junk
  reject?: number; // where it would have rejected the mail outright (rspamd)
  engine: 'rspamd' | 'spamassassin';
}

export function spamInfo(headerLines: readonly { key: string; line: string }[]): SpamInfo | null {
  const first = (k: string) => headerLines.find((h) => h.key === k)?.line.replace(/^[^:]+:\s*/, '').replace(/\r?\n\s+/g, ' ');
  const rs = first('x-spamd-result');
  if (rs) {
    const m = /\[\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*\]/.exec(rs);
    if (m) return { score: Number(m[1]), threshold: spamThreshold() ?? 6, reject: Number(m[2]), engine: 'rspamd' };
  }
  const rscore = first('x-rspamd-score');
  if (rscore && !Number.isNaN(Number(rscore))) return { score: Number(rscore), threshold: spamThreshold() ?? 6, engine: 'rspamd' };
  const sa = first('x-spam-status');
  if (sa) {
    const s = /score=(-?\d+(?:\.\d+)?)/.exec(sa);
    const r = /required=(-?\d+(?:\.\d+)?)/.exec(sa);
    if (s) return { score: Number(s[1]), threshold: spamThreshold() ?? (r ? Number(r[1]) : 5), engine: 'spamassassin' };
  }
  const ss = first('x-spam-score');
  if (ss && !Number.isNaN(Number(ss))) return { score: Number(ss), threshold: spamThreshold() ?? 5, engine: 'spamassassin' };
  return null;
}
