import type { Folder } from './api.ts';
import { Icon, folderIcon } from './icons.tsx';
import { pathLabel, flatFolders } from './folders.ts';
import { t } from './i18n.ts';

/** Every folder except the current one, as buttons. Shared by the desktop drop-down and the phone sheet. */
function FolderButtons({ folders, current, onPick, size }: { folders: Folder[]; current: string; onPick: (path: string) => void; size: number }) {
  return (
    <>
      {flatFolders(folders)
        .filter((f) => f.path !== current)
        .map((f) => (
          <button key={f.path} onClick={() => onPick(f.path)}>
            <Icon name={folderIcon(f.specialUse)} size={size} /> {pathLabel(f.path, folders)}
          </button>
        ))}
    </>
  );
}

/** Desktop: drop-down under the toolbar button. */
export function MoveDropdown({ folders, current, onPick, onClose }: { folders: Folder[]; current: string; onPick: (path: string) => void; onClose: () => void }) {
  return (
    <div className="menu" onMouseLeave={onClose}>
      <FolderButtons folders={folders} current={current} onPick={onPick} size={16} />
    </div>
  );
}

/** Phone: bottom sheet (touch has no hover, and the toolbar is hidden there). */
export function MoveSheet({ folders, current, onPick, onClose }: { folders: Folder[]; current: string; onPick: (path: string) => void; onClose: () => void }) {
  return (
    <div className="phone-only sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{t('Move to…')}</div>
        <FolderButtons folders={folders} current={current} onPick={onPick} size={18} />
      </div>
    </div>
  );
}
