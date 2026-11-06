// Helpers for walking BODYSTRUCTURE and turning partial body bytes into a preview line.
import type { MessageStructureObject } from 'imapflow';

export interface AttachmentInfo {
  part: string;
  filename: string;
  type: string;
  size: number;
  cid?: string;
  inline: boolean;
}

/** Find the part that best represents the message text: first text/plain, else first text/html. */
export function previewPart(node: MessageStructureObject | undefined) {
  let plain: MessageStructureObject | undefined;
  let html: MessageStructureObject | undefined;
  const walk = (n: MessageStructureObject) => {
    if (n.childNodes?.length) return n.childNodes.forEach(walk);
    if (n.disposition === 'attachment') return;
    if (!plain && n.type === 'text/plain') plain = n;
    if (!html && n.type === 'text/html') html = n;
  };
  if (node) walk(node);
  const p = plain ?? html;
  if (!p) return undefined;
  // A single-part message has no part id; its body is "1" per RFC 3501.
  return { key: p.part || '1', node: p, isHtml: p === html };
}

export function attachments(node: MessageStructureObject | undefined): AttachmentInfo[] {
  const out: AttachmentInfo[] = [];
  const walk = (n: MessageStructureObject) => {
    if (n.childNodes?.length) return n.childNodes.forEach(walk);
    const filename = n.dispositionParameters?.filename || n.parameters?.name;
    const isText = n.type === 'text/plain' || n.type === 'text/html';
    if (n.disposition === 'attachment' || (filename && !isText) || (!isText && !n.type.startsWith('multipart/'))) {
      out.push({
        part: n.part || '1',
        filename: filename || 'attachment',
        type: n.type,
        size: n.size ?? 0,
        cid: n.id?.replace(/^<|>$/g, ''),
        inline: n.disposition === 'inline' || (!!n.id && n.disposition !== 'attachment'),
      });
    }
  };
  if (node) walk(node);
  return out;
}

function decodeQP(s: string): Uint8Array {
  const clean = s.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(clean.slice(i + 1, i + 3))) {
      bytes.push(parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(clean.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(bytes);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?(<\/\1>|$)/gi, ' ')
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(/<[^>]*>?/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

export function makeSnippet(
  buf: Buffer,
  node: MessageStructureObject,
  isHtml: boolean,
  alreadyDecoded: boolean,
): string {
  let bytes: Uint8Array = buf;
  const enc = (node.encoding || '').toLowerCase();
  if (!alreadyDecoded) {
    if (enc === 'base64') {
      const b64 = buf.toString('latin1').replace(/[^A-Za-z0-9+/]/g, '');
      bytes = Buffer.from(b64.slice(0, b64.length - (b64.length % 4)), 'base64');
    } else if (enc === 'quoted-printable') {
      bytes = decodeQP(buf.toString('latin1').replace(/=[0-9A-Fa-f]?$/, ''));
    }
  }
  let text: string;
  try {
    text = new TextDecoder(node.parameters?.charset || 'utf-8').decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  if (isHtml) text = htmlToText(text);
  return text
    .replace(/�+$/, '')
    .replace(/^>.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
