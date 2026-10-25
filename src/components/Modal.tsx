import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useUi } from '../state/ui';

export function Modal({ title, subtitle, children, wide, onClose }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = onClose ?? (() => useUi.getState().close());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal${wide ? ' wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
