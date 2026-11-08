export interface Addr { name: string; address: string }
export interface Folder { path: string; name: string; delimiter: string; specialUse: string; unseen: number; total: number }
export interface Summary {
  uid: number; date: number; from: Addr; to: Addr[]; cc: Addr[]; subject: string; messageId: string;
  seen: boolean; flagged: boolean; answered: boolean; hasAttachments: boolean; size: number; snippet: string;
  spam?: { score: number; threshold: number; reject?: number; engine: string } | null;
}
export interface Attachment { part: string; filename: string; type: string; size: number; cid?: string; inline: boolean }
export interface Message {
  uid: number; folder: string; subject: string; date: number; from: Addr; to: Addr[]; cc: Addr[]; replyTo: Addr[];
  messageId: string; references: string[]; html: string; text: string; flagged: boolean; listUnsubscribe: string;
  spam?: { score: number; threshold: number; reject?: number; engine: string } | null;
  attachments: Attachment[]; account?: string; smime?: SmimeInfo;
}
export interface Contact { id: string; name: string; emails: string[]; phones: string[]; company: string; notes: string; updated: number }
export interface RRule { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'; interval: number; until?: number; count?: number; byday?: string[] }
export interface CalEvent {
  id: string; uid: string; title: string; allDay: boolean; start: number | string; end: number | string;
  location: string; notes: string; color: string; rrule?: RRule; exdates?: (number | string)[]; updated: number;
}
export interface MailAccount { id: string; email: string; name: string; provider: string; imapHost: string; locked: boolean }
export interface MfaChallenge { ticket: string; totp: boolean; passkey: boolean; email: string | null; recovery: boolean }
export interface MfaStatus { enabled: boolean; totp: boolean; passkeys: { id: string; name: string; added: number; passwordless: boolean }[]; email: string | null; recoveryLeft: number; resetEmail?: string | null; recovery?: string[] }
export interface Me { email: string; name: string; imapHost: string; appName?: string; appNames?: Record<string, string> }
export interface Features { rules: boolean; password: boolean; passwordMin: number; reset: boolean; smime: boolean }
export interface SmimeSignature { status: 'ok' | 'untrusted' | 'expired' | 'mismatch' | 'invalid'; signer?: { emails: string[]; name: string; issuer: string; fingerprint: string; notAfter: string } }
export interface SmimeInfo { signed?: SmimeSignature; encrypted?: boolean; readable?: boolean; reason?: 'no-certificate' | 'not-for-you' }
export interface CertView { emails: string[]; name: string; issuer: string; fingerprint: string; notBefore: string; notAfter: string; expired: boolean }
export interface SmimeStatus { enabled: boolean; available?: boolean; canIssue?: boolean; cert?: (CertView & { kind: 'local' | 'imported'; added: number }) | null; ca?: CertView | null; contacts?: (CertView & { email: string })[] }
export type RuleField = 'from' | 'to' | 'cc' | 'recipient' | 'subject' | 'list' | 'header';
export type RuleOp = 'contains' | 'not-contains' | 'is' | 'begins' | 'ends';
export type RuleActionType = 'move' | 'read' | 'flag' | 'forward' | 'discard' | 'stop';
export interface RuleCondition { field: RuleField; header?: string; op: RuleOp; value: string }
export interface RuleAction { type: RuleActionType; value?: string }
export interface MailRule { id: string; name: string; enabled: boolean; match: 'all' | 'any'; conditions: RuleCondition[]; actions: RuleAction[] }
export interface ListResult { total: number; messages: Summary[]; hasMore: boolean }

export class ApiError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

import { tErr } from './i18n.ts';

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
    if (r.status === 401 && !url.startsWith('/api/login')) onUnauthorized();
    throw new ApiError(r.status, tErr(data.error || r.statusText));
  }
  return data as T;
}

// The mailbox the mail calls below act on ("main" = the login mailbox). The UI shows one at a time.
let cur = 'main';
export const useAccount = (id: string) => {
  cur = id;
};
export const currentAccount = () => cur;

const q = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  config: () => call<{ appName: string; appNames?: Record<string, string>; reset?: boolean; source: string }>('GET', '/api/config'),
  me: () => call<Me>('GET', '/api/me'),
  login: (body: Record<string, unknown>) => call<Me & { mfa?: MfaChallenge }>('POST', '/api/login', body),
  mfaVerify: (body: Record<string, unknown>) => call<Me>('POST', '/api/login/mfa', body),
  mfaSendEmail: (ticket: string) => call<{ to: string }>('POST', '/api/login/mfa/email', { ticket }),
  mfaPasskeyOptions: (ticket: string) => call<any>('POST', '/api/login/mfa/passkey-options', { ticket }),
  mfaStatus: () => call<MfaStatus>('GET', '/api/mfa'),
  totpStart: () => call<{ secret: string; uri: string }>('POST', '/api/mfa/totp/start', {}),
  totpConfirm: (code: string) => call<MfaStatus>('POST', '/api/mfa/totp/confirm', { code }),
  passkeyOptions: (passwordless: boolean) => call<any>('POST', '/api/mfa/passkey/options', { passwordless }),
  passkeyVerify: (response: unknown, name: string, passwordless: boolean) => call<MfaStatus>('POST', '/api/mfa/passkey/verify', { response, name, passwordless }),
  passkeyPasswordless: (id: string, on: boolean) => call<MfaStatus>('POST', '/api/mfa/passkey/passwordless', { id, on }),
  passkeyLoginOptions: () => call<{ options: any; challengeId: string }>('POST', '/api/login/passkey/options', {}),
  passkeyLogin: (body: Record<string, unknown>) => call<Me>('POST', '/api/login/passkey', body),
  backupEmailStart: (address: string) => call('POST', '/api/mfa/email/start', { address }),
  backupEmailConfirm: (code: string) => call<MfaStatus>('POST', '/api/mfa/email/confirm', { code }),
  mfaRemove: (what: string, password: string, id?: string) => call<MfaStatus>('POST', '/api/mfa/remove', { what, password, id }),
  recoveryNew: (password: string) => call<MfaStatus>('POST', '/api/mfa/recovery', { password }),
  smime: () => call<SmimeStatus>('GET', '/api/smime'),
  smimeEnable: () => call('POST', '/api/smime/enable', {}),
  smimeImport: (file: string, filePassword: string) => call('POST', '/api/smime/import', { file, filePassword }),
  smimeRemove: (password: string) => call('POST', '/api/smime/remove', { password }),
  smimeAddCert: (file: string) => call<{ added: boolean }>('POST', '/api/smime/certs', { file }),
  smimeForgetCert: (email: string) => call('POST', '/api/smime/certs/delete', { email }),
  smimeLookup: (addresses: string[]) => call<{ can: Record<string, boolean>; mine: boolean }>('POST', '/api/smime/lookup', { addresses }),
  smimeExport: async (password: string, filePassword: string) => {
    const r = await fetch('/api/smime/export', { method: 'POST', credentials: 'same-origin', headers: { 'x-goodmail': '1', 'content-type': 'application/json' }, body: JSON.stringify({ password, filePassword }) });
    if (!r.ok) throw new ApiError(r.status, tErr((await r.json().catch(() => ({}))).error || r.statusText));
    return r.blob();
  },
  features: () => call<Features>('GET', '/api/features'),
  rules: () => call<{ rules: MailRule[]; foreign: boolean; active: string | null }>('GET', '/api/rules'),
  saveRules: (rules: MailRule[], replace = false) => call('PUT', '/api/rules', { rules, replace }),
  changePassword: (current: string, next: string) => call<Me>('POST', '/api/password', { current, next }),
  resetEmailStart: (address: string) => call('POST', '/api/mfa/reset-email/start', { address }),
  resetEmailConfirm: (code: string) => call<MfaStatus>('POST', '/api/mfa/reset-email/confirm', { code }),
  resetEmailRemove: (password: string) => call<MfaStatus>('POST', '/api/mfa/reset-email/remove', { password }),
  resetStart: (email: string) => call<{ ticket: string }>('POST', '/api/reset/start', { email }),
  resetFinish: (ticket: string, code: string, next: string) => call('POST', '/api/reset/finish', { ticket, code, next }),
  logout: () => call('POST', '/api/logout', {}),
  folders: (account = cur, fresh = false) => call<Folder[]>('GET', `/api/folders?${q({ account, ...(fresh ? { fresh: 1 } : {}) })}`),
  messages: (folder: string, page: number, filter = 'all') =>
    call<ListResult>('GET', `/api/messages?${q({ folder, page, account: cur, ...(filter !== 'all' ? { filter } : {}) })}`),
  search: (folder: string, text: string) => call<ListResult>('GET', `/api/search?${q({ folder, q: text, account: cur })}`),
  message: (folder: string, uid: number, peek = false, account = cur) =>
    call<Message>('GET', `/api/message?${q({ folder, uid, account, ...(peek ? { peek: 1 } : {}) })}`).then((m) => ({ ...m, account })),
  flags: (folder: string, uids: number[], add: string[], remove: string[] = []) =>
    call('POST', '/api/flags', { folder, uids, add, remove, account: cur }),
  move: (folder: string, uids: number[], to: string) => call<{ to: string }>('POST', '/api/move', { folder, uids, to, account: cur }),
  remove: (folder: string, uids: number[]) => call<{ permanent: boolean }>('POST', '/api/delete', { folder, uids, account: cur }),
  createFolder: (name: string) => call('POST', '/api/folder', { name, account: cur }),
  renameFolder: (path: string, name: string) => call<{ path: string }>('POST', '/api/folder/rename', { path, name, account: cur }),
  moveFolder: (path: string, parent: string) => call<{ path: string }>('POST', '/api/folder/move', { path, parent, account: cur }),
  deleteFolder: (path: string) => call<{ permanent: boolean; path?: string }>('POST', '/api/folder/delete', { path, account: cur }),
  send: (body: Record<string, unknown>) => call('POST', '/api/send', body),
  accounts: () => call<MailAccount[]>('GET', '/api/accounts'),
  addAccount: (body: Record<string, unknown>) => call<MailAccount>('POST', '/api/accounts', body),
  unlockAccounts: (oldPassword: string) => call<{ unlocked: number }>('POST', '/api/accounts/unlock', { oldPassword }),
  removeAccount: (id: string) => call('POST', '/api/accounts/delete', { id }),
  guessAccount: (email: string) =>
    call<{ imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }>('POST', '/api/accounts/guess', { email }),
  contacts: () => call<Contact[]>('GET', '/api/contacts'),
  saveContact: (c: Partial<Contact>) => call<Contact>('POST', '/api/contacts', c),
  deleteContacts: (ids: string[]) => call('POST', '/api/contacts/delete', { ids }),
  importContacts: (text: string, format: 'vcf' | 'csv') =>
    call<{ added: number; merged: number; total: number }>('POST', '/api/contacts/import', { text, format }),
  exportUrl: (format: 'vcf' | 'csv') => `/api/contacts/export?format=${format}`,
  events: () => call<CalEvent[]>('GET', '/api/events'),
  saveEvent: (e: Partial<CalEvent>) => call<CalEvent>('POST', '/api/events', e),
  deleteEvents: (ids: string[]) => call('POST', '/api/events/delete', { ids }),
  importEvents: (text: string) =>
    call<{ added: number; updated: number; total: number; first?: number | string }>('POST', '/api/events/import', {
      text,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  icsExportUrl: '/api/events/export',
  attachmentUrl: (folder: string, uid: number, a: Attachment, inline = false) =>
    `/api/attachment?${q({ folder, uid, part: a.part, name: a.filename, account: cur, ...(inline ? { inline: 1 } : {}) })}`,
};
