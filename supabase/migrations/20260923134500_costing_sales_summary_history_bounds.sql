-- Performance stabilization: evaluate history bounds once for costing sales summary.
-- Measured on Production (read-only EXPLAIN) on 2026-09-23:
--   current function: ~947 ms
--   equivalent query with materialized history bounds: ~51 ms
-- The COGS source precedence and history permission semantics remain unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_costing_sales_summary(
  p_branch_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
WITH history_bounds AS MATERIALIZED (
  SELECT
    public.history_clamp_from(p_from) AS from_date,
    public.history_clamp_to(p_to) AS to_date
),
scoped_sales AS MATERIALIZED (
  SELECT
    s.id,
    s.branch_id,
    GREATEST(COALESCE(s.total,0)-COALESCE(s.tax_amount,0),0)::numeric AS net_sales
  FROM public.sales s
  CROSS JOIN history_bounds hb
  WHERE (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    AND (
      hb.from_date IS NULL
      OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=hb.from_date
    )
    AND (
      hb.to_date IS NULL
      OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=hb.to_date
    )
    AND COALESCE(s.status,'') NOT IN ('returned','cancelled')
),
journal_costs AS (
  SELECT
    ss.id AS sale_id,
    round(COALESCE(sum(jl.debit-jl.credit),0),2)::numeric AS cogs
  FROM scoped_sales ss
  JOIN public.journal_entries je
    ON je.branch_id=ss.branch_id
   AND je.reference_id=ss.id
   AND je.reference_type IN ('sale','fifo_cogs_reconcile')
  JOIN public.account_mappings am
    ON am.branch_id=ss.branch_id
   AND am.semantic_key='cogs'
  JOIN public.journal_entry_lines jl
    ON jl.journal_entry_id=je.id
   AND jl.account_id=am.account_id
  GROUP BY ss.id
),
kitchen_costs AS (
  SELECT
    e.settled_sale_id AS sale_id,
    round(COALESCE(sum(
      CASE
        WHEN e.sent_quantity>0 THEN
          COALESCE(e.total_cost,0)
          * GREATEST(e.sent_quantity-COALESCE(e.voided_quantity,0),0)
          / e.sent_quantity
        ELSE 0
      END
    ),0),2)::numeric AS cogs
  FROM public.order_kitchen_inventory_events e
  JOIN scoped_sales ss ON ss.id=e.settled_sale_id
  WHERE e.settled_sale_id IS NOT NULL
  GROUP BY e.settled_sale_id
),
legacy_costs AS (
  SELECT
    il.reference_id AS sale_id,
    GREATEST(COALESCE(-sum(il.total_cost),0),0)::numeric AS cogs
  FROM public.inventory_ledger il
  JOIN scoped_sales ss ON ss.id=il.reference_id
  WHERE il.entry_type='sale' AND il.reference_type='sale'
  GROUP BY il.reference_id
),
resolved_costs AS (
  SELECT
    ss.id sale_id,
    CASE
      WHEN jc.sale_id IS NOT NULL THEN COALESCE(jc.cogs,0)
      WHEN kc.sale_id IS NOT NULL THEN COALESCE(kc.cogs,0)
      ELSE COALESCE(lc.cogs,0)
    END::numeric AS cogs
  FROM scoped_sales ss
  LEFT JOIN journal_costs jc ON jc.sale_id=ss.id
  LEFT JOIN kitchen_costs kc ON kc.sale_id=ss.id
  LEFT JOIN legacy_costs lc ON lc.sale_id=ss.id
),
totals AS (
  SELECT
    count(*)::integer AS sales_count,
    round(COALESCE(sum(ss.net_sales),0),2) AS net_sales,
    round(COALESCE(sum(rc.cogs),0),2) AS cogs
  FROM scoped_sales ss
  LEFT JOIN resolved_costs rc ON rc.sale_id=ss.id
)
SELECT jsonb_build_object(
  'sales_count',sales_count,
  'net_sales',net_sales,
  'cogs',cogs,
  'ratio',CASE WHEN net_sales>0 THEN round(cogs*100.0/net_sales,2) ELSE 0 END
)
FROM totals;
$$;

REVOKE ALL ON FUNCTION public.get_costing_sales_summary(uuid,date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_costing_sales_summary(uuid,date,date)
  TO authenticated, service_role;

COMMIT;
