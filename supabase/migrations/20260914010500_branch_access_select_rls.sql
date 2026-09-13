-- Stabilization: allow an authenticated user to see every branch that the
-- canonical branch-access contract grants them, while preserving the existing
-- platform-admin and organization visibility rules.
--
-- This fixes the global branch selector for users assigned to more than one
-- branch through user_branch_access. It does not add a role-name bypass.

DROP POLICY IF EXISTS auth_select_branches ON public.branches;

CREATE POLICY auth_select_branches
ON public.branches
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR public.user_may_access_branch(id)
  OR organization_id IN (SELECT public.user_organization_ids())
);
