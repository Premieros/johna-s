import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Clear scoped data before paint and ignore superseded or unmounted reads. */
export function useLatestRead<T>(read: (signal?: AbortSignal) => Promise<T>, delay = 0, enabled = true) {
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const activeRead = useRef<((signal?: AbortSignal) => Promise<T>) | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const reload = useCallback(async () => {
    if (!enabled || activeRead.current !== read) return;
    const current = ++generation.current;
    controller.current?.abort();
    const nextController = new AbortController(); controller.current = nextController;
    setLoading(true);
    setError(null);
    try {
      const result = await read(nextController.signal);
      if (current === generation.current) setData(result);
    } catch (failure) {
      if (current === generation.current) {
        setData(null);
        setError(failure);
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [read, enabled]);

  const invalidate = useCallback(() => { ++generation.current; controller.current?.abort(); }, []);

  useLayoutEffect(() => {
    activeRead.current = read;
    invalidate();
    setData(null);
    setError(null);
    setLoading(enabled);
    if (!enabled) return () => { activeRead.current = null; invalidate(); };
    const timer = window.setTimeout(() => { void reload(); }, delay);
    return () => {
      window.clearTimeout(timer);
      activeRead.current = null;
      invalidate();
    };
  }, [read, reload, delay, invalidate, enabled]);

  return { data, error, loading, reload };
}
