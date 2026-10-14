// One active read and one trailing refresh per mounted scope. Never use for writes.
export function createReadRefreshQueue(read: (isCurrent: () => boolean) => Promise<void>) {
  let active: Promise<void> | null = null;
  let dirty = false;
  let cancelled = false;
  const request = (): Promise<void> => {
    if (cancelled) return Promise.resolve();
    dirty = true;
    if (!active) {
      active = Promise.resolve().then(async () => {
        while (dirty && !cancelled) {
          dirty = false;
          await read(() => !cancelled);
        }
      }).finally(() => { active = null; });
    }
    return active;
  };
  return { request, cancel: () => { cancelled = true; dirty = false; } };
}
