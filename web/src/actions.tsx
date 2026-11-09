import { Icon } from './icons.tsx';

/** One mail action (delete, move, flag…). Defined once in App and rendered by the desktop toolbar, the message header and the phone toolbar. */
export interface Act {
  icon: string;
  label: string;
  /** Tooltip; defaults to the label. */
  title?: string;
  run: () => void;
  disabled?: boolean;
  filled?: boolean;
}

/** Icon + label, as on the desktop toolbar. */
export function TextBtn({ a }: { a: Act }) {
  return (
    <button className="tb" disabled={a.disabled} onClick={a.run} title={a.title || a.label}>
      <Icon name={a.icon} filled={a.filled} /> <span className="lbl">{a.label}</span>
    </button>
  );
}

/** Icon only, as in the message header. */
export function IconBtn({ a }: { a: Act }) {
  return (
    <button className="tb icon" disabled={a.disabled} onClick={a.run} title={a.title || a.label}>
      <Icon name={a.icon} filled={a.filled} />
    </button>
  );
}
