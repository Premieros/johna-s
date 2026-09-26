-- Negative raw-material estimated valuation without contaminating actual FIFO/COGS.
--
-- Contract:
--   * oversold raw batches carry the last known REAL FIFO unit cost as an estimate;
--   * oversold inventory-ledger rows remain zero-cost until a real receipt settles them;
--   * raw_material_inventory.avg_cost is based on positive physical batches only;
--   * reporting exposes actual positive-stock value separately from estimated negative exposure.
--
-- This preserves accounting actuals while giving operators a meaningful valuation for
-- negative raw stock that is waiting for a future purchase.

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
  candidates AS (
    SELECT unit_cost, created_at, tie, 1 AS priority FROM last_fifo_issue
    UNION ALL
    SELECT unit_cost, created_at, tie, 2 AS priority FROM last_real_batch
  )
  SELECT COALESCE((
    SELECT c.unit_cost
    FROM candidates c
    ORDER BY c.priority, c.created_at DESC NULLS LAST, c.tie DESC
    LIMIT 1
  ), 0)::numeric;
$function$;

REVOKE ALL ON FUNCTION public._raw_last_known_fifo_cost(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_last_known_fifo_cost(uuid,uuid,uuid)
  TO service_role, postgres;


CREATE OR REPLACE FUNCTION public._raw_price_oversold_batch_from_fifo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_estimated_cost numeric := 0;
BEGIN
  IF NEW.quantity < 0
     AND COALESCE(NEW.unit_cost, 0) <= 0
     AND COALESCE(NEW.source_type, '') LIKE '%_oversold' THEN
    v_estimated_cost := public._raw_last_known_fifo_cost(
      NEW.raw_material_id,
      NEW.branch_id,
      NEW.warehouse_id
    );

    IF COALESCE(v_estimated_cost, 0) > 0 THEN
      NEW.unit_cost := round(v_estimated_cost, 6);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_raw_price_oversold_batch_from_fifo
  ON public.raw_material_batches;
CREATE TRIGGER trg_raw_price_oversold_batch_from_fifo
BEFORE INSERT OR UPDATE OF quantity, unit_cost, source_type
ON public.raw_material_batches
FOR EACH ROW
EXECUTE FUNCTION public._raw_price_oversold_batch_from_fifo();


-- Existing open negative debt batches get a display/valuation estimate only.
-- We intentionally DO NOT alter inventory_ledger.total_cost or journal COGS.
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


CREATE OR REPLACE FUNCTION public._raw_inventory_actual_avg_cost_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_positive_qty numeric := 0;
  v_positive_value numeric := 0;
BEGIN
  SELECT
    COALESCE(SUM(b.quantity), 0),
    COALESCE(SUM(b.quantity * COALESCE(b.unit_cost, 0)), 0)
  INTO v_positive_qty, v_positive_value
  FROM public.raw_material_batches b
  WHERE b.raw_material_id = NEW.raw_material_id
    AND b.branch_id = NEW.branch_id
    AND b.quantity > 0;

  NEW.avg_cost := CASE
    WHEN v_positive_qty > 0 THEN round(v_positive_value / v_positive_qty, 2)
    ELSE 0
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_raw_inventory_actual_avg_cost_guard
  ON public.raw_material_inventory;
CREATE TRIGGER trg_raw_inventory_actual_avg_cost_guard
BEFORE INSERT OR UPDATE OF quantity, avg_cost
ON public.raw_material_inventory
FOR EACH ROW
EXECUTE FUNCTION public._raw_inventory_actual_avg_cost_guard();


CREATE OR REPLACE FUNCTION public.get_raw_material_cost_valuation_overview(
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  raw_material_id uuid,
  raw_material_name text,
  raw_material_code text,
  branch_id uuid,
  latest_cost numeric,
  previous_cost numeric,
  change_amount numeric,
  change_pct numeric,
  price_source text,
  priced_at timestamptz,
  reference_number text,
  source_detail text,
  event_count bigint,
  stock_quantity numeric,
  positive_quantity numeric,
  negative_quantity numeric,
  actual_stock_value numeric,
  estimated_negative_value numeric,
  estimated_net_stock_value numeric
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
  IF NOT public.can_permission('reports.costing') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_branch_id IS NOT NULL
     AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  WITH price_rows AS MATERIALIZED (
    SELECT *
    FROM public.get_raw_material_cost_overview(p_branch_id)
  ),
  batch_values AS MATERIALIZED (
    SELECT
      b.raw_material_id,
      b.branch_id,
      COALESCE(SUM(b.quantity), 0)::numeric AS stock_quantity,
      COALESCE(SUM(b.quantity) FILTER (WHERE b.quantity > 0), 0)::numeric AS positive_quantity,
      COALESCE(-SUM(b.quantity) FILTER (WHERE b.quantity < 0), 0)::numeric AS negative_quantity,
      COALESCE(SUM(b.quantity * COALESCE(b.unit_cost, 0))
        FILTER (WHERE b.quantity > 0), 0)::numeric AS actual_stock_value,
      COALESCE(SUM((-b.quantity) * COALESCE(NULLIF(b.unit_cost, 0), pr.latest_cost, 0))
        FILTER (WHERE b.quantity < 0), 0)::numeric AS estimated_negative_value
    FROM public.raw_material_batches b
    JOIN price_rows pr
      ON pr.raw_material_id = b.raw_material_id
     AND pr.branch_id = b.branch_id
    GROUP BY b.raw_material_id, b.branch_id
  )
  SELECT
    pr.raw_material_id,
    pr.raw_material_name,
    pr.raw_material_code,
    pr.branch_id,
    pr.latest_cost,
    pr.previous_cost,
    pr.change_amount,
    pr.change_pct,
    pr.price_source,
    pr.priced_at,
    pr.reference_number,
    pr.source_detail,
    pr.event_count,
    COALESCE(bv.stock_quantity, 0)::numeric,
    COALESCE(bv.positive_quantity, 0)::numeric,
    COALESCE(bv.negative_quantity, 0)::numeric,
    round(COALESCE(bv.actual_stock_value, 0), 2)::numeric,
    round(COALESCE(bv.estimated_negative_value, 0), 2)::numeric,
    round(
      COALESCE(bv.actual_stock_value, 0)
      - COALESCE(bv.estimated_negative_value, 0),
      2
    )::numeric
  FROM price_rows pr
  LEFT JOIN batch_values bv
    ON bv.raw_material_id = pr.raw_material_id
   AND bv.branch_id = pr.branch_id
  ORDER BY pr.raw_material_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_raw_material_cost_valuation_overview(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_cost_valuation_overview(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_raw_material_cost_valuation_overview(uuid) IS
  'Raw-material price plus split inventory valuation: actual positive FIFO stock is kept separate from estimated negative-stock exposure.';

NOTIFY pgrst, 'reload schema';

COMMIT;
