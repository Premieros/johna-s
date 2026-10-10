import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const requests: Array<{ branchId: string; limit: number }> = [];
  let notifyAuthChange: (() => void) | undefined;
  let pending: Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = [];
  const from = vi.fn(() => ({
    select: () => ({
      eq: (_column: string, branchId: string) => ({
        order: () => ({
          limit: (limit: number) => {
            requests.push({ branchId, limit });
            return new Promise((resolve, reject) => pending.push({ resolve, reject }));
          },
        }),
      }),
    }),
  }));
  return { requests, from, get pending() { return pending; }, onAuthStateChange: vi.fn((callback: () => void) => { notifyAuthChange = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }), authChanged: () => notifyAuthChange?.(), reset: () => { requests.length = 0; pending = []; from.mockClear(); notifyAuthChange?.(); } };
});

vi.mock('@/api', () => ({
  supabase: { from: mocks.from, auth: { onAuthStateChange: mocks.onAuthStateChange } },
  pos: {},
  shifts: {},
}));

// Queue reads and print dispatch are separate modules; no printer is invoked in these tests.
vi.mock('../../src/features/pos/services/localPrintAgent', () => ({
  buildKitchenFixedTemplate: vi.fn(),
  buildStationTicketText: vi.fn(),
  groupKitchenItemsByStation: vi.fn(),
}));

import { listCloudPrintQueue } from '../../src/features/pos/services/cloudPrint';

describe('cloud print list concurrent read capacity', () => {
  beforeEach(() => mocks.reset());

  it('shares the same in-flight branch/limit read and reads again after completion', async () => {
    const one = listCloudPrintQueue('branch-a', 100);
    const two = listCloudPrintQueue('branch-a', 100);
    expect(one).toBe(two);
    expect(mocks.requests).toEqual([{ branchId: 'branch-a', limit: 100 }]);
    const rows = [{ id: 'job-1' }];
    mocks.pending[0].resolve({ data: rows, error: null });
    expect(await one).toEqual(rows);
    const after = listCloudPrintQueue('branch-a', 100);
    expect(mocks.requests).toHaveLength(2);
    mocks.pending[1].resolve({ data: [], error: null });
    expect(await after).toEqual([]);
  });

  it('never shares reads across branches or different bounded limits', async () => {
    const first = listCloudPrintQueue('branch-a', 100);
    const second = listCloudPrintQueue('branch-b', 100);
    const third = listCloudPrintQueue('branch-a', 200);
    expect(mocks.requests).toHaveLength(3);
    mocks.pending.forEach((request) => request.resolve({ data: [], error: null }));
    await Promise.all([first, second, third]);
  });


  it('does not reuse an in-flight queue response across authentication changes', async () => {
    const previousUser = listCloudPrintQueue('branch-a', 100);
    mocks.authChanged();
    const nextUser = listCloudPrintQueue('branch-a', 100);
    expect(mocks.requests).toHaveLength(2);
    expect(previousUser).not.toBe(nextUser);
    mocks.pending[0].resolve({ data: [{ id: 'previous-user-job' }], error: null });
    mocks.pending[1].resolve({ data: [{ id: 'next-user-job' }], error: null });
    expect(await previousUser).toEqual([{ id: 'previous-user-job' }]);
    expect(await nextUser).toEqual([{ id: 'next-user-job' }]);
  });

  it('does not cache failure; next caller retries database', async () => {
    const first = listCloudPrintQueue('branch-c');
    const second = listCloudPrintQueue('branch-c');
    const failure = new Error('timeout');
    mocks.pending[0].reject(failure);
    await expect(first).rejects.toThrow('timeout');
    await expect(second).rejects.toThrow('timeout');
    const retry = listCloudPrintQueue('branch-c');
    expect(mocks.requests).toHaveLength(2);
    mocks.pending[1].resolve({ data: [], error: null });
    await expect(retry).resolves.toEqual([]);
  });
});
