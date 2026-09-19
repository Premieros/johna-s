-- Restore branch isolation for raw-material reads.
--
-- Historical auth_select_raw_materials used USING (true), which is permissive
-- and therefore OR-ed with all other SELECT policies. That exposed raw
-- materials from every branch to any authenticated user.
--
-- Keep the existing broad same-branch read behavior; do not add a new
-- permission requirement here. Super Admin remains the only implicit bypass.

DROP POLICY IF EXISTS auth_select_raw_materials ON public.raw_materials;

CREATE POLICY auth_select_raw_materials
ON public.raw_materials
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR public.user_may_access_branch(branch_id)
);
