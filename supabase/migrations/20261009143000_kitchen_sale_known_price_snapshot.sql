-- PROPOSAL ONLY: deployment to the live POS requires a separate explicit approval.
-- Freeze the latest APPROVED raw-material price at Send to Kitchen, alongside the
-- already-immutable consumed ingredient quantity. This is operational sale cost,
-- NOT inventory FIFO valuation or posted accounting cost.
-- Branch operators may see the price in their own kitchen snapshots as requested.
-- Old kitchen events are never backfilled with a newer price.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE OR REPLACE FUNCTION public._capture_kitchen_ingredient_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $capture$
DECLARE
  v_raw_ids uuid[];
  v_prices jsonb := '{}'::jsonb;
  v_component jsonb;
  v_price jsonb;
  v_components jsonb := '[]'::jsonb;
  v_unit_cost numeric;
  v_quantity numeric;
  v_lookup_failed boolean := false;
BEGIN
  IF NEW.snapshot_version < 2
     OR jsonb_typeof(NEW.component_snapshot) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.component_snapshot) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT (component->>'raw_material_id')::uuid)
    INTO v_raw_ids
  FROM jsonb_array_elements(NEW.component_snapshot) component
  WHERE component ? 'raw_material_id';

  BEGIN
    -- One scoped read per new kitchen event; never scan individual FIFO layers.
    -- Do not use inventory averages, FIFO batch costs, or default-cost guesses.
    SELECT COALESCE(jsonb_object_agg(
      p.raw_material_id::text,
      jsonb_build_object('unit_cost',p.unit_cost, 'price_source',p.price_source, 'priced_at',p.priced_at)
    ), '{}'::jsonb)
    INTO v_prices
    FROM public.get_raw_material_current_prices(NEW.branch_id, v_raw_ids) p
    WHERE p.unit_cost > 0
      AND p.price_source IN ('purchase','pricing','stock_count')
      AND p.priced_at IS NOT NULL
      AND p.priced_at <= COALESCE(NEW.created_at, now());
  EXCEPTION WHEN OTHERS THEN
    -- A pricing lookup failure cannot break checkout, kitchen dispatch or stock.
    -- Missing prices remain NULL, never zero and never today's retrospective price.
    v_lookup_failed := true;
    v_prices := '{}'::jsonb;
    RAISE LOG 'kitchen_price_snapshot_lookup_failed event % SQLSTATE %', NEW.id, SQLSTATE;
  END;

  FOR v_component IN SELECT value FROM jsonb_array_elements(NEW.component_snapshot)
  LOOP
    v_price := v_prices -> (v_component->>'raw_material_id');
    v_quantity := NULLIF(v_component->>'quantity','')::numeric;
    v_unit_cost := NULLIF(v_price->>'unit_cost','')::numeric;
    IF v_unit_cost IS NULL OR v_unit_cost <= 0 OR v_quantity IS NULL OR v_quantity <= 0 THEN
      v_components := v_components || jsonb_build_array(
        v_component || jsonb_build_object(
          'unit_cost',NULL,
          'extended_cost',NULL,
          'price_source',CASE WHEN v_lookup_failed THEN 'lookup_failed' ELSE 'unpriced' END,
          'priced_at',NULL,
          'price_captured_at',COALESCE(NEW.created_at,now())
        )
      );
    ELSE
      v_components := v_components || jsonb_build_array(
        v_component || jsonb_build_object(
          'unit_cost',v_unit_cost,
          'extended_cost',round(v_quantity*v_unit_cost,6),
          'price_source',v_price->>'price_source',
          'priced_at',v_price->>'priced_at',
          'price_captured_at',COALESCE(NEW.created_at,now())
        )
      );
    END IF;
  END LOOP;

  NEW.component_snapshot := v_components;
  RETURN NEW;
END;
$capture$;

REVOKE ALL ON FUNCTION public._capture_kitchen_ingredient_prices() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_capture_kitchen_ingredient_prices ON public.order_kitchen_inventory_events;
CREATE TRIGGER trg_capture_kitchen_ingredient_prices
BEFORE INSERT ON public.order_kitchen_inventory_events
FOR EACH ROW
WHEN (NEW.snapshot_version >= 2)
EXECUTE FUNCTION public._capture_kitchen_ingredient_prices();

COMMENT ON FUNCTION public._capture_kitchen_ingredient_prices() IS
  'Frozen raw ingredient quantities and latest approved prices for operational sale-cost reports. Does not change kitchen FIFO ledger or posted journals.';
