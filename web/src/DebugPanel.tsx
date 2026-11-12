import { useEffect, useMemo, useRef, useState } from 'react';
import { api, setUiLog, uiBuf, type DebugEvent } from './api.ts';

// The Debug window (goodmail.conf: debug=true). Shows what goodmail does in the background: the browser's own calls, the
// server's API calls and the IMAP commands with how long each took. Nothing here is saved; it is the last few minutes.
const hms = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false }) + '.' + String(t % 1000).padStart(3, '0');
const who = (a: string) => (a ? a.split('@')[0] : '');

export function DebugPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<DebugEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const since = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    setUiLog(true);
    return () => setUiLog(false);
  }, []);

  useEffect(() => {
    if (paused) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.debug(since.current);
        if (r.events.length) since.current = r.events[r.events.length - 1].n;
        const add = [...r.events, ...uiBuf.splice(0)];
        if (add.length && !stop) setRows((old) => [...old, ...add].sort((a, b) => a.t - b.t).slice(-1200));
      } catch {
        /* the server may be restarting: try again next time */
      }
    };
    void tick();
    const id = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [paused]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? rows.filter((e) => `${e.src} ${e.account} ${e.text}`.toLowerCase().includes(f)) : rows;
  }, [rows, filter]);

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown]);

  // Is a server throttling us? ("[THROTTLED]" on the replies of the last minute)
  const throttle = useMemo(() => {
    const cut = Date.now() - 60_000;
    const by = new Map<string, { n: number; hit: number; ms: number }>();
    for (const e of rows) {
      if (e.src !== 'imap' || e.t < cut || e.ms === undefined || !e.text.includes('→')) continue;
      const x = by.get(e.account) ?? { n: 0, hit: 0, ms: 0 };
      x.n++;
      x.ms += e.ms;
      if (e.throttled) x.hit++;
      by.set(e.account, x);
    }
    return [...by].filter(([, x]) => x.hit > 0).map(([a, x]) => `${a}: the server is throttling this connection — ${x.hit} of the last ${x.n} IMAP replies were marked [THROTTLED], about ${Math.round(x.ms / x.n)} ms per command`);
  }, [rows]);

  const copy = () =>
    void navigator.clipboard?.writeText(shown.map((e) => `${hms(e.t)} ${e.src.padEnd(6)} ${who(e.account).padEnd(10)} ${e.text}${e.ms !== undefined ? ` ${e.ms} ms` : ''}${e.throttled ? ' [THROTTLED]' : ''}`).join('\n'));

  return (
    <div className="debug-panel" role="region" aria-label="Debug">
      <div className="debug-head">
        <b>Debug</b>
        <span className="debug-note">what goodmail is doing in the background (browser calls · server calls · IMAP commands)</span>
        <input placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter" />
        <button onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</button>
        <button onClick={() => setRows([])}>Clear</button>
        <button onClick={copy}>Copy</button>
        <button onClick={onClose} aria-label="Close debug window">✕</button>
      </div>
      {throttle.map((t) => (
        <div key={t} className="debug-warn">{t}</div>
      ))}
      <div
        className="debug-rows"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
        }}
      >
        {shown.length === 0 && <div className="debug-empty">Waiting for activity… click a folder, or wait for the next refresh.</div>}
        {shown.map((e, i) => (
          <div key={`${e.src}${e.n}${i}`} className={`debug-row ${e.level ?? ''}`}>
            <span className="t">{hms(e.t)}</span>
            <span className={`src ${e.src}`}>{e.src}</span>
            <span className="acct">{who(e.account)}</span>
            <span className="txt">{e.text}{e.throttled && <em> [THROTTLED]</em>}</span>
            <span className={`ms ${e.ms !== undefined && e.ms >= 2000 ? 'slow' : e.ms !== undefined && e.ms >= 700 ? 'mid' : ''}`}>{e.ms !== undefined ? `${e.ms} ms` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
