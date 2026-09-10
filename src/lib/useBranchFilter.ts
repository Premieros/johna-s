import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useActiveBranchId } from './activeBranch';
import { useBranches } from '@/hooks/useBranches';

/**
 * Uses the shared selected branch when it is one of the branches visible
 * through RLS/user_branch_access.
 *
 * Branch visibility is Permission/RLS-first: when the signed-in user can see
 * more than one branch and has not selected a specific branch, `null` means
 * "all accessible branches". When only one branch is accessible we scope to
 * it automatically. No role-name shortcut is used here.
 */
export function useBranchFilter(): string | null {
  const { user } = useAuth();
  const [activeBranchId, setActiveBranchId] = useActiveBranchId();
  const { branches, loading } = useBranches();
  const activeIsAccessible = !!activeBranchId && branches.some((branch) => branch.id === activeBranchId);

  useEffect(() => {
    if (!loading && activeBranchId && !activeIsAccessible) setActiveBranchId(null);
  }, [activeBranchId, activeIsAccessible, loading, setActiveBranchId]);

  if (!user) return null;
  if (activeIsAccessible) return activeBranchId;

  // Keep the primary branch while branch visibility is still loading so page
  // queries do not temporarily widen their scope during authentication.
  if (loading) return user.branch_id || null;

  if (branches.length === 1) return branches[0].id;

  // RLS remains the authority for which rows are visible. Returning null for
  // 2+ accessible branches lets multi-branch users work across every branch
  // they are explicitly allowed to access instead of being pinned to the
  // primary branch.
  return null;
}
