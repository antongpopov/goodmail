import { Icon, folderIcon } from './icons.tsx';
import { folderLabel } from './folders.ts';
import type { FolderNode } from './folders.ts';

interface Props {
  n: FolderNode;
  aid: string; // account this tree belongs to
  acct: string; // currently selected account
  folder: string; // currently selected folder path
  collapsed: Record<string, boolean>;
  onOpen: (aid: string, path: string) => void;
  onToggle: (key: string) => void;
  onDrop: (aid: string, path: string, uids: number[]) => void;
}

/** A folder in the tree (and, recursively, its children). Accepts dragged messages. */
export function FolderRow({ n, aid, acct, folder, collapsed, onOpen, onToggle, onDrop }: Props) {
  const key = `${aid}:${n.path}`;
  return (
    <div>
      <div
        className={`folder ${n.path === folder && aid === acct ? 'active' : ''}`}
        style={{ paddingLeft: 12 + n.depth * 14 }}
        onClick={() => onOpen(aid, n.path)}
        onDragOver={(e) => aid === acct && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onDrop(aid, n.path, JSON.parse(e.dataTransfer.getData('application/x-goodmail') || '[]'));
        }}
      >
        {n.children.length > 0 ? (
          <button
            className="twisty"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(key);
            }}
          >
            <Icon name={collapsed[key] ? 'chevronRight' : 'chevronDown'} size={14} />
          </button>
        ) : (
          <span className="twisty" />
        )}
        <Icon name={folderIcon(n.specialUse)} size={18} />
        <span className="fname">{folderLabel(n)}</span>
        {n.unseen > 0 && n.specialUse !== '\\Sent' && <span className="count">{n.unseen}</span>}
      </div>
      {!collapsed[key] && n.children.map((c) => <FolderRow key={c.path} n={c} aid={aid} acct={acct} folder={folder} collapsed={collapsed} onOpen={onOpen} onToggle={onToggle} onDrop={onDrop} />)}
    </div>
  );
}
