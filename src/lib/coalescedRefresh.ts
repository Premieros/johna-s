/** Share an active read and retain one trailing read for events arriving during it.
 * No result cache: later refreshes always read again, including after mutations.
 */
export function createRefreshCoalescer() {
  const cycles = new Map<string, { promise: Promise<void>; trailing: boolean }>();
  return (key: string, read: () => Promise<void>, canRead: () => boolean): Promise<void> => {
    if (!canRead()) return Promise.resolve();
    const existing = cycles.get(key);
    if (existing) {
      existing.trailing = true;
      return existing.promise;
    }
    const cycle = { promise: Promise.resolve(), trailing: false };
    cycles.set(key, cycle);
    cycle.promise = Promise.resolve().then(async () => {
      do {
        cycle.trailing = false;
        if (!canRead()) return;
        await read();
      } while (cycle.trailing && canRead());
    }).finally(() => {
      if (cycles.get(key) === cycle) cycles.delete(key);
    });
    return cycle.promise;
  };
}
