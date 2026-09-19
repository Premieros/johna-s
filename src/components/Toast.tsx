import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { userFacingErrorMessage } from '@/lib/userFacingError';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

function normalizeToastMessage(message: string, type: ToastType): string {
  const text = String(message || '').trim();
  return type === 'error' ? userFacingErrorMessage(text) : text;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random();
    const normalizedMessage = normalizeToastMessage(message, type);
    setToasts((prev) => [...prev, { id, message: normalizedMessage, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const remove = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const icons = {
    success: <CheckCircle className="h-5 w-5 shrink-0 text-ui-success" />,
    error: <XCircle className="h-5 w-5 shrink-0 text-ui-danger" />,
    warning: <AlertCircle className="h-5 w-5 shrink-0 text-ui-warning" />,
    info: <Info className="h-5 w-5 shrink-0 text-ui-info" />,
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[80] mx-auto flex w-full max-w-[min(26rem,calc(100vw-0.75rem))] flex-col gap-2 px-2 sm:top-4 sm:px-0">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex min-w-0 items-start gap-2.5 rounded-xl bg-ui-surface px-3 py-2.5 shadow-ui-lg ring-1 ring-ui-border sm:items-center sm:gap-3 sm:px-4 sm:py-3 animate-slide-down"
          >
            {icons[toast.type]}
            <span className="min-w-0 flex-1 break-words text-xs leading-5 text-ui-text sm:text-sm">{toast.message}</span>
            <button onClick={() => remove(toast.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ui-subtle transition-colors hover:bg-ui-page-alt hover:text-ui-text" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
