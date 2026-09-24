import { type ReactNode, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useBranches } from '@/hooks/useBranches';
import { useActiveBranchId } from '@/lib/activeBranch';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';
import { WorkAuthorizationGate } from './WorkAuthorizationGate';
import { createSupabaseWorkAuthorizationClient } from './supabaseWorkAuthorizationProvider';

const WORK_AUTHORIZATION_GATE_ENABLED =
  import.meta.env.VITE_WORK_AUTHORIZATION_GATE === '1';

function EnabledWorkAuthorizationBoundary({ children }: { children: ReactNode }) {
  const { session, user, loading, signOut } = useAuth();
  const can = useCan();
  const location = useLocation();
  const branchId = useBranchFilter();
  const { branches, loading: branchesLoading } = useBranches();
  const [, setActiveBranchId] = useActiveBranchId();
  const client = useMemo(() => createSupabaseWorkAuthorizationClient(), []);

  if (loading || !session || !user) return <>{children}</>;

  // A work-authorization approver may always reach the approval center itself,
  // even while their own work authorization is pending. This avoids a deadlock
  // without opening any other operational screen.
  if (
    location.pathname === APP_ROUTES.approvals
    && can('work.authorization.approve')
  ) {
    return <>{children}</>;
  }

  if (branchesLoading && !branchId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ui-page">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-ui-primary" />
      </div>
    );
  }

  if (!branchId) return <>{children}</>;

  const activeBranch = branches.find((branch) => branch.id === branchId);

  return (
    <WorkAuthorizationGate
      client={client}
      branchId={branchId}
      branchName={activeBranch?.name || null}
      branchOptions={branches.map((branch) => ({ id: branch.id, name: branch.name }))}
      onBranchChange={setActiveBranchId}
      onSignOut={signOut}
    >
      {children}
    </WorkAuthorizationGate>
  );
}

export function WorkAuthorizationAppBoundary({ children }: { children: ReactNode }) {
  if (!WORK_AUTHORIZATION_GATE_ENABLED) return <>{children}</>;
  return <EnabledWorkAuthorizationBoundary>{children}</EnabledWorkAuthorizationBoundary>;
}
