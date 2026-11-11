import { useEffect, useRef } from 'react';

/** A native tickbox that also shows the "some selected" state. It drops focus after a click so the list shortcuts keep working. */
export function SelectBox({ checked, indeterminate = false, label, className = '', disabled, onChange }: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  className?: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={`selbox ${className}`}
      checked={checked}
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        onChange();
        e.currentTarget.blur();
      }}
    />
  );
}
