import { withFolder } from './imap.ts';
import type { Session } from './session.ts';

/**
 * After a login or a restart the first click on another mailbox (Gmail) pays for connecting to it and selecting its Inbox,
 * several throttled commands. Do that once, in the background, as soon as the session exists: the connection is then logged in and
 * the Inbox is selected when the click comes. Extra mailboxes only (the login mailbox is on our fast server), one after the other,
 * at most three, and a failure is silently ignored (the click will simply connect itself).
 */
export async function warmExtras(s: Session, max = 3) {
  for (const c of [...s.extra.values()].slice(0, max)) {
    try {
      await withFolder(c, 'INBOX', async () => undefined, true);
    } catch {
      /* ignore */
    }
  }
}
