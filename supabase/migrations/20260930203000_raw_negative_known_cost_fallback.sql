-- Estimate-only known-cost fallback for negative raw-material debt.
-- Never rewrites actual inventory-ledger COGS, journals, or quantities.

BEGIN;

CREATE OR REPLACE FUNCTION public._raw_last_known_fifo_cost(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH last_fifo_issue AS (
    SELECT il.unit_cost::numeric AS unit_cost, il.created_at, il.id::text AS tie
    FROM public.inventory_ledger il
    WHERE il.raw_material_id = p_raw_material_id
      AND il.branch_id = p_branch_id
      AND il.warehouse_id = p_warehouse_id
      AND il.quantity < 0
      AND COALESCE(il.unit_cost, 0) > 0
      AND COALESCE(il.batch_number, '') NOT LIKE 'OV-%'
    ORDER BY il.created_at DESC NULLS LAST, il.id DESC
    LIMIT 1
  ),
  last_receipt_ledger AS (
    SELECT il.unit_cost::numeric AS unit_cost, il.created_at, il.id::text AS tie
    FROM public.inventory_ledger il
    WHERE il.raw_material_id = p_raw_material_id
      AND il.branch_id = p_branch_id
      AND il.warehouse_id = p_warehouse_id
      AND il.quantity > 0
      AND COALESCE(il.unit_cost, 0) > 0
      AND (
        COALESCE(il.entry_type, '') = 'purchase'
        OR COALESCE(il.reference_type, '') IN ('purchase', 'purchase_receipt')
      )
    ORDER BY il.created_at DESC NULLS LAST, il.id DESC
    LIMIT 1
  ),
  last_real_batch AS (
    SELECT b.unit_cost::numeric AS unit_cost, b.created_at, b.id::text AS tie
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = p_raw_material_id
      AND b.branch_id = p_branch_id
      AND b.warehouse_id = p_warehouse_id
      AND COALESCE(b.unit_cost, 0) > 0
      AND COALESCE(b.source_type, '') NOT LIKE '%_oversold'
    ORDER BY b.created_at DESC NULLS LAST, b.id DESC
    LIMIT 1
  ),
  default_price AS (
    SELECT rm.default_cost::numeric AS unit_cost,
           '-infinity'::timestamptz AS created_at,
           rm.id::text AS tie
    FROM public.raw_materials rm
    WHERE rm.id = p_raw_material_id
      AND rm.branch_id = p_branch_id
      AND COALESCE(rm.default_cost, 0) > 0
    LIMIT 1
  ),
  candidates AS (
    SELECT unit_cost, created_at, tie, 1 AS priority FROM last_fifo_issue
    UNION ALL
    SELECT unit_cost, created_at, tie, 2 AS priority FROM last_receipt_ledger
    UNION ALL
    SELECT unit_cost, created_at, tie, 3 AS priority FROM last_real_batch
    UNION ALL
    SELECT unit_cost, created_at, tie, 4 AS priority FROM default_price
  )
  SELECT COALESCE((
    SELECT c.unit_cost
    FROM candidates c
    WHERE COALESCE(c.unit_cost, 0) > 0
    ORDER BY c.priority, c.created_at DESC NULLS LAST, c.tie DESC
    LIMIT 1
  ), 0)::numeric;
$function$;

REVOKE ALL ON FUNCTION public._raw_last_known_fifo_cost(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_last_known_fifo_cost(uuid,uuid,uuid)
  TO service_role, postgres;

-- Backfill valuation-only price on unresolved oversold batches that are still zero.
-- Quantities and actual ledger/journal cost are intentionally untouched.
UPDATE public.raw_material_batches b
SET unit_cost = round(k.estimated_cost, 6)
FROM public.raw_fifo_debts d
CROSS JOIN LATERAL (
  SELECT public._raw_last_known_fifo_cost(
    d.raw_material_id,
    d.branch_id,
    d.warehouse_id
  ) AS estimated_cost
) k
WHERE d.oversold_batch_id = b.id
  AND d.settled_quantity < d.debt_quantity
  AND b.quantity < 0
  AND COALESCE(b.unit_cost, 0) <= 0
  AND COALESCE(k.estimated_cost, 0) > 0;

CREATE OR REPLACE FUNCTION public.get_raw_consumption_cost_breakdown(
  p_branch_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  raw_material_id uuid,
  raw_material_name text,
  raw_material_code text,
  unit_name text,
  consumed_quantity numeric,
  actual_quantity numeric,
  estimated_quantity numeric,
  actual_cost numeric,
  estimated_cost numeric,
  displayed_cost numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  IF NOT (
    public.can_permission('reports.costing')
    OR public.can_permission('shifts.report.shift')
    OR public.can_permission('shifts.day_close')
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  RETURN QUERY
  WITH movements AS MATERIALIZED (
    SELECT
      il.id,
      il.raw_material_id,
      il.branch_id,
      il.warehouse_id,
      il.created_at,
      abs(il.quantity)::numeric AS consumed_qty,
      COALESCE(il.unit_cost, 0)::numeric AS actual_unit_cost,
      COALESCE(il.total_cost, 0)::numeric AS total_cost
    FROM public.inventory_ledger il
    WHERE il.branch_id = p_branch_id
      AND il.raw_material_id IS NOT NULL
      AND il.quantity < 0
      AND il.created_at >= p_from
      AND il.created_at <= p_to
      AND il.entry_type IN ('sale','kitchen_send')
      AND COALESCE(il.reference_type, '') IN ('sale','kitchen_send')
      AND private.financial_reference_visible(
        il.reference_type,
        il.reference_id,
        (md5(il.id::text))::uuid,
        il.branch_id,
        il.created_at
      )
  ),
  priced AS MATERIALIZED (
    SELECT
      m.*,
      CASE
        WHEN m.actual_unit_cost > 0 OR abs(m.total_cost) > 0 THEN 0::numeric
        ELSE public._raw_last_known_fifo_cost(
          m.raw_material_id,
          m.branch_id,
          m.warehouse_id
        )
      END AS estimated_unit_cost
    FROM movements m
  )
  SELECT
    rm.id,
    rm.name::text,
    rm.code::text,
    COALESCE(mu.symbol, mu.code, mu.name, '')::text,
    round(SUM(p.consumed_qty), 6)::numeric,
    round(SUM(CASE WHEN p.actual_unit_cost > 0 OR abs(p.total_cost) > 0 THEN p.consumed_qty ELSE 0 END), 6)::numeric,
    round(SUM(CASE WHEN p.actual_unit_cost <= 0 AND abs(p.total_cost) <= 0 THEN p.consumed_qty ELSE 0 END), 6)::numeric,
    round(SUM(CASE
      WHEN p.actual_unit_cost > 0 OR abs(p.total_cost) > 0 THEN abs(p.total_cost)
      ELSE 0
    END), 2)::numeric,
    round(SUM(CASE
      WHEN p.actual_unit_cost <= 0 AND abs(p.total_cost) <= 0
        THEN p.consumed_qty * COALESCE(p.estimated_unit_cost, 0)
      ELSE 0
    END), 2)::numeric,
    round(SUM(CASE
      WHEN p.actual_unit_cost > 0 OR abs(p.total_cost) > 0 THEN abs(p.total_cost)
      ELSE p.consumed_qty * COALESCE(p.estimated_unit_cost, 0)
    END), 2)::numeric
  FROM priced p
  JOIN public.raw_materials rm ON rm.id = p.raw_material_id
  LEFT JOIN public.measurement_units mu ON mu.id = rm.unit_id
  GROUP BY rm.id, rm.name, rm.code, mu.symbol, mu.code, mu.name
  ORDER BY rm.name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_raw_consumption_cost_breakdown(uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raw_consumption_cost_breakdown(uuid,timestamptz,timestamptz)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_raw_consumption_cost_breakdown(uuid,timestamptz,timestamptz) IS
  'Raw consumption estimate keeps actual FIFO/journal cost untouched. Unresolved zero-cost consumption uses known same-warehouse FIFO/receipt/batch price, then branch default_cost, and remains zero only when no known price exists.';

NOTIFY pgrst, 'reload schema';

COMMIT;
