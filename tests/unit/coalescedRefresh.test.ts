import { describe, expect, it, vi } from 'vitest';
import { createRefreshCoalescer } from '@/lib/coalescedRefresh';

describe('coalesced refresh without stale result caching', () => {
  it('reduces ten overlapping requests to one read and one trailing refresh', async () => {
    const refresh = createRefreshCoalescer();
    let release = () => {};
    const read = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined);
    const first = refresh('user:branch:station', read, () => true);
    await Promise.resolve();
    for (let i = 0; i < 9; i++) expect(refresh('user:branch:station', read, () => true)).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    release(); await first;
    expect(read).toHaveBeenCalledTimes(2);
    await refresh('user:branch:station', read, () => true);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('keeps different scope reads separate and suppresses hidden trailing work', async () => {
    const refresh = createRefreshCoalescer(); let visible = true; let release = () => {};
    const read = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const first = refresh('branch-a', read, () => visible); await Promise.resolve();
    refresh('branch-a', read, () => visible);
    const other = vi.fn().mockResolvedValue(undefined);
    await refresh('branch-b', other, () => true);
    visible = false; release(); await first;
    await refresh('branch-a', read, () => visible);
    expect(read).toHaveBeenCalledTimes(1); expect(other).toHaveBeenCalledTimes(1);
  });
  it('does not retain a rejected read and permits retry', async () => {
    const refresh = createRefreshCoalescer(); const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await expect(refresh('a', read, () => true)).rejects.toThrow('offline');
    await refresh('a', read, () => true); expect(read).toHaveBeenCalledTimes(2);
  });
  it('discards a read if its scope becomes invalid before it starts', async () => {
    const refresh = createRefreshCoalescer(); let current = true; const read = vi.fn().mockResolvedValue(undefined);
    const pending = refresh('old-scope', read, () => current); current = false;
    await pending; expect(read).not.toHaveBeenCalled();
  });
});
