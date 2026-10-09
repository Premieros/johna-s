-- PROPOSAL ONLY: do not apply to production without separately approved migration.
-- Freeze operational ingredient costs when Send to Kitchen records the consumed component snapshot.
-- This is NOT posted FIFO inventory valuation or accounting COGS.
-- Price details are intentionally in a separate, costing-permission-protected table:
-- kitchen event SELECT is branch-wide and must never expose financial material prices.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS public.order_kitchen_known_cost_snapshots (
  event_id uuid PRIMARY KEY REFERENCES public.order_kitchen_inventory_events(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  known_cost numeric(18,6),
  complete_cost numeric(18,6),
  priced_components integer NOT NULL DEFAULT 0 CHECK (priced_components >= 0),
  unpriced_materials jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unpriced_materials) = 'array'),
  components jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(components) = 'array'),
  pricing_status text NOT NULL CHECK (pricing_status IN ('complete','partial','unpriced','lookup_failed')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kitchen_known_cost_nonnegative CHECK (
    (known_cost IS NULL OR known_cost >= 0)
    AND (complete_cost IS NULL OR complete_cost >= 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_kitchen_known_cost_branch ON public.order_kitchen_known_cost_snapshots(branch_id, event_id);

ALTER TABLE public.order_kitchen_known_cost_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_kitchen_known_cost_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_kitchen_known_cost_snapshots TO authenticated, service_role;
DROP POLICY IF EXISTS kitchen_known_cost_select ON public.order_kitchen_known_cost_snapshots;
CREATE POLICY kitchen_known_cost_select
  ON public.order_kitchen_known_cost_snapshots FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id) AND public.can_permission('reports.costing'));

CREATE OR REPLACE FUNCTION public._capture_kitchen_known_sale_cost()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raw_ids uuid[];
  v_price_map jsonb := '{}'::jsonb;
  v_component jsonb;
  v_price jsonb;
  v_components jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_unit_cost numeric;
  v_qty numeric;
  v_known numeric := 0;
  v_priced integer := 0;
  v_missing_count integer := 0;
  v_lookup_failed boolean := false;
  v_status text;
BEGIN
  -- Runs on new immutable v2 consumption snapshots only. Never backfill old sales
  -- from today's prices, and never replace inventory FIFO event total_cost.
  IF NEW.snapshot_version < 2
     OR jsonb_typeof(NEW.component_snapshot) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.component_snapshot) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT (c->>'raw_material_id')::uuid)
    INTO v_raw_ids
  FROM jsonb_array_elements(NEW.component_snapshot) c
  WHERE c ? 'raw_material_id';

  BEGIN
    -- One bounded canonical-price read for the entire kitchen event.
    -- Its 'last_batch' / 'inventory_average' / 'default_cost' fallbacks are
    -- *excluded*: sale pricing must never silently use FIFO or a guessed price.
    SELECT COALESCE(jsonb_object_agg(
      p.raw_material_id::text,
      jsonb_build_object('unit_cost',p.unit_cost,'source',p.price_source,'priced_at',p.priced_at)
    ), '{}'::jsonb)
    INTO v_price_map
    FROM public.get_raw_material_current_prices(NEW.branch_id, v_raw_ids) p
    WHERE p.unit_cost > 0
      AND p.price_source IN ('purchase','stock_count','pricing')
      AND p.priced_at IS NOT NULL
      AND p.priced_at <= COALESCE(NEW.created_at,now());
  EXCEPTION WHEN OTHERS THEN
    -- Pricing failure must not stop kitchen sends, printing or stock deduction.
    -- Store an explicit lookup_failed snapshot; never turn a lookup error into zero.
    v_lookup_failed := true;
    v_price_map := '{}'::jsonb;
    RAISE LOG 'kitchen_known_cost_lookup_failed for event %, SQLSTATE %', NEW.id, SQLSTATE;
  END;

  FOR v_component IN SELECT value FROM jsonb_array_elements(NEW.component_snapshot)
  LOOP
    v_price := v_price_map -> (v_component->>'raw_material_id');
    v_qty := COALESCE((v_component->>'quantity')::numeric,0);
    v_unit_cost := NULLIF((v_price->>'unit_cost')::numeric,0);
    IF v_qty > 0 AND v_unit_cost > 0 THEN
      v_priced := v_priced + 1;
      v_known := v_known + v_qty * v_unit_cost;
      v_components := v_components || jsonb_build_array(
        v_component || jsonb_build_object(
          'unit_cost',v_unit_cost,
          'extended_cost',round(v_qty * v_unit_cost,6),
          'price_source',v_price->>'source',
          'priced_at',v_price->>'priced_at'
        )
      );
    ELSE
      v_missing_count := v_missing_count + 1;
      v_missing := v_missing || jsonb_build_array(
        COALESCE(NULLIF(v_component->>'raw_name',''),v_component->>'raw_material_id','unknown')
      );
      v_components := v_components || jsonb_build_array(
        v_component || jsonb_build_object('unit_cost',NULL,'extended_cost',NULL)
      );
    END IF;
  END LOOP;

  v_status := CASE
    WHEN v_lookup_failed THEN 'lookup_failed'
    WHEN v_missing_count = 0 AND v_priced > 0 THEN 'complete'
    WHEN v_priced > 0 THEN 'partial'
    ELSE 'unpriced'
  END;
  INSERT INTO public.order_kitchen_known_cost_snapshots(
    event_id,branch_id,known_cost,complete_cost,priced_components,
    unpriced_materials,components,pricing_status
  ) VALUES (
    NEW.id,NEW.branch_id,
    CASE WHEN v_priced > 0 THEN round(v_known,6) ELSE NULL END,
    CASE WHEN v_missing_count = 0 AND v_priced > 0 THEN round(v_known,6) ELSE NULL END,
    v_priced,v_missing,v_components,v_status
  )
  ON CONFLICT (event_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._capture_kitchen_known_sale_cost() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_capture_kitchen_known_sale_cost ON public.order_kitchen_inventory_events;
CREATE TRIGGER trg_capture_kitchen_known_sale_cost
AFTER INSERT ON public.order_kitchen_inventory_events
FOR EACH ROW
WHEN (NEW.snapshot_version >= 2)
EXECUTE FUNCTION public._capture_kitchen_known_sale_cost();

COMMENT ON TABLE public.order_kitchen_known_cost_snapshots IS
  'Frozen operational ingredient prices at kitchen send; costing permission only. Never FIFO accounting COGS or retrospective repricing.';
