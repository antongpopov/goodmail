// "Newsletters and notifications" vs "From people": a folder search that needs no classifier.
// Mass mail carries List-Unsubscribe / List-Id / Precedence: bulk (RFC 2369, RFC 3834); the rest of the automated mail
// (receipts, build and store notices) comes from addresses like no-reply@ or notifications@.
import type { SearchObject } from 'imapflow';

const exists = (name: string): SearchObject => ({ header: { [name]: true } });
export const bulkCriteria: SearchObject = {
  or: [
    exists('List-Unsubscribe'),
    exists('List-Id'),
    { header: { Precedence: 'bulk' } },
    { header: { Precedence: 'list' } },
    { header: { 'Auto-Submitted': 'auto-' } },
    { from: 'noreply' },
    { from: 'no-reply' },
    { from: 'donotreply' },
    { from: 'do-not-reply' },
    { from: 'notification' },
    { from: 'mailer-daemon' },
  ],
};
/** Everything that is not bulk: mail written by a person. */
export const peopleCriteria: SearchObject = { not: bulkCriteria };
