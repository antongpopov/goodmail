import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { textToHtml } from './util.ts';
import { t } from './i18n.ts';

const REMOTE = /^(https?:)?\/\//i;
let allowRemote = false;
let blocked = 0;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as Element;
  if (el.tagName === 'A') {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
  if (allowRemote) return;
  for (const attr of ['src', 'background', 'poster']) {
    const v = el.getAttribute?.(attr);
    if (v && REMOTE.test(v)) {
      el.removeAttribute(attr);
      blocked++;
    }
  }
  if (el.hasAttribute?.('srcset')) {
    el.removeAttribute('srcset');
    blocked++;
  }
  const style = el.getAttribute?.('style');
  if (style && /url\(\s*['"]?(https?:)?\/\//i.test(style)) {
    el.setAttribute('style', style.replace(/url\(\s*['"]?(https?:)?\/\/[^)]*\)/gi, 'none'));
    blocked++;
  }
});

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (!allowRemote && data.tagName === 'style' && node.textContent && /url\(|@import/i.test(node.textContent)) {
    const before = node.textContent;
    node.textContent = before.replace(/@import[^;]+;/gi, '').replace(/url\(\s*['"]?(https?:)?\/\/[^)]*\)/gi, 'none');
    if (node.textContent !== before) blocked++;
  }
});


const rgb = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
const isDarkColor = (c: string) => {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
};
const hexDark = (h: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return isDarkColor(`rgb(${n >> 16},${(n >> 8) & 255},${n & 255})`);
};
const DARK_VARS: Record<string, string> = { '--gm-bg': '#242424', '--gm-fg': '#e8e8e8', '--gm-link': '#6cb2ff', '--gm-quote': '#a8a8a8', '--gm-rule': '#555' };

/* In a dark theme, give mail the dark page too, but only when that is safe: every piece of text that would sit directly on the page
   (no opaque background of its own) must be light. Mail that sets dark text on the default page (or relies on a white page) stays white. */
function applyTheme(d: Document, dark: boolean) {
  const root = d.documentElement;
  const set = (on: boolean) => Object.keys(DARK_VARS).forEach((k) => (on ? root.style.setProperty(k, DARK_VARS[k]) : root.style.removeProperty(k)));
  set(false);
  if (!dark || !d.body) return;
  set(true);
  const win = d.defaultView;
  if (!win) return;
  const cover = new Map<Element, boolean>();
  const covered = (el: Element | null): boolean => {
    const chain: Element[] = [];
    let res = false;
    for (let e = el; e && e !== d.body && e !== root; e = e.parentElement) {
      const hit = cover.get(e);
      if (hit !== undefined) { res = hit; break; }
      chain.push(e);
      const cs = win.getComputedStyle(e);
      const a = rgb(cs.backgroundColor)[3];
      if ((a === undefined ? cs.backgroundColor !== 'transparent' : a > 0.9) || cs.backgroundImage !== 'none') { res = true; break; }
    }
    chain.forEach((e) => cover.set(e, res));
    return res;
  };
  const tw = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(), i = 0; n && i < 3000; n = tw.nextNode(), i++) {
    if (!n.nodeValue?.trim()) continue;
    const el = n.parentElement;
    if (el && !covered(el) && isDarkColor(win.getComputedStyle(el).color)) return set(false);
  }
}
const parentIsDark = () => hexDark(getComputedStyle(document.documentElement).getPropertyValue('--surface'));

function prepare(html: string, text: string, remote: boolean) {
  allowRemote = remote;
  blocked = 0;
  const body = html
    ? DOMPurify.sanitize(html, {
        FORCE_BODY: true,
        FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base'],
        ADD_ATTR: ['target'],
      })
    : `<div class="gm-plain">${textToHtml(text)}</div>`;
  const imgSrc = remote ? 'data: blob: cid: https: http:' : 'data: blob:';
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; media-src ${imgSrc}; style-src 'unsafe-inline'; font-src data: ${remote ? 'https:' : ''}">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:var(--gm-bg,#fff);color:var(--gm-fg,#242424)}
  /* Some senders (TikTok) set html{height:100% !important}: then <html> is as tall as the frame, our height measurement feeds back
     on itself and the frame grows a few pixels per frame. :root outranks their plain selector, so the real content height is measured. */
  html:root,html:root body{height:auto !important;min-height:0 !important;max-height:none !important}
  body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:4px 2px 16px;overflow-wrap:break-word}
  img{max-width:100%;height:auto}
  table{max-width:100%}
  pre{white-space:pre-wrap}
  blockquote{margin:0 0 0 .8ex;border-left:2px solid var(--gm-rule,#c8c8c8);padding-left:1ex;color:var(--gm-quote,#555)}
  .gm-plain{white-space:normal;font-family:inherit}
  a{color:var(--gm-link,#0f6cbd)}
</style></head><body>${body}</body></html>`;
  return { doc, blocked: blocked > 0 };
}

export function MailBody({ html, text, remote, onBlocked }: { html: string; text: string; remote: boolean; onBlocked: (b: boolean) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const { doc, blocked: wasBlocked } = useMemo(() => prepare(html, text, remote), [html, text, remote]);

  useEffect(() => onBlocked(wasBlocked), [wasBlocked, onBlocked]);

  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    const measure = () => {
      const d = f.contentDocument;
      if (!d?.documentElement) return;
      // <html> has no fixed height, so its box is the content height (scrollHeight never shrinks below the frame).
      const h = d.documentElement.getBoundingClientRect().height || d.documentElement.scrollHeight;
      setHeight(Math.ceil(h) + 4);
    };
    // Newsletters are often fixed 600-700px tables: shrink them to fit instead of scrolling sideways.
    const fit = () => {
      const d = f.contentDocument;
      if (!d?.body) return;
      d.body.style.zoom = '';
      const sw = d.documentElement.scrollWidth;
      const cw = f.clientWidth;
      if (cw > 0 && sw > cw + 4) d.body.style.zoom = String(Math.max(0.4, cw / sw));
      measure();
    };
    const theme = () => {
      const d = f.contentDocument;
      if (d) applyTheme(d, parentIsDark());
    };
    const mo = new MutationObserver(theme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', theme);
    const onLoad = () => {
      theme();
      fit();
      ro?.disconnect();
      const b = f.contentDocument?.body;
      if (b) {
        ro = new ResizeObserver(measure);
        ro.observe(b);
      }
      f.contentDocument?.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit));
    };
    f.addEventListener('load', onLoad);
    return () => {
      f.removeEventListener('load', onLoad);
      mo.disconnect();
      mq.removeEventListener('change', theme);
      ro?.disconnect();
    };
  }, [doc]);

  return (
    <iframe
      ref={ref}
      className="mail-frame"
      title={t('Message body')}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height }}
    />
  );
}
