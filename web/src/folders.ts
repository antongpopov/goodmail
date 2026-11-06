import type { Folder } from './api.ts';
import { t } from './i18n.ts';

export const SPECIAL_ORDER = ['\\Inbox', '\\Drafts', '\\Sent', '\\Archive', '\\Junk', '\\Trash'];

const SPECIAL_NAMES: Record<string, string> = { '\\Inbox': 'Inbox', '\\Sent': 'Sent', '\\Drafts': 'Drafts', '\\Trash': 'Trash', '\\Junk': 'Junk', '\\Archive': 'Archive' };
/** Special-use folders get the UI language's name (like Outlook); everything else keeps its server name. */
export const folderLabel = (f: { specialUse: string; name: string }) => (SPECIAL_NAMES[f.specialUse] ? t(SPECIAL_NAMES[f.specialUse]) : f.name);

export interface FolderNode extends Folder { children: FolderNode[]; depth: number }

export function buildTree(list: Folder[]): FolderNode[] {
  const byPath = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];
  const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) byPath.set(f.path, { ...f, children: [], depth: 0 });
  for (const n of byPath.values()) {
    const parentPath = n.delimiter ? n.path.split(n.delimiter).slice(0, -1).join(n.delimiter) : '';
    const parent = parentPath && byPath.get(parentPath);
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const rank = (f: Folder) => {
    const i = SPECIAL_ORDER.indexOf(f.specialUse);
    return i < 0 ? 100 : i;
  };
  const sortRec = (ns: FolderNode[], depth: number) => {
    ns.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    ns.forEach((n) => {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    });
  };
  sortRec(roots, 0);
  return roots;
}
