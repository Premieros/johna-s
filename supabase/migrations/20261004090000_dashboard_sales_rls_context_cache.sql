BEGIN;

-- Dashboard / sales read-path performance repair.
--
-- Goal: preserve the existing Permission-First + Financial Visibility contract
-- exactly while preventing statement-constant authorization work from being
-- re-evaluated for every scanned sales row, and preventing child sales tables
-- from re-entering private.sale_read_visible_by_id() for every child row.
--
-- Read-side only. No write policies, posting, settlement, shifts, inventory,
-- printing, KDS, or kitchen behavior are changed.
--
-- No new SECURITY DEFINER function is introduced. Existing authorization
-- helpers remain authoritative; statement-constant helpers are wrapped in
-- scalar SELECT initPlans where possible.

-- SALES ---------------------------------------------------------------------

DROP POLICY IF EXISTS auth_select_sales ON public.sales;
CREATE POLICY auth_select_sales
ON public.sales
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_platform_admin())
  OR (
    (SELECT public.can_permission('sales.view'))
    AND public.user_may_access_branch(branch_id)
  )
);

DROP POLICY IF EXISTS financial_visibility_sales ON public.sales;
CREATE POLICY financial_visibility_sales
ON public.sales
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  id IS NOT NULL
  AND branch_id IS NOT NULL
  AND created_at IS NOT NULL
  AND public.user_may_access_branch(branch_id)
  AND (
    (SELECT public.can_permission('history.unlimited'))
    OR created_at >= (
      SELECT public.history_date_start(
        public.history_business_date()
        - (
          GREATEST(
            COALESCE(
              (
                SELECT l.recent_days
                FROM private.get_financial_visibility_limits() l
                LIMIT 1
              ),
              7
            ),
            1
          ) - 1
        )
      )
    )
    OR (
      (
        (
          'x' || substr(
            md5(branch_id::text || ':' || id::text),
            1,
            8
          )
        )::bit(32)::bigint % 100
      )
      <
      (
        SELECT LEAST(
          GREATEST(
            COALESCE(
              (
                SELECT l.historical_percent
                FROM private.get_financial_visibility_limits() l
                LIMIT 1
              ),
              30
            ),
            0
          ),
          100
        )
      )
    )
  )
);

COMMENT ON POLICY financial_visibility_sales ON public.sales IS
  'Permission-first financial visibility with statement-level history/settings context; exact branch + deterministic historical sampling contract preserved.';

-- SALE ITEMS ----------------------------------------------------------------
--
-- The parent sale is already the source of truth for financial visibility.
-- Keep the child policy RESTRICTIVE, but ask PostgreSQL whether the parent sale
-- is visible under the parent table RLS instead of calling
-- private.sale_read_visible_by_id() again for every item row.

DROP POLICY IF EXISTS auth_select_sale_items ON public.sale_items;
CREATE POLICY auth_select_sale_items
ON public.sale_items
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_pos_admin())
  OR EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        s.branch_id = (SELECT public.get_branch_id())
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
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
  )
);

COMMENT ON POLICY financial_visibility_sale_items ON public.sale_items IS
  'RESTRICTIVE child visibility inherited from the parent sale RLS without per-row sale_read_visible_by_id re-entry.';

-- SALE PAYMENTS --------------------------------------------------------------

DROP POLICY IF EXISTS sale_payments_parent_select ON public.sale_payments;
CREATE POLICY sale_payments_parent_select
ON public.sale_payments
FOR SELECT
TO authenticated
USING (
  (SELECT public.can_permission('sales.view'))
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
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_payments.sale_id
  )
);

COMMENT ON POLICY sale_payments_financial_visibility_select ON public.sale_payments IS
  'RESTRICTIVE payment visibility inherited from the parent sale RLS without per-row sale_read_visible_by_id re-entry.';

COMMIT;
