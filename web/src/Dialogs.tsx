import type { AdminMe, Features, MailAccount, Prefs } from './api.ts';
import { AccountsDialog } from './Accounts.tsx';
import { SecurityDialog } from './Security.tsx';
import { RulesDialog } from './Rules.tsx';
import type { RuleSeed } from './Rules.tsx';
import { SmimeDialog } from './Smime.tsx';
import { SignaturesDialog } from './Signatures.tsx';
import { HeadersDialog } from './Headers.tsx';
import type { UniPrefs } from './unified.ts';
import { AdminDialog } from './Admin.tsx';

/** Which modal dialog is open (at most one). */
export type Dialog =
  | { kind: 'accounts' }
  | { kind: 'security' }
  | { kind: 'rules'; seed?: RuleSeed }
  | { kind: 'smime' }
  | { kind: 'admin' }
  | { kind: 'signatures'; tab: 'signature' | 'templates' }
  | { kind: 'headers'; folder: string; uid: number; account?: string };

export function Dialogs({ dialog, close, flash, features, prefs, setPrefs, accounts, uni, setUni, mainAcct, onAccountsChanged, onMainName, onSecurity, adminMe }: {
  dialog: Dialog | null;
  close: () => void;
  flash: (m: string) => void;
  features: Features | null;
  prefs: Prefs | null;
  setPrefs: (p: Prefs) => void;
  accounts: MailAccount[];
  uni: UniPrefs;
  setUni: (u: UniPrefs) => void;
  mainAcct: MailAccount;
  onAccountsChanged: () => void;
  onMainName: (name: string) => void;
  onSecurity: () => void;
  adminMe: AdminMe | null;
}) {
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'accounts':
      return <AccountsDialog accounts={accounts} uni={uni} setUni={setUni} onClose={close} onChanged={onAccountsChanged} onMainName={onMainName} flash={flash} />;
    case 'security':
      return <SecurityDialog onClose={close} flash={flash} features={features} />;
    case 'rules':
      return <RulesDialog onClose={close} flash={flash} seed={dialog.seed} />;
    case 'smime':
      return <SmimeDialog onClose={close} flash={flash} />;
    case 'signatures':
      return prefs ? <SignaturesDialog onClose={close} prefs={prefs} setPrefs={setPrefs} accounts={[mainAcct, ...accounts.filter((a) => a.id !== 'main' && !a.locked)]} flash={flash} start={dialog.tab} /> : null;
    case 'admin':
      return adminMe?.admin ? <AdminDialog me={adminMe} self={mainAcct.email.toLowerCase()} onClose={close} onSecurity={onSecurity} flash={flash} /> : null;
    case 'headers':
      return <HeadersDialog folder={dialog.folder} uid={dialog.uid} account={dialog.account} onClose={close} flash={flash} />;
  }
}
