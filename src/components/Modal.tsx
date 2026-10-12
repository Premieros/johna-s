import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { acquireModalScrollLock } from '@/lib/modalScrollLock';
import { X } from 'lucide-react';

interface ModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}

const sizes = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  '2xl': 'sm:max-w-6xl',
};

export function Modal({ open, isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const isModalOpen = open ?? isOpen ?? false;
  const modalRef = useRef<HTMLDivElement>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isModalOpen) return;
    const lock = acquireModalScrollLock();
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && lock.isTop()) {
        event.stopImmediatePropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      lock.release();
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isModalOpen]);

  if (!isModalOpen) return null;

  return createPortal(
    <div data-testid="modal-root" className="fixed inset-0 z-[70] flex items-end justify-center p-0 animate-fade-in sm:items-center sm:p-4">
      <div data-testid="modal-backdrop" className="absolute inset-0 bg-ui-text/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={modalRef}
        data-testid="modal-panel"
        className={`relative flex h-[min(92dvh,760px)] max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl liquid-glass-card shadow-2xl animate-scale-in sm:h-auto sm:max-h-[90dvh] sm:rounded-ui-xl ${sizes[size]}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div data-testid="modal-header" className="sticky top-0 z-10 flex min-h-14 shrink-0 items-center justify-between border-b border-ui-border bg-ui-surface/95 px-4 py-2.5 backdrop-blur sm:static sm:min-h-0 sm:bg-transparent sm:px-6 sm:py-4">
          <h2 className="min-w-0 truncate pe-3 text-base font-bold tracking-tight text-ui-text sm:text-lg">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui text-ui-subtle transition-colors hover:bg-ui-page-alt hover:text-ui-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring sm:h-8 sm:w-8"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div data-testid="modal-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain [touch-action:pan-x_pan-y_pinch-zoom] [-webkit-overflow-scrolling:touch] px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
