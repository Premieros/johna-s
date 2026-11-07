-- Restore expense-report visibility to permissioned owners of multiple branches.
-- Regression: an owner with expenses.view + history.unlimited and an explicit
-- secondary-branch grant could see that branch's purchases but its posted
-- expense summary returned zero. The original SELECT policy checked only the
-- user's primary branch (or platform super_admin).
--
-- READ ONLY policy change. Do not alter posted expenses, accounting journals,
-- RLS historical visibility sampling, grants, or any write policy.
-- Safe rollout: brief transactional ALTER POLICY; fail if policy drifted or
-- table lock is unavailable within 2 seconds. Requires separate production approval.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $check$
DECLARE
  v_policy text;
BEGIN
  SELECT qual INTO v_policy
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename='expenses'
    AND policyname='auth_select_expenses'
    AND cmd='SELECT'
    AND permissive='PERMISSIVE'
    AND roles='{authenticated}'::name[];

  IF v_policy IS DISTINCT FROM '(is_pos_admin() OR (branch_id = get_branch_id()))' THEN
    RAISE EXCEPTION 'EXPENSE_READ_POLICY_DRIFT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='expenses'
      AND policyname='financial_visibility_expenses'
      AND cmd='SELECT'
      AND permissive='RESTRICTIVE'
      AND roles='{authenticated}'::name[]
  ) THEN
    RAISE EXCEPTION 'EXPENSE_FINANCIAL_HISTORY_POLICY_MISSING';
  END IF;
END
$check$;

ALTER POLICY auth_select_expenses ON public.expenses
  TO authenticated
  USING (
    public.is_pos_admin()
    OR branch_id = public.get_branch_id()
    OR (
      public.can_permission('expenses.view')
      AND public.can_permission('history.unlimited')
      AND public.user_may_access_branch(branch_id)
    )
  );

COMMIT;
