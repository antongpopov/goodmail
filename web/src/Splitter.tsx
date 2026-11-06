import { save } from './util.ts';
import { t } from './i18n.ts';

/** Drag handle between two panes; resizes the pane before it (left, or above for axis="y"). Double-click resets. */
export function Splitter({ width, min, max, onChange, storeKey, axis = 'x' }: { width: number; min: number; max: number; onChange: (w: number) => void; storeKey: string; axis?: 'x' | 'y' }) {
  const defaults: Record<string, number> = { folderW: 220, listW: 380, listH: 300 };
  const pos = (e: { clientX: number; clientY: number }) => (axis === 'x' ? e.clientX : e.clientY);
  return (
    <div
      className={`splitter ${axis === 'y' ? 'h' : ''}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      title={t('Drag to resize · double-click to reset')}
      onDoubleClick={() => {
        onChange(defaults[storeKey]);
        save(storeKey, defaults[storeKey]);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        document.body.classList.add(axis === 'x' ? 'resizing' : 'resizing-h');
        const startX = pos(e);
        let w = width;
        const move = (ev: PointerEvent) => {
          w = Math.round(Math.min(max, Math.max(min, width + pos(ev) - startX)));
          onChange(w);
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          el.classList.remove('dragging');
          document.body.classList.remove('resizing', 'resizing-h');
          save(storeKey, w);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    />
  );
}
