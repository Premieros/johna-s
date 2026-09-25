-- Unified reporting metric contracts.
-- This migration changes reporting semantics only; it does not mutate business data.

CREATE OR REPLACE FUNCTION private.report_net_sale_amount(
  p_total numeric,
  p_refunded_amount numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog
AS $function$
  SELECT round(GREATEST(COALESCE(p_total,0)-COALESCE(p_refunded_amount,0),0),2);
$function$;

REVOKE ALL ON FUNCTION private.report_net_sale_amount(numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.report_net_sale_amount(numeric,numeric) TO authenticated, service_role;

COMMENT ON FUNCTION private.report_net_sale_amount(numeric,numeric)
IS 'Canonical reporting net-sale definition: max(sale total - refunded amount, 0). Tax remains separately reportable and is never silently removed from net sales.';

CREATE OR REPLACE FUNCTION public.get_costing_sales_summary(
  p_branch_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO public, pg_temp
AS $function$
WITH history_bounds AS MATERIALIZED (
  SELECT
    public.history_clamp_from(p_from) AS from_date,
    public.history_clamp_to(p_to) AS to_date
),
scoped_sales AS MATERIALIZED (
  SELECT
    s.id,
    s.branch_id,
    private.report_net_sale_amount(s.total,s.refunded_amount) AS net_sales
  FROM public.sales s
  CROSS JOIN history_bounds hb
  WHERE (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    AND COALESCE(s.is_archived,false)=false
    AND COALESCE(s.status,'') NOT IN ('returned','cancelled')
    AND (hb.from_date IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=hb.from_date)
    AND (hb.to_date IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=hb.to_date)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_order_margin(
  p_branch_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE(
  sale_id uuid,
  invoice_number text,
  branch_id uuid,
  sale_date date,
  total numeric,
  discount_amount numeric,
  cogs numeric,
  gross_margin numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch
    FROM public.users u
    WHERE u.id=auth.uid();
    v_scope:=v_user_branch;
  ELSE
    v_scope:=p_branch_id;
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT s.*
    FROM public.sales s
    WHERE (v_scope IS NULL OR s.branch_id=v_scope)
      AND COALESCE(s.is_archived,false)=false
      AND COALESCE(s.status,'') <> 'cancelled'
      AND (
        public.history_clamp_from(p_from) IS NULL
        OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=public.history_clamp_from(p_from)
      )
      AND (
        public.history_clamp_to(p_to) IS NULL
        OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=public.history_clamp_to(p_to)
      )
  ),
  journal_costs AS (
    SELECT
      s.id sale_id,
      round(COALESCE(sum(jl.debit-jl.credit),0),2)::numeric AS cogs
    FROM scoped s
    JOIN public.journal_entries je
      ON je.branch_id=s.branch_id
     AND je.reference_id=s.id
     AND je.reference_type IN ('sale','fifo_cogs_reconcile')
    JOIN public.account_mappings am
      ON am.branch_id=s.branch_id
     AND am.semantic_key='cogs'
    JOIN public.journal_entry_lines jl
      ON jl.journal_entry_id=je.id
     AND jl.account_id=am.account_id
    GROUP BY s.id
  ),
  kitchen_costs AS (
    SELECT
      e.settled_sale_id sale_id,
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
    JOIN scoped s ON s.id=e.settled_sale_id
    GROUP BY e.settled_sale_id
  ),
  legacy_costs AS (
    SELECT
      s.id sale_id,
      GREATEST(COALESCE(-sum(il.total_cost),0),0)::numeric AS cogs
    FROM scoped s
    LEFT JOIN public.inventory_ledger il
      ON il.reference_id=s.id
     AND il.entry_type='sale'
     AND il.reference_type='sale'
    GROUP BY s.id
  )
  SELECT
    s.id,
    s.invoice_number,
    s.branch_id,
    (s.created_at AT TIME ZONE 'Africa/Cairo')::date,
    private.report_net_sale_amount(s.total,s.refunded_amount),
    COALESCE(s.discount_amount,0),
    COALESCE(jc.cogs,kc.cogs,lc.cogs,0)::numeric(16,2),
    round(
      private.report_net_sale_amount(s.total,s.refunded_amount)
      - COALESCE(jc.cogs,kc.cogs,lc.cogs,0),
      2
    )::numeric(16,2)
  FROM scoped s
  LEFT JOIN journal_costs jc ON jc.sale_id=s.id
  LEFT JOIN kitchen_costs kc ON kc.sale_id=s.id
  LEFT JOIN legacy_costs lc ON lc.sale_id=s.id
  ORDER BY s.created_at DESC
  LIMIT 500;
END;
$function$;
