import { describe, expect, it, vi } from 'vitest';
import { createReportSourceCache } from '@/features/reporting/reportSourceCache';
import { fetchAllReportRows } from '@/features/reporting/fetchAllReportRows';

describe('bounded unified report source', () => {
  it('shares simultaneous reads and cached data between table and exports', async () => {
    const read = vi.fn().mockResolvedValue({ rows: [1] });
    const source = createReportSourceCache(read);
    const first = source.read();
    expect(source.read()).toBe(first);
    await first;
    await source.read();
    expect(read).toHaveBeenCalledTimes(1);
    await source.read({ from: '2026-01-01', to: '2026-01-31' });
    expect(read).toHaveBeenCalledTimes(2);
    source.dispose();
    expect(read.mock.calls[0][0].aborted).toBe(true);
  });
  it('does not cache failed reads and supports effect cleanup/remount', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue([1]);
    const source = createReportSourceCache(read);
    await expect(source.read()).rejects.toThrow('failed');
    await source.read();
    source.dispose();
    await source.read();
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('stops at the source limit without returning misleading partial totals', async () => {
    const range = vi.fn().mockImplementation((from: number, to: number) => Promise.resolve({ data: Array.from({ length: to - from + 1 }, (_, index) => index + from), error: null }));
    await expect(fetchAllReportRows({ range }, 2, undefined, 4)).rejects.toThrow('REPORT_SOURCE_LIMIT');
    expect(range.mock.calls).toEqual([[0, 1], [2, 3], [4, 4]]);
  });
});
