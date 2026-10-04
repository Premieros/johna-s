BEGIN;

-- Rollback for 20261004090000_dashboard_sales_rls_context_cache.sql
-- Restores the Production policy definitions that existed before the patch.

DROP POLICY IF EXISTS auth_select_sales ON public.sales;
CREATE POLICY auth_select_sales
ON public.sales
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR (
    public.can_permission('sales.view')
    AND public.user_may_access_branch(branch_id)
  )
);

DROP POLICY IF EXISTS financial_visibility_sales ON public.sales;
CREATE POLICY financial_visibility_sales
ON public.sales
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (private.sale_read_visible(id, branch_id, created_at));

DROP POLICY IF EXISTS auth_select_sale_items ON public.sale_items;
CREATE POLICY auth_select_sale_items
ON public.sale_items
FOR SELECT
TO authenticated
USING (
  public.is_pos_admin()
  OR EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        s.branch_id = public.get_branch_id()
        OR s.branch_id IS NULL
      )
  )
);

DROP POLICY IF EXISTS financial_visibility_sale_items ON public.sale_items;
CREATE POLICY financial_visibility_sale_items
ON public.sale_items
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (private.sale_read_visible_by_id(sale_id));

DROP POLICY IF EXISTS sale_payments_parent_select ON public.sale_payments;
CREATE POLICY sale_payments_parent_select
ON public.sale_payments
FOR SELECT
TO authenticated
USING (
  public.can_permission('sales.view')
  AND EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_payments.sale_id
      AND public.user_may_access_branch(s.branch_id)
  )
);

DROP POLICY IF EXISTS sale_payments_financial_visibility_select ON public.sale_payments;
CREATE POLICY sale_payments_financial_visibility_select
ON public.sale_payments
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (private.sale_read_visible_by_id(sale_id));

COMMIT;
