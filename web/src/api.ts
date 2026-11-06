export interface Addr { name: string; address: string }
export interface Folder { path: string; name: string; delimiter: string; specialUse: string; unseen: number; total: number }
export interface Summary {
  uid: number; date: number; from: Addr; to: Addr[]; cc: Addr[]; subject: string; messageId: string;
  seen: boolean; flagged: boolean; answered: boolean; hasAttachments: boolean; size: number; snippet: string;
}
export interface Attachment { part: string; filename: string; type: string; size: number; cid?: string; inline: boolean }
export interface Message {
  uid: number; folder: string; subject: string; date: number; from: Addr; to: Addr[]; cc: Addr[]; replyTo: Addr[];
  messageId: string; references: string[]; html: string; text: string; flagged: boolean; listUnsubscribe: string;
  attachments: Attachment[];
}
export interface Me { email: string; name: string; imapHost: string }
export interface ListResult { total: number; messages: Summary[]; hasMore: boolean }

export class ApiError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'x-goodmail': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && !url.endsWith('/login')) onUnauthorized();
    throw new ApiError(r.status, data.error || r.statusText);
  }
  return data as T;
}

const q = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  config: () => call<{ appName: string }>('GET', '/api/config'),
  me: () => call<Me>('GET', '/api/me'),
  login: (body: Record<string, unknown>) => call<Me>('POST', '/api/login', body),
  logout: () => call('POST', '/api/logout', {}),
  folders: () => call<Folder[]>('GET', '/api/folders'),
  messages: (folder: string, page: number) => call<ListResult>('GET', `/api/messages?${q({ folder, page })}`),
  search: (folder: string, text: string) => call<ListResult>('GET', `/api/search?${q({ folder, q: text })}`),
  message: (folder: string, uid: number) => call<Message>('GET', `/api/message?${q({ folder, uid })}`),
  flags: (folder: string, uids: number[], add: string[], remove: string[] = []) =>
    call('POST', '/api/flags', { folder, uids, add, remove }),
  move: (folder: string, uids: number[], to: string) => call<{ to: string }>('POST', '/api/move', { folder, uids, to }),
  remove: (folder: string, uids: number[]) => call<{ permanent: boolean }>('POST', '/api/delete', { folder, uids }),
  createFolder: (name: string) => call('POST', '/api/folder', { name }),
  send: (body: Record<string, unknown>) => call('POST', '/api/send', body),
  attachmentUrl: (folder: string, uid: number, a: Attachment, inline = false) =>
    `/api/attachment?${q({ folder, uid, part: a.part, name: a.filename, ...(inline ? { inline: 1 } : {}) })}`,
};
