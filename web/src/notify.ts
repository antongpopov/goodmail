import type { Folder } from './api.ts';

// New-mail notifications: a chime, the unread count in the tab title and on the tab icon, and (optionally) a desktop notification.
// The detection works on the folder counts goodmail already polls, so it adds no requests to the mail server.

export interface InboxCount { unseen: number; total: number }

/** Unread / total of each mailbox's Inbox (null until its folder list is loaded). */
export function inboxCounts(all: Record<string, Folder[]>): Record<string, InboxCount> {
  const out: Record<string, InboxCount> = {};
  for (const [id, list] of Object.entries(all)) {
    const f = list.find((x) => x.specialUse === '\\Inbox') ?? list.find((x) => x.path.toUpperCase() === 'INBOX');
    if (f) out[id] = { unseen: f.unseen, total: f.total };
  }
  return out;
}

export const totalUnseen = (c: Record<string, InboxCount>) => Object.values(c).reduce((n, x) => n + x.unseen, 0);

/**
 * How many messages arrived between two looks at the Inboxes. A mailbox counts only when it has MORE messages and MORE unread ones than
 * before (so marking a message unread by hand, or reading one, is not "new mail"), and only if we had seen it before (so the first load
 * and a mailbox that was added later never chime).
 */
export function newMail(prev: Record<string, InboxCount> | null, next: Record<string, InboxCount>): { n: number; ids: string[] } {
  let n = 0;
  const ids: string[] = [];
  if (prev)
    for (const [id, now] of Object.entries(next)) {
      const was = prev[id];
      if (was && now.total > was.total && now.unseen > was.unseen) {
        n += Math.min(now.unseen - was.unseen, now.total - was.total);
        ids.push(id);
      }
    }
  return { n, ids };
}

// ---- sound: a short two-note chime made with Web Audio (no file to load). Browsers only allow sound after a click or key press.
let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)());
export function unlockAudio() {
  try {
    void audio().resume();
  } catch {
    /* no audio available */
  }
}
export function playChime() {
  try {
    const a = audio();
    void a.resume();
    const now = a.currentTime;
    for (const [i, hz] of [880, 1318.5].entries()) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, now + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.18, now + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.35);
      o.connect(g).connect(a.destination);
      o.start(now + i * 0.16);
      o.stop(now + i * 0.16 + 0.4);
    }
  } catch {
    /* ignore */
  }
}

// ---- tab: "(3) goodmail" and a red badge on the icon
let baseHref: string | null = null;
let baseImg: HTMLImageElement | null = null;
const iconLink = () => document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

export function setTabCount(count: number, appName: string) {
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${appName}` : appName;
  const link = iconLink();
  if (!link) return;
  baseHref ??= link.href;
  if (count <= 0) {
    if (link.href !== baseHref) link.href = baseHref;
    return;
  }
  const paint = (img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, 64, 64);
    g.fillStyle = '#d13438';
    g.beginPath();
    g.arc(46, 18, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 24px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(count > 9 ? '9+' : String(count), 46, 19);
    link.type = 'image/png';
    link.href = c.toDataURL('image/png');
  };
  if (baseImg?.complete) return paint(baseImg);
  const img = new Image();
  img.onload = () => {
    baseImg = img;
    paint(img);
  };
  img.src = baseHref;
}

// ---- desktop notification (only when the tab is not in front)
export const desktopSupported = () => typeof Notification !== 'undefined';
export function showDesktop(title: string, body: string) {
  try {
    if (!desktopSupported() || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    const n = new Notification(title, { body, tag: 'goodmail-new-mail', icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}
