import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import type { Branch } from '@/lib/types';
import { userFacingErrorMessage } from '@/lib/userFacingError';

const BRANCHES_CHANGED_EVENT = 'premier:branches-changed';
const branchCacheByUser = new Map<string, Branch[]>();
const branchRequestByUser = new Map<string, Promise<Branch[]>>();
const branchFetchedAtByUser = new Map<string, number>();
const RESUME_REFRESH_INTERVAL_MS = 30_000;

async function fetchBranchesForUser(userId: string, force = false): Promise<Branch[]> {
  const cached = branchCacheByUser.get(userId);
  if (!force && cached !== undefined) return cached;

  const existing = branchRequestByUser.get(userId);
  if (existing) return existing;

  const pending = (async () => {
    const { data, error } = await supabase.from('branches').select('*').order('name');
    if (error) throw error;
    const rows = (data as Branch[]) || [];
    // Preserve identity when nothing changed: consumers must not reload reports
    // or operational data just because the window regained focus.
    const previous = branchCacheByUser.get(userId);
    const next = previous && JSON.stringify(previous) === JSON.stringify(rows) ? previous : rows;
    branchCacheByUser.set(userId, next);
    branchFetchedAtByUser.set(userId, Date.now());
    return next;
  })().finally(() => {
    branchRequestByUser.delete(userId);
  });

  branchRequestByUser.set(userId, pending);
  return pending;
}

export function notifyBranchesChanged(): void {
  branchCacheByUser.clear();
  branchFetchedAtByUser.clear();
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
      // A temporary background network error must not switch an active POS
      // branch or clear a user's current work. RLS remains authoritative.
      setBranches(branchCacheByUser.get(userId) ?? []);
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
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - (branchFetchedAtByUser.get(userId) ?? 0) < RESUME_REFRESH_INTERVAL_MS) return;
      void refresh();
    };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.removeEventListener(BRANCHES_CHANGED_EVENT, onBranchesChanged);
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [refresh, userId]);

  return { branches, loading, error, refresh };
}
