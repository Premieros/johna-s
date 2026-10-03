import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';

type ProgressContextValue = {
  begin: () => void;
  complete: () => void;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function PageLoadProgressProvider({ children }: { children: ReactNode }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const activeLoads = useRef(0);
  const tickTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearTick = useCallback(() => {
    if (tickTimer.current !== null) {
      window.clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
  }, []);

  const clearHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const begin = useCallback(() => {
    activeLoads.current += 1;
    if (activeLoads.current > 1) return;

    clearHide();
    clearTick();
    setVisible(true);
    setProgress(0);

    window.requestAnimationFrame(() => {
      setProgress(8);
    });

    tickTimer.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return current;
        const remaining = 92 - current;
        const next = current + Math.max(1, remaining * 0.16);
        return Math.min(92, next);
      });
    }, 85);
  }, [clearHide, clearTick]);

  const complete = useCallback(() => {
    activeLoads.current = Math.max(0, activeLoads.current - 1);
    if (activeLoads.current > 0) return;

    clearTick();
    setProgress(100);
    clearHide();
    hideTimer.current = window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 180);
  }, [clearHide, clearTick]);

  useEffect(() => () => {
    clearTick();
    clearHide();
  }, [clearHide, clearTick]);

  const value = useMemo(() => ({ begin, complete }), [begin, complete]);

  return (
    <ProgressContext.Provider value={value}>
      {children}
      {visible && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-ui-page/95 px-6 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-label={ar ? 'جارٍ تحميل الصفحة' : 'Loading page'}
          data-testid="page-progress-loader"
        >
          <div className="w-full max-w-md rounded-3xl border border-ui-border bg-ui-surface p-6 shadow-ui-lg">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-base font-black text-ui-text">
                  {ar ? 'جارٍ تجهيز الصفحة' : 'Preparing your page'}
                </p>
                <p className="mt-1 text-sm text-ui-muted">
                  {ar ? 'النظام يعمل، لحظات ويتم عرض المحتوى.' : 'The system is working. Your content will appear shortly.'}
                </p>
              </div>
              <span className="min-w-16 text-end text-2xl font-black tabular-nums text-ui-primary">
                {Math.round(progress)}%
              </span>
            </div>

            <div
              className="mt-5 h-2.5 overflow-hidden rounded-full bg-ui-page-alt"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-ui-primary transition-[width] duration-150 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </ProgressContext.Provider>
  );
}

export function PageLoadFallback() {
  const context = useContext(ProgressContext);

  useEffect(() => {
    context?.begin();
    return () => context?.complete();
  }, [context]);

  return <div className="min-h-screen bg-ui-page" data-testid="page-load-fallback" aria-hidden="true" />;
}
