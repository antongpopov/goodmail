import { useState } from 'react';
import type { Folder } from './api.ts';
import { Icon, folderIcon } from './icons.tsx';
import { pathLabel, flatFolders } from './folders.ts';
import { t } from './i18n.ts';

export interface MoveTargets {
  /** The user's usable mailboxes with their folders (the current one first). */
  accounts: { id: string; email: string; folders: Folder[] }[];
  /** Where the messages are now ('' = several places, e.g. in "All inboxes"): that folder is left out of the list. */
  curAccount: string;
  curFolder: string;
  onPick: (account: string, path: string, move: boolean) => void;
}

/** Move / Copy switch plus every folder of every mailbox. Shared by the desktop drop-down and the phone sheet. */
function Targets({ targets, size }: { targets: MoveTargets; size: number }) {
  const [move, setMove] = useState(true);
  const many = targets.accounts.length > 1;
  return (
    <>
      <div className="move-mode" role="radiogroup" aria-label={t('Move or copy')}>
        <button role="radio" aria-checked={move} className={move ? 'on' : ''} onClick={() => setMove(true)}>{t('Move')}</button>
        <button role="radio" aria-checked={!move} className={!move ? 'on' : ''} onClick={() => setMove(false)}>{t('Copy')}</button>
      </div>
      {targets.accounts.map((a) => (
        <div key={a.id}>
          {many && <div className="menu-label move-acct">{a.email}</div>}
          {flatFolders(a.folders)
            .filter((f) => !(a.id === targets.curAccount && f.path === targets.curFolder))
            .map((f) => (
              <button key={f.path} onClick={() => targets.onPick(a.id, f.path, move)}>
                <Icon name={folderIcon(f.specialUse)} size={size} /> {pathLabel(f.path, a.folders)}
              </button>
            ))}
        </div>
      ))}
    </>
  );
}

/** Desktop: drop-down under the toolbar button. */
export function MoveDropdown({ targets, onClose }: { targets: MoveTargets; onClose: () => void }) {
  return (
    <div className="menu move-menu" onMouseLeave={onClose}>
      <Targets targets={targets} size={16} />
    </div>
  );
}

/** Phone: bottom sheet (touch has no hover, and the toolbar is hidden there). */
export function MoveSheet({ targets, onClose }: { targets: MoveTargets; onClose: () => void }) {
  return (
    <div className="phone-only sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{t('Move to…')}</div>
        <Targets targets={targets} size={18} />
      </div>
    </div>
  );
}
