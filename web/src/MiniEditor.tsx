import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

/** A small rich-text box (bold / italic / underline / link, or raw HTML) used for signatures and templates. */
export function MiniEditor({ value, onChange, minHeight = 110 }: { value: string; onChange: (html: string) => void; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [raw, setRaw] = useState(false);
  const last = useRef<string | null>(null);

  // load `value` into the box when it changes from outside (a different account / template was picked)
  useEffect(() => {
    if (ref.current && value !== last.current) {
      ref.current.innerHTML = DOMPurify.sanitize(value);
      last.current = value;
    }
  }, [value, raw]);

  const emit = () => {
    const html = DOMPurify.sanitize(ref.current?.innerHTML || '');
    last.current = html;
    onChange(html === '<br>' ? '' : html);
  };
  const cmd = (c: string, v?: string) => {
    document.execCommand(c, false, v);
    ref.current?.focus();
    emit();
  };

  return (
    <div className="mini-editor">
      <div className="mini-bar">
        {!raw && (
          <>
            <button type="button" className="tb icon" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')} title={t('Bold')}><Icon name="bold" /></button>
            <button type="button" className="tb icon" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')} title={t('Italic')}><Icon name="italic" /></button>
            <button type="button" className="tb icon" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('underline')} title={t('Underline')}><Icon name="underline" /></button>
            <button
              type="button"
              className="tb icon"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const url = prompt(t('Link address'));
                if (url && /^(https?:|mailto:)/i.test(url)) cmd('createLink', url);
              }}
              title={t('Insert link')}
            >
              <Icon name="link" />
            </button>
          </>
        )}
        <span className="grow" />
        <button type="button" className={`link-btn ${raw ? 'on' : ''}`} onClick={() => setRaw(!raw)}>{raw ? t('Visual editor') : t('Edit as HTML')}</button>
      </div>
      {raw ? (
        <textarea className="mini-raw" style={{ minHeight }} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div ref={ref} className="mini-box" style={{ minHeight }} contentEditable suppressContentEditableWarning spellCheck onInput={emit} onBlur={emit} />
      )}
    </div>
  );
}
