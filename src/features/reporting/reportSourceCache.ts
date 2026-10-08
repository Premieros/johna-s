/** Scope-local result reuse: no data survives a user/branch/filter change. */
export function createReportSourceCache<T>(read: (signal: AbortSignal, range?: { from: string; to: string }) => Promise<T>) {
  let controller = new AbortController();
  const results = new Map<string, Promise<T>>();
  return {
    read(range?: { from: string; to: string }): Promise<T> {
      controller.signal.throwIfAborted();
      const key = range ? `${range.from}:${range.to}` : 'current';
      const existing = results.get(key);
      if (existing) return existing;
      // Current data and at most two requested comparison periods.
      if (results.size >= 3) {
        const oldest = [...results.keys()].find(value => value !== 'current');
        if (oldest) results.delete(oldest);
      }
      const pending: Promise<T> = read(controller.signal, range).catch(error => { if (results.get(key) === pending) results.delete(key); throw error; });
      results.set(key, pending);
      return pending;
    },
    dispose() { controller.abort(); results.clear(); controller = new AbortController(); },
  };
}
