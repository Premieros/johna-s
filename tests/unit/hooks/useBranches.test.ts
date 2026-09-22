import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

interface BranchRow { id: string; name: string; is_active: boolean }

const mockState = vi.hoisted(() => ({
  data: [] as BranchRow[],
  error: null as string | null,
  calls: 0,
}));

const mockAuth = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
}));

const mockSupabase = vi.hoisted(() => ({
  from: () => ({
    select: () => ({
      order: () => new Promise((resolve) => {
        mockState.calls += 1;
        if (mockState.error) {
          resolve({ data: null, error: { message: mockState.error } });
        } else {
          resolve({ data: mockState.data, error: null });
        }
      }),
    }),
  }),
}));

vi.mock('@/api', () => ({ supabase: mockSupabase }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockAuth.userId ? { id: mockAuth.userId } : null }),
}));

// Reset the module registry before every test so each test observes a fresh
// per-user branch cache and cannot inherit module state from a previous test.
beforeEach(() => {
  mockState.data = [];
  mockState.error = null;
  mockState.calls = 0;
  mockAuth.userId = 'user-1';
  vi.resetModules();
});

async function loadUseBranches() {
  const { useBranches } = await import('@/hooks/useBranches');
  return useBranches;
}

describe('useBranches', () => {
  it('fetches branches once on mount and returns them', async () => {
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }, { id: 'b2', name: 'Branch 2', is_active: false }];
    const useBranches = await loadUseBranches();
    const { result } = renderHook(() => useBranches());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.branches).toHaveLength(2);
    expect(result.current.error).toBeNull();
    expect(mockState.calls).toBe(1);
  });

  it('coalesces concurrent mounts for the same user into one branch request', async () => {
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }];
    const useBranches = await loadUseBranches();

    const first = renderHook(() => useBranches());
    const second = renderHook(() => useBranches());

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(first.result.current.branches[0]?.id).toBe('b1');
    expect(second.result.current.branches[0]?.id).toBe('b1');
    expect(mockState.calls).toBe(1);
  });

  it('reuses cache for the same user but refetches for a different user', async () => {
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }];
    const useBranches = await loadUseBranches();
    const first = renderHook(() => useBranches());
    await waitFor(() => expect(first.result.current.branches[0]?.id).toBe('b1'));
    expect(mockState.calls).toBe(1);

    mockState.data = [{ id: 'b2', name: 'Branch 2', is_active: true }];
    const sameUser = renderHook(() => useBranches());
    expect(sameUser.result.current.branches[0]?.id).toBe('b1');
    expect(mockState.calls).toBe(1);

    mockAuth.userId = 'user-2';
    const differentUser = renderHook(() => useBranches());
    await waitFor(() => expect(differentUser.result.current.branches[0]?.id).toBe('b2'));
    expect(mockState.calls).toBe(2);
  });

  it('refresh re-fetches and updates the current user cache', async () => {
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }];
    const useBranches = await loadUseBranches();
    const { result } = renderHook(() => useBranches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }, { id: 'b2', name: 'Branch 2', is_active: true }];
    await act(async () => { await result.current.refresh(); });

    expect(result.current.branches).toHaveLength(2);
    expect(mockState.calls).toBe(2);
  });

  it('surfaces the fetch error and clears it on a later successful refresh', async () => {
    mockState.error = 'connection refused';
    const useBranches = await loadUseBranches();
    const { result } = renderHook(() => useBranches());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain('تعذر الاتصال بالخادم');
    expect(result.current.branches).toEqual([]);

    mockState.error = null;
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }];
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.branches).toHaveLength(1);
  });
});
