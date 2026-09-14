import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useBranches } from '@/hooks/useBranches';
import { useActiveBranchId } from '@/lib/activeBranch';
import type { Branch } from '@/lib/types';

type V2BranchContextValue = {
  branches: Branch[];
  selectedBranchId: string | null;
  selectedBranch: Branch | null;
  setSelectedBranchId: (branchId: string) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const V2BranchContext = createContext<V2BranchContextValue | null>(null);

export function V2BranchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { branches, loading, error, refresh } = useBranches();
  const [selectedBranchId, setActiveBranchId] = useActiveBranchId();

  useEffect(() => {
    if (!user?.id) {
      setActiveBranchId(null);
      return;
    }
    if (branches.length === 0) {
      if (!loading) setActiveBranchId(null);
      return;
    }

    const allowedIds = new Set(branches.map((branch) => branch.id));
    if (selectedBranchId && allowedIds.has(selectedBranchId)) return;
    const fallback = user.branch_id && allowedIds.has(user.branch_id) ? user.branch_id : branches[0].id;
    setActiveBranchId(fallback);
  }, [branches, loading, selectedBranchId, setActiveBranchId, user?.id, user?.branch_id]);

  const setSelectedBranchId = useCallback((branchId: string) => {
    if (!user?.id) return;
    if (!branches.some((branch) => branch.id === branchId)) return;
    setActiveBranchId(branchId);
  }, [branches, setActiveBranchId, user?.id]);

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const value = useMemo<V2BranchContextValue>(() => ({
    branches,
    selectedBranchId,
    selectedBranch,
    setSelectedBranchId,
    loading,
    error,
    refresh,
  }), [branches, selectedBranchId, selectedBranch, setSelectedBranchId, loading, error, refresh]);

  return <V2BranchContext.Provider value={value}>{children}</V2BranchContext.Provider>;
}

export function useV2Branch(): V2BranchContextValue {
  const value = useContext(V2BranchContext);
  if (!value) throw new Error('useV2Branch must be used inside V2BranchProvider');
  return value;
}
