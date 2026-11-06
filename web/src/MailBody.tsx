import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { textToHtml } from './util.ts';

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
  html,body{margin:0;padding:0;background:#fff;color:#242424}
  body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:4px 2px 16px;overflow-wrap:break-word}
  img{max-width:100%;height:auto}
  table{max-width:100%}
  pre{white-space:pre-wrap}
  blockquote{margin:0 0 0 .8ex;border-left:2px solid #c8c8c8;padding-left:1ex;color:#555}
  .gm-plain{white-space:normal;font-family:inherit}
  a{color:#0f6cbd}
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
      setHeight(Math.max(d.documentElement.scrollHeight, d.body?.scrollHeight || 0) + 4);
    };
    const onLoad = () => {
      measure();
      ro?.disconnect();
      const b = f.contentDocument?.body;
      if (b) {
        ro = new ResizeObserver(measure);
        ro.observe(b);
      }
      f.contentDocument?.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure));
    };
    f.addEventListener('load', onLoad);
    return () => {
      f.removeEventListener('load', onLoad);
      ro?.disconnect();
    };
  }, [doc]);

  return (
    <iframe
      ref={ref}
      className="mail-frame"
      title="Message body"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height }}
    />
  );
}
