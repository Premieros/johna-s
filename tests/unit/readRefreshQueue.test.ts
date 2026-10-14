import { describe, expect, it, vi } from 'vitest';
import { createReadRefreshQueue } from '@/lib/readRefreshQueue';

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

describe('read refresh queue', () => {
  it('coalesces a burst into one active read and one trailing refresh', async () => {
    const first = deferred();
    const read = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const queue = createReadRefreshQueue(read);
    const pending = queue.request();
    await Promise.resolve();
    for (let i = 0; i < 25; i++) queue.request();
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve();
    await pending;
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('invalidates results and drops trailing work when its scope is removed', async () => {
    const first = deferred();
    let current!: () => boolean;
    const read = vi.fn((isCurrent) => { current = isCurrent; return first.promise; });
    const queue = createReadRefreshQueue(read);
    const pending = queue.request();
    await Promise.resolve();
    queue.request();
    queue.cancel();
    expect(current()).toBe(false);
    first.resolve();
    await pending;
    await queue.request();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('allows a later read after a failed request', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const queue = createReadRefreshQueue(read);
    await expect(queue.request()).rejects.toThrow('network');
    await queue.request();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
