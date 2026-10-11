-- PROPOSAL / NOT A CANONICAL MIGRATION. DO NOT EXECUTE ON PRODUCTION.
-- Stage A: Install optimized reader and replace code of the DISABLED price
-- capture trigger function. No trigger enabled; no order, inventory or journal
-- data changed. Requires separate explicit owner approval and completed CI.
-- Run atomically with a short lock_timeout using migration tooling only.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.order_kitchen_inventory_events'::regclass
     AND tgname='trg_capture_kitchen_ingredient_prices'
     AND tgenabled='D'
     AND tgfoid='public._capture_kitchen_ingredient_prices()'::regprocedure
 ) THEN RAISE EXCEPTION 'KITCHEN_CAPTURE_TRIGGER_MUST_REMAIN_DISABLED'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.order_kitchen_inventory_events'::regclass
     AND tgname='trg_sync_sale_source_order_from_kitchen_event'
     AND tgenabled='O'
 ) THEN RAISE EXCEPTION 'KITCHEN_SOURCE_SYNC_EXPECTED_ENABLED'; END IF;
END;
$guard$;

-- EXPERIMENT ONLY for issue #486. NOT A CANONICAL SUPABASE MIGRATION.
-- Never apply to production or enable trg_capture_kitchen_ingredient_prices
-- without exact permission-visible, cross-branch, as-of, negative-stock, resend
-- and lock/latency parity tests in an isolated DB plus separate owner approval.
--
-- Strategy: one indexed latest VISIBLE qualifying record per material per
-- original approved source, then preserve the original authoritative ordering:
-- priced_at DESC NULLS LAST, source_rank ASC, reference_number DESC NULLS LAST,
-- event_id DESC. Do not touch FIFO costs, payment, journal or order events.
-- Only approved {purchase,pricing,stock_count} events are eligible.
-- Never substitute last_batch / inventory_average / default_cost, and never
-- retrospectively reprice an old kitchen snapshot.
--
-- This experimental function has SECURITY INVOKER and uses the SAME purchase
-- finance visibility predicate as get_raw_material_current_prices.
-- Apply this function ONLY inside a disposable transactional test fixture.
-- The production trigger stays disabled and this script does NOT enable it.

CREATE OR REPLACE FUNCTION public._kitchen_approved_price_candidate(
  p_branch_id uuid,
  p_raw_material_ids uuid[],
  p_as_of timestamptz
)
RETURNS TABLE (
  raw_material_id uuid,
  branch_id uuid,
  unit_cost numeric,
  price_source text,
  priced_at timestamptz,
  reference_number text
)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $bounded$
  SELECT
    rm.id, rm.branch_id, winning.unit_cost, winning.source,
    winning.priced_at, winning.reference_number
  FROM public.raw_materials rm
  CROSS JOIN LATERAL (
    SELECT
      e.unit_cost,e.source,e.priced_at,e.reference_number
    FROM (
      SELECT * FROM (
        SELECT
          il.unit_cost::numeric(18,6) AS unit_cost,
          'purchase'::text AS source,
          il.created_at AS priced_at,
          COALESCE(NULLIF(il.reference_number,''),p.invoice_number)::text AS reference_number,
          il.id::text AS event_id,
          3 AS source_rank
        FROM public.inventory_ledger il
        JOIN public.purchases p
          ON p.id=il.reference_id
         AND il.reference_type='purchase'
        WHERE il.raw_material_id=rm.id
          AND il.branch_id=rm.branch_id
          AND p.branch_id=rm.branch_id
          AND il.entry_type='purchase'
          AND p.status='completed'
          AND COALESCE(il.unit_cost,0)>0
          AND il.created_at<=p_as_of
          AND (
            (auth.uid() IS NULL AND current_user IN ('postgres','service_role'))
            OR private.financial_row_visible(p.id,p.branch_id,p.created_at)
          )
        ORDER BY
          il.created_at DESC NULLS LAST,
          COALESCE(NULLIF(il.reference_number,''),p.invoice_number) DESC NULLS LAST,
          il.id::text DESC
        LIMIT 1
      ) priced_receipt

      UNION ALL

      SELECT * FROM (
        SELECT
          (norm.value->>'stock_unit_cost')::numeric(18,6) AS unit_cost,
          'purchase'::text AS source,
          COALESCE(p.approved_at,pi.created_at,p.created_at) AS priced_at,
          p.invoice_number::text AS reference_number,
          'legacy-purchase:'||pi.id::text AS event_id,
          3 AS source_rank
        FROM public.purchase_items pi
        JOIN public.purchases p ON p.id=pi.purchase_id
        CROSS JOIN LATERAL (
          SELECT public._normalize_raw_purchase_uom(
            pi.raw_material_id,pi.quantity,pi.unit_cost,pi.unit_name
          ) AS value
        ) norm
        WHERE pi.raw_material_id=rm.id
          AND p.branch_id=rm.branch_id
          AND p.status='completed'
          AND COALESCE(pi.unit_cost,0)>0
          AND COALESCE((norm.value->>'success')::boolean,false)
          AND COALESCE((norm.value->>'stock_unit_cost')::numeric,0)>0
          AND COALESCE(p.approved_at,pi.created_at,p.created_at)<=p_as_of
          AND (
            (auth.uid() IS NULL AND current_user IN ('postgres','service_role'))
            OR private.financial_row_visible(p.id,p.branch_id,p.created_at)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.inventory_ledger il
            WHERE il.reference_id=p.id
              AND il.reference_type='purchase'
              AND il.entry_type='purchase'
              AND il.raw_material_id=pi.raw_material_id
          )
        ORDER BY
          COALESCE(p.approved_at,pi.created_at,p.created_at) DESC NULLS LAST,
          p.invoice_number DESC NULLS LAST,
          ('legacy-purchase:'||pi.id::text) DESC
        LIMIT 1
      ) legacy_receipt

      UNION ALL

      SELECT * FROM (
        SELECT
          sci.unit_cost::numeric(18,6) AS unit_cost,
          'stock_count'::text AS source,
          COALESCE(sc.applied_at,sc.approved_at,sc.created_at) AS priced_at,
          sc.count_number::text AS reference_number,
          sci.id::text AS event_id,
          2 AS source_rank
        FROM public.stock_count_items sci
        JOIN public.stock_counts sc ON sc.id=sci.stock_count_id
        WHERE sci.raw_material_id=rm.id
          AND sc.branch_id=rm.branch_id
          AND sc.status='applied'
          AND COALESCE(sci.unit_cost,0)>0
          AND COALESCE(sc.applied_at,sc.approved_at,sc.created_at)<=p_as_of
        ORDER BY
          COALESCE(sc.applied_at,sc.approved_at,sc.created_at) DESC NULLS LAST,
          sc.count_number DESC NULLS LAST,
          sci.id::text DESC
        LIMIT 1
      ) approved_stock_count

      UNION ALL

      SELECT * FROM (
        SELECT
          pe.unit_cost::numeric(18,6) AS unit_cost,
          'pricing'::text AS source,
          pe.priced_at AS priced_at,
          pe.reference_number::text AS reference_number,
          'pricing:'||pe.id::text AS event_id,
          1 AS source_rank
        FROM public.raw_material_price_events pe
        WHERE pe.raw_material_id=rm.id
          AND pe.branch_id=rm.branch_id
          AND pe.unit_cost>0
          AND pe.priced_at<=p_as_of
        ORDER BY
          pe.priced_at DESC NULLS LAST,
          pe.reference_number DESC NULLS LAST,
          ('pricing:'||pe.id::text) DESC
        LIMIT 1
      ) approved_manual_price
    ) e
    ORDER BY
      e.priced_at DESC NULLS LAST,
      e.source_rank,
      e.reference_number DESC NULLS LAST,
      e.event_id DESC
    LIMIT 1
  ) winning
  WHERE p_branch_id IS NOT NULL
    AND p_as_of IS NOT NULL
    AND p_raw_material_ids IS NOT NULL
    AND rm.branch_id=p_branch_id
    AND rm.id=ANY(p_raw_material_ids);
$bounded$;

-- Match the canonical price reader's EXECUTE boundary. PostgreSQL defaults
-- NEW functions to PUBLIC EXECUTE unless revoked; invoker/RLS alone is not
-- sufficient to enforce parity with the production function's grants.
REVOKE ALL ON FUNCTION public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)
  TO authenticated, service_role;


-- Next-stage experiment: compare the candidate with the currently callable
-- get_raw_material_current_prices(p_branch_id, ids) at NOW() for each permission
-- persona and mixed purchases/stock counts/pricing events, then test the
-- historical p_as_of boundary, equal-timestamp tie breaks and denied branches.
-- Do not replace/enable the production trigger in this experimental script.

-- Same snapshot fields/unknown value semantics, new bounded as-of reader.
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
    -- Bounded approved sources at this exact send time. Trigger remains paused.
    -- Do not use inventory averages, FIFO batch costs, or default-cost guesses.
    SELECT COALESCE(jsonb_object_agg(
      p.raw_material_id::text,
      jsonb_build_object('unit_cost',p.unit_cost, 'price_source',p.price_source, 'priced_at',p.priced_at)
    ), '{}'::jsonb)
    INTO v_prices
    FROM public._kitchen_approved_price_candidate(NEW.branch_id, v_raw_ids, COALESCE(NEW.created_at, now())) p
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


REVOKE ALL ON FUNCTION public._capture_kitchen_ingredient_prices()
  FROM PUBLIC, anon;
COMMENT ON FUNCTION public._capture_kitchen_ingredient_prices() IS
  'DISABLED until separately authorized. Bounded as-of approved ingredient prices; FIFO and posted ledger unchanged.';
-- NO CREATE/DROP/ENABLE/DISABLE TRIGGER. The original capture trigger MUST
-- stay disabled at the end of Stage A.
DO $assert_disabled$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.order_kitchen_inventory_events'::regclass
     AND tgname='trg_capture_kitchen_ingredient_prices' AND tgenabled='D')
 THEN RAISE EXCEPTION 'PRICE_TRIGGER_UNEXPECTEDLY_ENABLED'; END IF;
END;
$assert_disabled$;
