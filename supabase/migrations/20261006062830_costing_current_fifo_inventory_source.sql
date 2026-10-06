-- PROPOSAL ONLY: separate explicit Production approval required.
-- Use the actual FIFO-layer valuation already maintained by inventory, including
-- its last retained actual average at zero/negative stock. Reference price history
-- remains separate. No stock/ledger/journal/operational function is changed.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $patch$
DECLARE
  definition text;
  original text;
  start_at integer;
  end_at integer;
  replacement text;
BEGIN
  SELECT pg_get_functiondef('public._raw_cost_context_for_costing(uuid,uuid)'::regprocedure) INTO definition;
  IF position('-- Newest authoritative event wins, regardless of source type.' IN definition) = 0 THEN
    RAISE EXCEPTION 'RAW_COST_CONTEXT_BASELINE_CHANGED';
  END IF;
  start_at := position(E'BEGIN\n' IN definition);
  end_at := position(E'\nEND;\n$function$' IN definition);
  IF start_at = 0 OR end_at <= start_at THEN RAISE EXCEPTION 'RAW_COST_CONTEXT_BODY_CHANGED'; END IF;
  original := substring(definition FROM start_at FOR end_at - start_at + length(E'\nEND;'));
  replacement := $body$BEGIN
  SELECT rmi.avg_cost, rmi.updated_at INTO v_cost, v_priced_at
  FROM public.raw_material_inventory rmi
  WHERE rmi.raw_material_id = p_raw_material_id
    AND (p_branch_id IS NULL OR rmi.branch_id = p_branch_id)
  ORDER BY rmi.updated_at DESC NULLS LAST, rmi.id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'unit_cost', COALESCE(v_cost, 0),
    'source', 'inventory_average',
    'priced_at', v_priced_at,
    'reference_number', NULL,
    'detail', 'Current actual FIFO inventory valuation; reference price events do not revalue existing layers'
  );
END;$body$;
  EXECUTE replace(definition, original, replacement);

  SELECT pg_get_functiondef('public.get_costing_overview(uuid)'::regprocedure) INTO definition;
  IF position('public._raw_cost_events_for_costing(NULL, v_scope)' IN definition) = 0
     OR position('public.is_pos_admin()' IN definition) = 0 THEN
    RAISE EXCEPTION 'COSTING_OVERVIEW_BASELINE_CHANGED';
  END IF;
  start_at := position('  events AS MATERIALIZED (' IN definition);
  end_at := position('  product_wavg AS MATERIALIZED (' IN definition);
  IF start_at = 0 OR end_at <= start_at THEN RAISE EXCEPTION 'COSTING_OVERVIEW_CTE_CHANGED'; END IF;
  original := substring(definition FROM start_at FOR end_at - start_at);
  replacement := $cte$  raw_costs AS MATERIALIZED (
    SELECT srm.id AS raw_material_id, srm.branch_id,
      COALESCE(rmi.avg_cost, 0)::numeric AS unit_cost
    FROM scoped_raw_materials srm
    LEFT JOIN public.raw_material_inventory rmi
      ON rmi.raw_material_id = srm.id AND rmi.branch_id = srm.branch_id
  ),
$cte$;
  EXECUTE replace(definition, original, replacement);

  -- Current negative-stock exposure remains an estimate, using the same last
  -- actual FIFO valuation rather than a manual/purchase/count reference price.
  SELECT pg_get_functiondef('public.get_raw_material_cost_valuation_overview(uuid)'::regprocedure) INTO definition;
  original := 'COALESCE(NULLIF(pr.latest_cost, 0), NULLIF(b.unit_cost, 0), 0)';
  IF (length(definition)-length(replace(definition,original,''))) / length(original) <> 2
     OR position('public.can_permission(''reports.costing'')' IN definition) = 0 THEN
    RAISE EXCEPTION 'RAW_VALUATION_BASELINE_CHANGED';
  END IF;
  definition := replace(definition, original, 'COALESCE(NULLIF(fi.avg_cost, 0), 0)');
  original := '    GROUP BY b.raw_material_id, b.branch_id';
  IF position(original IN definition) = 0 THEN RAISE EXCEPTION 'RAW_VALUATION_GROUP_CHANGED'; END IF;
  replacement := E'    LEFT JOIN public.raw_material_inventory fi\n      ON fi.raw_material_id = b.raw_material_id AND fi.branch_id = b.branch_id\n' || original;
  EXECUTE replace(definition, original, replacement);
END;
$patch$;
COMMIT;
