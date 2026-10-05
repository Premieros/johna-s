import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Clear scoped data before paint and ignore superseded or unmounted reads. */
export function useLatestRead<T>(read: () => Promise<T>, delay = 0) {
  const generation = useRef(0);
  const activeRead = useRef<(() => Promise<T>) | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (activeRead.current !== read) return;
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await read();
      if (current === generation.current) setData(result);
    } catch (failure) {
      if (current === generation.current) {
        setData(null);
        setError(failure);
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [read]);

  const invalidate = useCallback(() => { ++generation.current; }, []);

  useLayoutEffect(() => {
    activeRead.current = read;
    invalidate();
    setData(null);
    setError(null);
    setLoading(true);
    const timer = window.setTimeout(() => { void reload(); }, delay);
    return () => {
      window.clearTimeout(timer);
      activeRead.current = null;
      invalidate();
    };
  }, [read, reload, delay, invalidate]);

  return { data, error, loading, reload };
}
