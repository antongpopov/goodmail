import { t } from './i18n.ts';

/** "All inboxes", "All sent", …: the same kind of folder from several of the user's mailboxes in one list. */
export interface UniPrefs {
  entries: string[]; // which combined folders appear in the sidebar
  accounts: string[] | null; // which mailboxes are included (null = all of them)
}
export const UNI_KINDS = ['inbox', 'sent', 'drafts', 'junk', 'trash', 'archive'] as const;
export const UNI_ACCOUNT = 'all'; // the pseudo mailbox id of the combined views
export const UNI_DEFAULT: UniPrefs = { entries: ['inbox', 'sent'], accounts: null };
export const uniKind = (folder: string) => folder.replace(/^@/, '');
export const UNI_USE: Record<string, string> = { inbox: '\\Inbox', sent: '\\Sent', drafts: '\\Drafts', junk: '\\Junk', trash: '\\Trash', archive: '\\Archive' };
/** UIDs repeat between mailboxes, so a row in a combined list gets a number that is unique across all of them. */
export const synthUid = (accountIndex: number, uid: number) => (accountIndex + 1) * 4294967296 + uid;
export const uniLabel = (k: string) =>
  ({ inbox: t('All inboxes'), sent: t('All sent'), drafts: t('All drafts'), junk: t('All junk'), trash: t('All trash'), archive: t('All archive') } as Record<string, string>)[k] || k;

/** How the message list is sorted. Anything but 'date' sorts the messages loaded so far (the server pages by date). */
export type SortKey = 'date' | 'from' | 'subject' | 'size' | 'flagged';
