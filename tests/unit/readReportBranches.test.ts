import { describe, expect, it, vi } from 'vitest';
import { readReportBranches } from '@/features/reporting/services/readReportBranches';
describe('branch report capacity and completeness', () => {
  it('waits for one branch before starting the next and retains result order', async () => {
    let finish!: (value: string) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; })).mockResolvedValueOnce('B');
    const pending = readReportBranches(['a', 'b'], read);
    expect(read.mock.calls).toEqual([['a']]); finish('A');
    expect(await pending).toEqual(['A', 'B']); expect(read.mock.calls).toEqual([['a'], ['b']]);
  });
  it('stops stale follow-up reads and rejects failed reports without partial output', async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => { controller.abort(); return 'old'; });
    await expect(readReportBranches(['a', 'b'], read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledOnce();
    const failed = vi.fn().mockResolvedValueOnce('A').mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('C');
    await expect(readReportBranches(['a', 'b', 'c'], failed)).rejects.toThrow('timeout'); expect(failed).toHaveBeenCalledTimes(2);
  });
});
