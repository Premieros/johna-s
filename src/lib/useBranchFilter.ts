import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useActiveBranchId } from './activeBranch';
import { useBranches } from '@/hooks/useBranches';

/**
 * Returns the single shared operational branch for the signed-in user.
 *
 * Branch visibility stays Permission/RLS-first: the selected branch must be
 * present in the branch list exposed by RLS/user_branch_access. Multi-branch
 * users are always pinned to one active branch (primary branch when possible,
 * otherwise the first accessible branch) so operational pages never widen to
 * mixed-branch data just because no local page filter was chosen.
 */
export function useBranchFilter(): string | null {
  const { user } = useAuth();
  const [activeBranchId, setActiveBranchId] = useActiveBranchId();
  const { branches, loading } = useBranches();
  const activeIsAccessible = !!activeBranchId && branches.some((branch) => branch.id === activeBranchId);
  const primaryIsAccessible = !!user?.branch_id && branches.some((branch) => branch.id === user.branch_id);
  const fallbackBranchId = primaryIsAccessible ? (user?.branch_id ?? null) : (branches[0]?.id ?? null);

  useEffect(() => {
    if (!user || loading || activeIsAccessible) return;
    setActiveBranchId(fallbackBranchId);
  }, [user, loading, activeIsAccessible, fallbackBranchId, setActiveBranchId]);

  if (!user) return null;
  if (activeIsAccessible) return activeBranchId;

  // Keep the primary branch while branch visibility is still loading so page
  // queries never temporarily widen their scope during authentication.
  if (loading) return user.branch_id || null;

  return fallbackBranchId;
}
