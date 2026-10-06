import { describe, expect, it, vi } from 'vitest';
import { fetchAllReportRows } from '@/features/reporting/fetchAllReportRows';
describe('complete report read cancellation', () => {
  it('stops before requesting another export page when its scope is invalidated', async () => {
    const controller = new AbortController();
    const range = vi.fn(async () => { controller.abort(); return { data: [1,2], error: null }; });
    await expect(fetchAllReportRows({ range }, 2, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(range).toHaveBeenCalledTimes(1);
  });
  it('passes cancellation to the HTTP builder and never starts an already aborted read', async () => {
    const controller = new AbortController(); controller.abort();
    const range = vi.fn(); const abortSignal = vi.fn().mockReturnValue({ range });
    await expect(fetchAllReportRows({ range, abortSignal }, 1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(abortSignal).toHaveBeenCalledWith(controller.signal); expect(range).not.toHaveBeenCalled();
  });
});
