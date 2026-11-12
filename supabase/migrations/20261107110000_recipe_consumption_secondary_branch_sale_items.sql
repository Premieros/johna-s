-- Let authorized full-history costing users read invoiced products in their
-- explicitly accessible secondary branches. Report data is already computed
-- from sold quantities, returns, active recipes, wastage, yields, and latest
-- approved material prices; the old sale_items RLS hid all secondary-branch
-- lines, silently producing a falsely "complete" zero-consumption summary.
--
-- SELECT-policy-only change. Retain the existing primary-branch/platform
-- access semantics and all RESTRICTIVE financial history/tenant protection.
-- No stock, sale, recipe, price, journal, refund, print or Realtime writes.
-- Apply in a short transaction; separate explicit production authorization.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='sale_items'
      AND policyname='auth_select_sale_items'
      AND cmd='SELECT' AND permissive='PERMISSIVE'
      AND roles='{authenticated}'::name[]
      AND md5(qual)='9c4f4854d082cb43db3bcb630204c1a2'
  ) THEN RAISE EXCEPTION 'SALE_ITEM_READ_POLICY_DRIFT'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='sale_items'
      AND policyname='financial_visibility_sale_items'
      AND cmd='SELECT' AND permissive='RESTRICTIVE'
      AND roles='{authenticated}'::name[]
      AND md5(qual)='bee50803b2891b18d051889f218753b5'
  ) THEN RAISE EXCEPTION 'SALE_ITEM_FINANCIAL_VISIBILITY_POLICY_DRIFT'; END IF;
END
$guard$;

ALTER POLICY auth_select_sale_items ON public.sale_items
  TO authenticated
  USING (
    (SELECT public.is_pos_admin())
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id=sale_items.sale_id
        AND (
          s.branch_id=(SELECT public.get_branch_id())
          OR s.branch_id IS NULL
          OR (
            (SELECT public.can_permission('reports.view'))
            AND (SELECT public.can_permission('reports.costing'))
            AND (SELECT public.can_permission('history.unlimited'))
            AND (SELECT public.can_permission('sales.view'))
            AND public.user_may_access_branch(s.branch_id)
          )
        )
    )
  );
