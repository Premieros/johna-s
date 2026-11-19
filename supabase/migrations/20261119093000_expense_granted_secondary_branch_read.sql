-- Restore expense listing for a user with both expenses.view and an
-- explicit user_branch_access grant on a non-primary branch.
--
-- The previous PERMISSIVE SELECT policy required history.unlimited for
-- every secondary-branch expense, so staff with expenses.view saw zero rows.
-- Historical visibility remains governed by the unchanged RESTRICTIVE
-- private.financial_row_visible(...) policy (recent rows full, older sampled).
-- No role grants, expense writes or journal changes.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $check$
DECLARE
  v_policy text;
BEGIN
  SELECT qual INTO v_policy
    FROM pg_policies
   WHERE schemaname='public' AND tablename='expenses'
     AND policyname='auth_select_expenses' AND cmd='SELECT'
     AND permissive='PERMISSIVE' AND roles='{authenticated}'::name[];

  IF v_policy IS DISTINCT FROM
     '(is_pos_admin() OR (branch_id = get_branch_id()) OR (can_permission(''expenses.view''::text) AND can_permission(''history.unlimited''::text) AND user_may_access_branch(branch_id)))' THEN
    RAISE EXCEPTION 'EXPENSE_READ_SECONDARY_BRANCH_POLICY_DRIFT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='expenses'
      AND policyname='financial_visibility_expenses'
      AND cmd='SELECT' AND permissive='RESTRICTIVE'
      AND roles='{authenticated}'::name[]
      AND qual='private.financial_row_visible(id, branch_id, created_at)'
  ) THEN
    RAISE EXCEPTION 'EXPENSE_FINANCIAL_VISIBILITY_POLICY_DRIFT';
  END IF;
END;
$check$;

ALTER POLICY auth_select_expenses ON public.expenses
  TO authenticated
  USING (
    public.is_pos_admin()
    OR branch_id = public.get_branch_id()
    OR (
      public.can_permission('expenses.view')
      AND public.user_may_access_branch(branch_id)
    )
  );
