-- Restore captured baseline definitions only; run atomically after review.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION public._raw_last_known_fifo_cost(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  )
  -- Each source already selects its single latest positive price. COALESCE
  -- stops once the authoritative higher-priority source is found.
  SELECT COALESCE(
    (SELECT unit_cost FROM last_fifo_issue),
    (SELECT unit_cost FROM last_receipt_ledger),
    (SELECT unit_cost FROM last_real_batch),
    (SELECT unit_cost FROM default_price),
    0
  )::numeric;
$function$;

CREATE OR REPLACE FUNCTION public._raw_price_oversold_batch_from_fifo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
COMMIT;
