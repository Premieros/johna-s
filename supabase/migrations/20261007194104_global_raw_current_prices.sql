-- REVIEW PROPOSAL: do not apply to production without separate approval.
-- Latest price is a current estimate, never a rewrite of actual FIFO stock/COGS.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE FUNCTION public.get_raw_material_current_prices(
  p_branch_id uuid DEFAULT NULL,
  p_raw_material_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (raw_material_id uuid, branch_id uuid, unit_cost numeric,
  price_source text, priced_at timestamptz, reference_number text)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  WITH scoped AS MATERIALIZED (
    SELECT rm.* FROM public.raw_materials rm
    WHERE (p_branch_id IS NULL OR rm.branch_id = p_branch_id)
      AND (p_raw_material_ids IS NULL OR rm.id = ANY(p_raw_material_ids))
  ), events AS (
  SELECT
    il.id::text AS event_id,
    il.raw_material_id,
    il.branch_id,
    il.unit_cost::numeric(18,6),
    'purchase'::text AS source,
    il.created_at AS priced_at,
    COALESCE(NULLIF(il.reference_number, ''), p.invoice_number)::text,
    s.name::text,
    3
  FROM public.inventory_ledger il
  JOIN public.purchases p
    ON p.id = il.reference_id
   AND il.reference_type = 'purchase'
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE il.raw_material_id IS NOT NULL
    AND il.entry_type = 'purchase'
    AND p.status = 'completed'
    AND COALESCE(il.unit_cost, 0) > 0
    AND (p_raw_material_ids IS NULL OR il.raw_material_id = ANY(p_raw_material_ids))
    AND (p_branch_id IS NULL OR il.branch_id = p_branch_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)

  UNION ALL

  SELECT
    'legacy-purchase:' || pi.id::text,
    pi.raw_material_id,
    p.branch_id,
    (norm.value->>'stock_unit_cost')::numeric(18,6),
    'purchase'::text,
    COALESCE(p.approved_at, pi.created_at, p.created_at),
    p.invoice_number::text,
    s.name::text,
    3
  FROM public.purchase_items pi
  JOIN public.purchases p ON p.id = pi.purchase_id
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  CROSS JOIN LATERAL (
    SELECT public._normalize_raw_purchase_uom(
      pi.raw_material_id,
      pi.quantity,
      pi.unit_cost,
      pi.unit_name
    ) AS value
  ) norm
  WHERE pi.raw_material_id IS NOT NULL
    AND p.status = 'completed'
    AND COALESCE(pi.unit_cost, 0) > 0
    AND COALESCE((norm.value->>'success')::boolean, false)
    AND COALESCE((norm.value->>'stock_unit_cost')::numeric, 0) > 0
    AND (p_raw_material_ids IS NULL OR pi.raw_material_id = ANY(p_raw_material_ids))
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_ledger il
      WHERE il.reference_id = p.id
        AND il.reference_type = 'purchase'
        AND il.entry_type = 'purchase'
        AND il.raw_material_id = pi.raw_material_id
    )

  UNION ALL

  SELECT
    sci.id::text,
    sci.raw_material_id,
    sc.branch_id,
    sci.unit_cost::numeric(18,6),
    'stock_count'::text,
    COALESCE(sc.applied_at, sc.approved_at, sc.created_at),
    sc.count_number::text,
    sci.reason::text,
    2
  FROM public.stock_count_items sci
  JOIN public.stock_counts sc ON sc.id = sci.stock_count_id
  WHERE sci.raw_material_id IS NOT NULL
    AND sc.status = 'applied'
    AND COALESCE(sci.unit_cost, 0) > 0
    AND (p_raw_material_ids IS NULL OR sci.raw_material_id = ANY(p_raw_material_ids))
    AND (p_branch_id IS NULL OR sc.branch_id = p_branch_id)

  UNION ALL

  SELECT
    'pricing:' || pe.id::text,
    pe.raw_material_id,
    pe.branch_id,
    pe.unit_cost::numeric(18,6),
    'pricing'::text,
    pe.priced_at,
    pe.reference_number::text,
    pe.detail::text,
    1
  FROM public.raw_material_price_events pe
  WHERE pe.unit_cost > 0
    AND (p_raw_material_ids IS NULL OR pe.raw_material_id = ANY(p_raw_material_ids))
    AND (p_branch_id IS NULL OR pe.branch_id = p_branch_id)
  ), latest AS MATERIALIZED (
    SELECT DISTINCT ON (e.raw_material_id, e.branch_id) e.*
    FROM events e JOIN scoped s ON s.id=e.raw_material_id AND s.branch_id=e.branch_id
    WHERE e.unit_cost > 0
    ORDER BY e.raw_material_id,e.branch_id,e.priced_at DESC NULLS LAST,
      e.source_rank,e.reference_number DESC NULLS LAST,e.event_id DESC
  )
  SELECT s.id,s.branch_id,
    COALESCE(e.unit_cost,i.unit_cost,b.unit_cost,NULLIF(GREATEST(s.default_cost,0),0)),
    CASE WHEN e.unit_cost IS NOT NULL THEN e.source
      WHEN i.unit_cost IS NOT NULL THEN 'inventory_average'
      WHEN b.unit_cost IS NOT NULL THEN 'last_batch'
      WHEN s.default_cost > 0 THEN 'default_cost' ELSE 'unpriced' END,
    COALESCE(e.priced_at,i.priced_at,b.priced_at),e.reference_number
  FROM scoped s
  LEFT JOIN latest e ON e.raw_material_id=s.id AND e.branch_id=s.branch_id
  LEFT JOIN LATERAL (
    SELECT rmi.avg_cost AS unit_cost,rmi.updated_at AS priced_at
    FROM public.raw_material_inventory rmi
    WHERE rmi.raw_material_id=s.id AND rmi.branch_id=s.branch_id AND rmi.avg_cost>0
    ORDER BY rmi.updated_at DESC NULLS LAST,rmi.id DESC LIMIT 1
  ) i ON e.unit_cost IS NULL
  LEFT JOIN LATERAL (
    SELECT rb.unit_cost,rb.created_at AS priced_at
    FROM public.raw_material_batches rb
    WHERE rb.raw_material_id=s.id AND rb.branch_id=s.branch_id AND rb.unit_cost>0
      AND rb.source_type NOT LIKE '%oversold%'
    ORDER BY rb.created_at DESC NULLS LAST,rb.id DESC LIMIT 1
  ) b ON e.unit_cost IS NULL AND i.unit_cost IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.get_raw_material_current_prices(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_current_prices(uuid,uuid[]) TO authenticated,service_role;

-- Preserve existing function security modes, grants, branch and permission gates.
DO $patch$
DECLARE definition text; original text; replacement text; start_at integer; end_at integer;
BEGIN
  SELECT pg_get_functiondef('public._raw_cost_context_for_costing(uuid,uuid)'::regprocedure) INTO definition;
  IF position('Current actual FIFO inventory valuation' IN definition)=0 THEN
    RAISE EXCEPTION 'RAW_COST_CONTEXT_BASELINE_CHANGED';
  END IF;
  start_at:=position(E'BEGIN\n' IN definition);
  end_at:=position(E'\nEND;\n$function$' IN definition);
  IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'RAW_COST_CONTEXT_BODY_CHANGED'; END IF;
  original:=substring(definition FROM start_at FOR end_at-start_at+length(E'\nEND;'));
  replacement:=$body$BEGIN
    SELECT c.unit_cost,c.price_source,c.priced_at,c.reference_number
      INTO v_row FROM public.get_raw_material_current_prices(p_branch_id,ARRAY[p_raw_material_id]) c;
    RETURN jsonb_build_object('unit_cost',COALESCE(v_row.unit_cost,0),
      'source',COALESCE(v_row.price_source,'unpriced'),'priced_at',v_row.priced_at,
      'reference_number',v_row.reference_number,'detail','Latest known price; current costing estimate');
END;$body$;
  EXECUTE replace(definition,original,replacement);

  SELECT pg_get_functiondef('public.get_costing_overview(uuid)'::regprocedure) INTO definition;
  IF position('COALESCE(rmi.avg_cost, 0)::numeric AS unit_cost' IN definition)=0
     OR position('public.can_permission(''reports.costing'')' IN definition)=0 THEN
    RAISE EXCEPTION 'COSTING_OVERVIEW_BASELINE_CHANGED';
  END IF;
  start_at:=position('  raw_costs AS MATERIALIZED (' IN definition);
  end_at:=position('  product_wavg AS MATERIALIZED (' IN definition);
  IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'COSTING_OVERVIEW_CTE_CHANGED'; END IF;
  original:=substring(definition FROM start_at FOR end_at-start_at);
  replacement:=$cte$  raw_costs AS MATERIALIZED (
    SELECT srm.id AS raw_material_id,srm.branch_id,COALESCE(cp.unit_cost,0)::numeric AS unit_cost
    FROM scoped_raw_materials srm
    LEFT JOIN public.get_raw_material_current_prices(v_scope) cp
      ON cp.raw_material_id=srm.id AND cp.branch_id=srm.branch_id
  ),
$cte$;
  EXECUTE replace(definition,original,replacement);

  SELECT pg_get_functiondef('public.get_raw_material_cost_valuation_overview(uuid)'::regprocedure) INTO definition;
  original:='COALESCE(NULLIF(fi.avg_cost, 0), 0)';
  IF (length(definition)-length(replace(definition,original,'')))/length(original)<>2
     OR position('public.can_permission(''reports.costing'')' IN definition)=0 THEN
    RAISE EXCEPTION 'RAW_VALUATION_BASELINE_CHANGED';
  END IF;
  definition:=replace(definition,original,'COALESCE(cp.unit_cost, 0)');
  original:=E'    LEFT JOIN public.raw_material_inventory fi\n      ON fi.raw_material_id = b.raw_material_id AND fi.branch_id = b.branch_id';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'RAW_VALUATION_JOIN_CHANGED'; END IF;
  replacement:=E'    LEFT JOIN public.get_raw_material_current_prices(p_branch_id) cp\n      ON cp.raw_material_id = b.raw_material_id AND cp.branch_id = b.branch_id';
  EXECUTE replace(definition,original,replacement);

  SELECT pg_get_functiondef('public.get_raw_consumption_cost_breakdown(uuid,timestamptz,timestamptz)'::regprocedure) INTO definition;
  original:=E'public._raw_last_known_fifo_cost(\n          m.raw_material_id,\n          m.branch_id,\n          m.warehouse_id\n        )';
  IF position(original IN definition)=0
     OR position('private.financial_reference_visible(' IN definition)=0 THEN
    RAISE EXCEPTION 'RAW_CONSUMPTION_ESTIMATE_BASELINE_CHANGED';
  END IF;
  definition:=replace(definition,original,'COALESCE(cp.unit_cost,0)');
  original:='    FROM movements m';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'RAW_CONSUMPTION_JOIN_CHANGED'; END IF;
  EXECUTE replace(definition,original,original||E'\n    LEFT JOIN public.get_raw_material_current_prices(p_branch_id) cp\n      ON cp.raw_material_id=m.raw_material_id AND cp.branch_id=m.branch_id');

  SELECT pg_get_functiondef('public.get_current_raw_material_valuation(uuid)'::regprocedure) INTO definition;
  original:=E'public._raw_last_known_fifo_cost(\n          d.raw_material_id,\n          p_branch_id,\n          d.warehouse_id\n        )';
  IF position(original IN definition)=0
     OR position('public.can_permission(''reports.costing'')' IN definition)=0 THEN
    RAISE EXCEPTION 'RAW_DEBT_ESTIMATE_BASELINE_CHANGED';
  END IF;
  definition:=replace(definition,original,'COALESCE(cp.unit_cost,0)');
  original:='      FROM debt_by_warehouse d';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'RAW_DEBT_JOIN_CHANGED'; END IF;
  EXECUTE replace(definition,original,original||E'\n      LEFT JOIN public.get_raw_material_current_prices(p_branch_id) cp\n        ON cp.raw_material_id=d.raw_material_id AND cp.branch_id=p_branch_id');
END;
$patch$;
COMMIT;
