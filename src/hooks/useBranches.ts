import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import type { Branch } from '@/lib/types';
import { userFacingErrorMessage } from '@/lib/userFacingError';

const BRANCHES_CHANGED_EVENT = 'premier:branches-changed';
const branchCacheByUser = new Map<string, Branch[]>();
const branchRequestByUser = new Map<string, Promise<Branch[]>>();

async function fetchBranchesForUser(userId: string, force = false): Promise<Branch[]> {
  const cached = branchCacheByUser.get(userId);
  if (!force && cached !== undefined) return cached;

  const existing = branchRequestByUser.get(userId);
  if (existing) return existing;

  const pending = supabase.from('branches').select('*').order('name')
    .then(({ data, error }) => {
      if (error) throw error;
      const next = (data as Branch[]) || [];
      branchCacheByUser.set(userId, next);
      return next;
    })
    .finally(() => {
      branchRequestByUser.delete(userId);
    });

  branchRequestByUser.set(userId, pending);
  return pending;
}

export function notifyBranchesChanged(): void {
  branchCacheByUser.clear();
  branchRequestByUser.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BRANCHES_CHANGED_EVENT));
  }
}

export function useBranches() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const cached = userId ? branchCacheByUser.get(userId) : undefined;
  const [branches, setBranches] = useState<Branch[]>(cached ?? []);
  const [loading, setLoading] = useState(Boolean(userId) && cached === undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setBranches([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(branchCacheByUser.get(userId) === undefined);
    try {
      const next = await fetchBranchesForUser(userId, true);
      setBranches(next);
      setError(null);
    } catch (error) {
      setBranches([]);
      setError(userFacingErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setBranches([]);
      setLoading(false);
      setError(null);
      return;
    }

    const sessionCached = branchCacheByUser.get(userId);
    if (sessionCached !== undefined) {
      setBranches(sessionCached);
      setLoading(false);
      setError(null);
    } else {
      void refresh();
    }

    if (typeof window === 'undefined') return;
    const onBranchesChanged = () => {
      branchCacheByUser.delete(userId);
      void refresh();
    };
    window.addEventListener(BRANCHES_CHANGED_EVENT, onBranchesChanged);
    return () => window.removeEventListener(BRANCHES_CHANGED_EVENT, onBranchesChanged);
  }, [refresh, userId]);

  return { branches, loading, error, refresh };
}
