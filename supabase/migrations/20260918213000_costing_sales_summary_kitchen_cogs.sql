-- Costing center: make Actual COGS / Net Sales follow the authoritative
-- kitchen-send inventory lifecycle introduced for POS orders.
--
-- Current POS orders deduct inventory on send_to_kitchen. Those physical
-- deductions are deliberately relabeled from sale/sale to
-- kitchen_send/kitchen_send and the authoritative cost is persisted on
-- order_kitchen_inventory_events, later linked to the resulting sale through
-- settled_sale_id. The previous summary only read legacy inventory_ledger
-- sale/sale rows, so most current POS sales appeared to have zero COGS.
--
-- Compatibility rules:
--   * keep the existing RPC signature and JSON response shape unchanged;
--   * keep SECURITY INVOKER and authenticated-only execution;
--   * prefer kitchen-event COGS when a sale has settled kitchen events;
--   * fall back to legacy sale/sale ledger COGS for older/non-kitchen sales;
--   * never add both sources for the same sale (prevents double counting);
--   * preserve the existing net-sales/status/date semantics.

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
WITH scoped_sales AS (
  SELECT
    s.id,
    GREATEST(COALESCE(s.total, 0) - COALESCE(s.tax_amount, 0), 0)::numeric AS net_sales
  FROM public.sales s
  WHERE (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND (p_from IS NULL OR s.created_at::date >= p_from)
    AND (p_to IS NULL OR s.created_at::date <= p_to)
    AND COALESCE(s.status, '') NOT IN ('returned', 'cancelled')
),
kitchen_costs AS (
  SELECT
    e.settled_sale_id AS sale_id,
    ROUND(
      COALESCE(
        SUM(
          CASE
            WHEN e.sent_quantity > 0 THEN
              COALESCE(e.total_cost, 0)
              * GREATEST(e.sent_quantity - COALESCE(e.voided_quantity, 0), 0)
              / e.sent_quantity
            ELSE 0
          END
        ),
        0
      ),
      2
    )::numeric AS cogs
  FROM public.order_kitchen_inventory_events e
  JOIN scoped_sales ss ON ss.id = e.settled_sale_id
  WHERE e.settled_sale_id IS NOT NULL
  GROUP BY e.settled_sale_id
),
legacy_costs AS (
  SELECT
    il.reference_id AS sale_id,
    GREATEST(COALESCE(-SUM(il.total_cost), 0), 0)::numeric AS cogs
  FROM public.inventory_ledger il
  JOIN scoped_sales ss ON ss.id = il.reference_id
  WHERE il.entry_type = 'sale'
    AND il.reference_type = 'sale'
  GROUP BY il.reference_id
),
resolved_costs AS (
  SELECT
    ss.id AS sale_id,
    CASE
      WHEN kc.sale_id IS NOT NULL THEN COALESCE(kc.cogs, 0)
      ELSE COALESCE(lc.cogs, 0)
    END::numeric AS cogs
  FROM scoped_sales ss
  LEFT JOIN kitchen_costs kc ON kc.sale_id = ss.id
  LEFT JOIN legacy_costs lc ON lc.sale_id = ss.id
),
totals AS (
  SELECT
    COUNT(*)::integer AS sales_count,
    ROUND(COALESCE(SUM(ss.net_sales), 0), 2) AS net_sales,
    ROUND(COALESCE(SUM(rc.cogs), 0), 2) AS cogs
  FROM scoped_sales ss
  LEFT JOIN resolved_costs rc ON rc.sale_id = ss.id
)
SELECT jsonb_build_object(
  'sales_count', sales_count,
  'net_sales', net_sales,
  'cogs', cogs,
  'ratio', CASE WHEN net_sales > 0 THEN ROUND(cogs * 100.0 / net_sales, 2) ELSE 0 END
)
FROM totals;
$$;

REVOKE ALL ON FUNCTION public.get_costing_sales_summary(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_costing_sales_summary(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_costing_sales_summary(uuid, date, date) TO authenticated;
