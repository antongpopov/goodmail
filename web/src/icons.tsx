// Small outline icon set in the spirit of Fluent UI (drawn here, 20×20, stroke = currentColor).
const P: Record<string, string> = {
  mail: 'M3 5.5h14v9H3z M3.5 6l6.5 5 6.5-5',
  compose: 'M4 16h3l8.5-8.5-3-3L4 13z M11 6l3 3 M4 16h12',
  trash: 'M4 5.5h12 M8 5.5V4h4v1.5 M5.5 5.5l.8 10.5h7.4l.8-10.5 M8.5 8.5v5 M11.5 8.5v5',
  archive: 'M3.5 4.5h13v3h-13z M4.5 7.5v8h11v-8 M8 10.5h4',
  move: 'M3 5h5l1.5 1.5H17v8.5H3z M10 9.5l2.5 2-2.5 2 M7 11.5h5.5',
  flag: 'M5 17V3.5 M5 4h9.5l-2 3.5 2 3.5H5',
  unread: 'M3 6h11v8.5H3z M3.5 6.5l5.5 4 5-4 M16 4.5a1.5 1.5 0 1 0 0.01 0',
  sync: 'M15.5 8A6 6 0 0 0 4.7 6.5 M4.5 3.5v3h3 M4.5 12a6 6 0 0 0 10.8 1.5 M15.5 16.5v-3h-3',
  reply: 'M8 5L3.5 9.5 8 14 M3.5 9.5H12a4.5 4.5 0 0 1 4.5 4.5v1',
  replyAll: 'M10 5L5.5 9.5 10 14 M6.5 5L2 9.5 6.5 14 M5.5 9.5H13a4 4 0 0 1 4 4v1.5',
  forward: 'M12 5l4.5 4.5L12 14 M16.5 9.5H8a4.5 4.5 0 0 0-4.5 4.5v1',
  search: 'M8.5 3.5a5 5 0 1 0 0.01 0 M12.2 12.2L16.5 16.5',
  chevronRight: 'M8 5l5 5-5 5',
  chevronDown: 'M5 8l5 5 5-5',
  inbox: 'M3.5 4.5h13v11h-13z M3.5 11h4l1 2h3l1-2h4',
  send: 'M3 10l14-6.5-5 13-2.5-5.5z M9.5 11L17 3.5',
  drafts: 'M5 3.5h7l3 3v10H5z M12 3.5v3h3 M7.5 10h5 M7.5 13h5',
  junk: 'M10 3a7 7 0 1 0 0.01 0 M5 5l10 10',
  folder: 'M3 5h5l1.5 1.5H17v8.5H3z',
  star: 'M10 3l2.1 4.4 4.8.6-3.5 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.1 8l4.8-.6z',
  clip: 'M14.5 9l-5.6 5.6a3 3 0 0 1-4.3-4.3L10.8 4a2 2 0 0 1 2.9 2.9l-6 6a1 1 0 0 1-1.4-1.4l5.3-5.3',
  menu: 'M3.5 5.5h13 M3.5 10h13 M3.5 14.5h13',
  signout: 'M8 4H4.5v12H8 M12 6.5l3.5 3.5-3.5 3.5 M15.5 10H8',
  image: 'M3.5 4.5h13v11h-13z M3.5 13l4-4 3 3 2-2 4 4 M13 7.5a.5.5 0 1 0 .01 0',
  close: 'M5 5l10 10 M15 5L5 15',
  plus: 'M10 4v12 M4 10h12',
  bold: 'M6 4h5a3 3 0 0 1 0 6H6z M6 10h6a3 3 0 0 1 0 6H6z',
  italic: 'M9 4h6 M5 16h6 M12 4l-4 12',
  underline: 'M6 4v6a4 4 0 0 0 8 0V4 M5 17h10',
  list: 'M8 5.5h9 M8 10h9 M8 14.5h9 M4 5.5h.5 M4 10h.5 M4 14.5h.5',
  link: 'M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2L10 5.8 M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1.1-1.1',
  more: 'M5 10h.01 M10 10h.01 M15 10h.01',
  people: 'M7.5 4a2.5 2.5 0 1 0 0.01 0 M3 16a4.5 4.5 0 0 1 9 0 M13.5 5a2 2 0 1 0 0.01 0 M13 11a3.5 3.5 0 0 1 4.5 4',
  lock: 'M5.5 9V6.5a4.5 4.5 0 0 1 9 0V9 M4 9h12v8H4z M10 12v2.5',
  shield: 'M10 3l6 2v4.5c0 3.7-2.5 6.3-6 7.5-3.5-1.2-6-3.8-6-7.5V5z M7.5 10l2 2 3.5-4',
  check: 'M4 10.5l4 4 8-9',
  sun: 'M10 6.5a3.5 3.5 0 1 0 .01 0 M10 2v1.5 M10 16.5V18 M2 10h1.5 M16.5 10H18 M4.3 4.3l1 1 M14.7 14.7l1 1 M4.3 15.7l1-1 M14.7 5.3l1-1',
  moon: 'M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z',
  auto: 'M10 3.5a6.5 6.5 0 1 0 .01 0 M10 3.5v13 M10 6l3-1.5 M10 9.5l5.5-2 M10 13l5.5-1',
  settings: 'M10 7.5a2.5 2.5 0 1 0 .01 0 M10 2.5l1.3 1.9 2.2-.6.4 2.3 2.1 1-1 2.1 1 2.1-2.1 1-.4 2.3-2.2-.6L10 17.5l-1.3-1.9-2.2.6-.4-2.3-2.1-1 1-2.1-1-2.1 2.1-1 .4-2.3 2.2.6z',
  import: 'M10 3v9 M6.5 8.5L10 12l3.5-3.5 M4 13.5v3h12v-3',
  export: 'M10 12V3 M6.5 6.5L10 3l3.5 3.5 M4 13.5v3h12v-3',
  calendar: 'M3.5 5h13v11.5h-13z M3.5 8.5h13 M7 3v3.5 M13 3v3.5 M6.5 11.5h2 M11.5 11.5h2 M6.5 14h2',
  clock: 'M10 3a7 7 0 1 0 .01 0 M10 6v4l2.5 2',
  pin: 'M10 17s5-4.6 5-9a5 5 0 0 0-10 0c0 4.4 5 9 5 9z M10 6.5a1.5 1.5 0 1 0 .01 0',
  pane: 'M3 4.5h14v11H3z M11 4.5v11',
  code: 'M7.5 6L3.5 10l4 4 M12.5 6l4 4-4 4 M11 4.5l-2 11',
};

export function Icon({ name, size = 20, filled = false }: { name: keyof typeof P | string; size?: number; filled?: boolean }) {
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={P[name] || P.folder} />
    </svg>
  );
}

export function folderIcon(specialUse: string) {
  return (
    { '\\Inbox': 'inbox', '\\Sent': 'send', '\\Drafts': 'drafts', '\\Trash': 'trash', '\\Junk': 'junk', '\\Archive': 'archive', '\\Flagged': 'flag', '\\All': 'mail' } as Record<string, string>
  )[specialUse] || 'folder';
}
