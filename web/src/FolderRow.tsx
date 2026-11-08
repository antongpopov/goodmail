import { useEffect, useRef, useState } from 'react';
import { t } from './i18n.ts';
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
  onDropFolder: (aid: string, from: string, to: string) => void;
  onSub: (aid: string, n: FolderNode) => void;
  onRename: (aid: string, n: FolderNode) => void;
  onDelete: (aid: string, n: FolderNode) => void;
}

/** A folder in the tree (and, recursively, its children). Accepts dragged messages. */
export function FolderRow({ n, aid, acct, folder, collapsed, onOpen, onToggle, onDrop, onDropFolder, onSub, onRename, onDelete }: Props) {
  const key = `${aid}:${n.path}`;
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const editable = !n.specialUse && !/^inbox$/i.test(n.path);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  return (
    <div>
      <div
        className={`folder ${n.path === folder && aid === acct ? 'active' : ''}`}
        style={{ paddingLeft: 12 + n.depth * 14 }}
        onClick={() => onOpen(aid, n.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        draggable={editable}
        onDragStart={(e) => {
          if (!editable) return;
          e.dataTransfer.setData('application/x-goodmail-folder', JSON.stringify({ aid, path: n.path }));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => aid === acct && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const f = e.dataTransfer.getData('application/x-goodmail-folder');
          if (f) {
            const src = JSON.parse(f) as { aid: string; path: string };
            if (src.aid === aid && src.path !== n.path) onDropFolder(aid, src.path, n.path);
            return;
          }
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
        {(
          <div className="fmenu-wrap" ref={ref}>
            <button className="fmenu-btn" title={t('Folder options')} aria-label={t('Folder options')} onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>
              <Icon name="more" size={16} />
            </button>
            {menu && (
              <div className="menu fmenu" onClick={(e) => e.stopPropagation()}>
                <button className="menu-btn" onClick={() => { setMenu(false); onSub(aid, n); }}>{t('New subfolder…')}</button>
                {editable && <button className="menu-btn" onClick={() => { setMenu(false); onRename(aid, n); }}>{t('Rename folder…')}</button>}
                {editable && <button className="menu-btn" onClick={() => { setMenu(false); onDelete(aid, n); }}>{t('Delete folder…')}</button>}
              </div>
            )}
          </div>
        )}
      </div>
      {!collapsed[key] && n.children.map((c) => <FolderRow key={c.path} n={c} aid={aid} acct={acct} folder={folder} collapsed={collapsed} onOpen={onOpen} onToggle={onToggle} onDrop={onDrop} onDropFolder={onDropFolder} onSub={onSub} onRename={onRename} onDelete={onDelete} />)}
    </div>
  );
}
