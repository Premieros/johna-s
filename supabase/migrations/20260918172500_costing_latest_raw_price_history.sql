-- Costing center: calculate recipe raw-material cost from the latest
-- authoritative price event and expose a dated purchase/stock-count history.
--
-- IMPORTANT:
-- * Inventory valuation/production continues to use _raw_wavg_cost unchanged.
-- * Costing-only calculations use _raw_cost_for_costing.
-- * Purchase prices come from inventory_ledger so invoice UOM prices are
--   normalized to the raw material's stock/base unit before costing.
-- * Applied stock-count item unit_cost is already stored in the stock/base unit.

CREATE OR REPLACE FUNCTION public._raw_cost_context_for_costing(
  p_raw_material_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
  v_cost numeric;
  v_priced_at timestamptz;
BEGIN
  -- Latest authoritative business event wins for Costing Center.
  SELECT e.unit_cost, e.source, e.priced_at, e.reference_number, e.detail
  INTO v_row
  FROM (
    SELECT
      il.unit_cost::numeric AS unit_cost,
      'purchase'::text AS source,
      il.created_at AS priced_at,
      COALESCE(NULLIF(il.reference_number, ''), p.invoice_number) AS reference_number,
      s.name::text AS detail,
      2 AS source_rank
    FROM public.inventory_ledger il
    JOIN public.purchases p
      ON p.id = il.reference_id
     AND il.reference_type = 'purchase'
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE il.raw_material_id = p_raw_material_id
      AND il.entry_type = 'purchase'
      AND p.status = 'completed'
      AND COALESCE(il.unit_cost, 0) > 0
      AND (p_branch_id IS NULL OR il.branch_id = p_branch_id)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)

    UNION ALL

    SELECT
      (norm.value->>'stock_unit_cost')::numeric AS unit_cost,
      'purchase'::text AS source,
      COALESCE(p.approved_at, pi.created_at, p.created_at) AS priced_at,
      p.invoice_number AS reference_number,
      s.name::text AS detail,
      2 AS source_rank
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
    WHERE pi.raw_material_id = p_raw_material_id
      AND p.status = 'completed'
      AND COALESCE(pi.unit_cost, 0) > 0
      AND COALESCE((norm.value->>'success')::boolean, false)
      AND COALESCE((norm.value->>'stock_unit_cost')::numeric, 0) > 0
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
      sci.unit_cost::numeric,
      'stock_count'::text,
      COALESCE(sc.applied_at, sc.approved_at, sc.created_at),
      sc.count_number,
      sci.reason,
      1 AS source_rank
    FROM public.stock_count_items sci
    JOIN public.stock_counts sc ON sc.id = sci.stock_count_id
    WHERE sci.raw_material_id = p_raw_material_id
      AND sc.status = 'applied'
      AND COALESCE(sci.unit_cost, 0) > 0
      AND (p_branch_id IS NULL OR sc.branch_id = p_branch_id)
  ) e
  ORDER BY e.priced_at DESC NULLS LAST, e.source_rank, e.reference_number DESC NULLS LAST
  LIMIT 1;

  IF FOUND AND COALESCE(v_row.unit_cost, 0) > 0 THEN
    RETURN jsonb_build_object(
      'unit_cost', round(v_row.unit_cost, 6),
      'source', v_row.source,
      'priced_at', v_row.priced_at,
      'reference_number', v_row.reference_number,
      'detail', v_row.detail
    );
  END IF;

  -- Fallbacks explain exactly where the displayed/calculated cost came from.
  SELECT rmi.avg_cost, rmi.updated_at
  INTO v_cost, v_priced_at
  FROM public.raw_material_inventory rmi
  WHERE rmi.raw_material_id = p_raw_material_id
    AND COALESCE(rmi.avg_cost, 0) > 0
    AND (p_branch_id IS NULL OR rmi.branch_id = p_branch_id)
  ORDER BY rmi.updated_at DESC NULLS LAST, rmi.id DESC
  LIMIT 1;

  IF COALESCE(v_cost, 0) > 0 THEN
    RETURN jsonb_build_object(
      'unit_cost', round(v_cost, 6),
      'source', 'inventory_average',
      'priced_at', v_priced_at,
      'reference_number', NULL,
      'detail', NULL
    );
  END IF;

  SELECT
    SUM(b.quantity * COALESCE(b.unit_cost, 0)) / NULLIF(SUM(b.quantity), 0),
    MAX(b.created_at)
  INTO v_cost, v_priced_at
  FROM public.raw_material_batches b
  WHERE b.raw_material_id = p_raw_material_id
    AND b.quantity > 0
    AND (p_branch_id IS NULL OR b.branch_id = p_branch_id);

  IF COALESCE(v_cost, 0) > 0 THEN
    RETURN jsonb_build_object(
      'unit_cost', round(v_cost, 6),
      'source', 'batch_average',
      'priced_at', v_priced_at,
      'reference_number', NULL,
      'detail', NULL
    );
  END IF;

  SELECT rm.default_cost
  INTO v_cost
  FROM public.raw_materials rm
  WHERE rm.id = p_raw_material_id
    AND (p_branch_id IS NULL OR rm.branch_id = p_branch_id)
  LIMIT 1;

  RETURN jsonb_build_object(
    'unit_cost', round(COALESCE(v_cost, 0), 6),
    'source', 'default_cost',
    'priced_at', NULL,
    'reference_number', NULL,
    'detail', NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._raw_cost_context_for_costing(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_cost_context_for_costing(uuid, uuid) TO service_role, postgres;


CREATE OR REPLACE FUNCTION public._raw_cost_for_costing(
  p_raw_material_id uuid,
  p_branch_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    NULLIF((public._raw_cost_context_for_costing(p_raw_material_id, p_branch_id)->>'unit_cost')::numeric, 0),
    0
  )
$function$;

REVOKE ALL ON FUNCTION public._raw_cost_for_costing(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_cost_for_costing(uuid, uuid) TO service_role, postgres;


-- Cost Center recipe calculations now use latest authoritative raw price only.
-- Inventory/production WAVG behavior is intentionally untouched.
CREATE OR REPLACE FUNCTION public._product_recipe_cost(
  p_product_id uuid,
  p_branch_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(round(SUM(
    ri.quantity * (1 + COALESCE(ri.wastage_percent, 0) / 100.0) *
    COALESCE(public._raw_cost_for_costing(ri.raw_material_id, p_branch_id), 0)
  ), 2), 0)
  FROM public.recipe_items ri
  JOIN public.recipes r ON r.id = ri.recipe_id
  WHERE r.product_id = p_product_id
    AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
$function$;

REVOKE ALL ON FUNCTION public._product_recipe_cost(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._product_recipe_cost(uuid, uuid) TO service_role, postgres;


CREATE OR REPLACE FUNCTION public.get_raw_material_cost_overview(
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  raw_material_id uuid,
  raw_material_name text,
  raw_material_code text,
  branch_id uuid,
  latest_cost numeric(18,6),
  previous_cost numeric(18,6),
  change_amount numeric(18,6),
  change_pct numeric(12,4),
  price_source text,
  priced_at timestamptz,
  reference_number text,
  source_detail text,
  event_count bigint
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
  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT
      il.raw_material_id,
      il.branch_id,
      il.unit_cost::numeric(18,6) AS unit_cost,
      'purchase'::text AS source,
      il.created_at AS priced_at,
      COALESCE(NULLIF(il.reference_number, ''), p.invoice_number) AS reference_number,
      s.name::text AS detail
    FROM public.inventory_ledger il
    JOIN public.purchases p
      ON p.id = il.reference_id
     AND il.reference_type = 'purchase'
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE il.raw_material_id IS NOT NULL
      AND il.entry_type = 'purchase'
      AND p.status = 'completed'
      AND COALESCE(il.unit_cost, 0) > 0
      AND (p_branch_id IS NULL OR il.branch_id = p_branch_id)
      AND public.user_may_access_branch(il.branch_id)

    UNION ALL

    SELECT
      pi.raw_material_id,
      p.branch_id,
      (norm.value->>'stock_unit_cost')::numeric(18,6) AS unit_cost,
      'purchase'::text AS source,
      COALESCE(p.approved_at, pi.created_at, p.created_at) AS priced_at,
      p.invoice_number AS reference_number,
      s.name::text AS detail
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
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND public.user_may_access_branch(p.branch_id)
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
      sci.raw_material_id,
      sc.branch_id,
      sci.unit_cost::numeric(18,6),
      'stock_count'::text,
      COALESCE(sc.applied_at, sc.approved_at, sc.created_at),
      sc.count_number,
      sci.reason
    FROM public.stock_count_items sci
    JOIN public.stock_counts sc ON sc.id = sci.stock_count_id
    WHERE sci.raw_material_id IS NOT NULL
      AND sc.status = 'applied'
      AND COALESCE(sci.unit_cost, 0) > 0
      AND (p_branch_id IS NULL OR sc.branch_id = p_branch_id)
      AND public.user_may_access_branch(sc.branch_id)
  ),
  ranked AS (
    SELECT
      e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.raw_material_id, e.branch_id
        ORDER BY e.priced_at DESC NULLS LAST,
                 CASE WHEN e.source = 'stock_count' THEN 1 ELSE 2 END,
                 e.reference_number DESC NULLS LAST
      ) AS rn,
      COUNT(*) OVER (PARTITION BY e.raw_material_id, e.branch_id)::bigint AS event_count
    FROM events e
  )
  SELECT
    rm.id,
    COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material')::text,
    rm.code::text,
    rm.branch_id,
    COALESCE(r1.unit_cost, (ctx.context->>'unit_cost')::numeric, 0)::numeric(18,6),
    r2.unit_cost::numeric(18,6),
    CASE
      WHEN r2.unit_cost IS NULL THEN NULL
      ELSE (COALESCE(r1.unit_cost, (ctx.context->>'unit_cost')::numeric, 0) - r2.unit_cost)::numeric(18,6)
    END,
    CASE
      WHEN COALESCE(r2.unit_cost, 0) <= 0 THEN NULL
      ELSE round(
        (COALESCE(r1.unit_cost, (ctx.context->>'unit_cost')::numeric, 0) - r2.unit_cost)
        * 100.0 / r2.unit_cost,
        4
      )::numeric(12,4)
    END,
    COALESCE(r1.source, ctx.context->>'source')::text,
    COALESCE(r1.priced_at, NULLIF(ctx.context->>'priced_at', '')::timestamptz),
    COALESCE(r1.reference_number, ctx.context->>'reference_number')::text,
    COALESCE(r1.detail, ctx.context->>'detail')::text,
    COALESCE(r1.event_count, 0)::bigint
  FROM public.raw_materials rm
  LEFT JOIN ranked r1
    ON r1.raw_material_id = rm.id
   AND r1.branch_id = rm.branch_id
   AND r1.rn = 1
  LEFT JOIN ranked r2
    ON r2.raw_material_id = rm.id
   AND r2.branch_id = rm.branch_id
   AND r2.rn = 2
  CROSS JOIN LATERAL (
    SELECT public._raw_cost_context_for_costing(rm.id, rm.branch_id) AS context
  ) ctx
  WHERE rm.is_active = true
    AND (p_branch_id IS NULL OR rm.branch_id = p_branch_id)
    AND public.user_may_access_branch(rm.branch_id)
  ORDER BY rm.name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_raw_material_cost_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_cost_overview(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_raw_material_cost_history(
  p_raw_material_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  event_id text,
  raw_material_id uuid,
  raw_material_name text,
  branch_id uuid,
  unit_cost numeric(18,6),
  previous_cost numeric(18,6),
  change_amount numeric(18,6),
  change_pct numeric(12,4),
  price_source text,
  priced_at timestamptz,
  reference_number text,
  source_detail text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_material_branch uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.can_permission('reports.costing') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT rm.branch_id
  INTO v_material_branch
  FROM public.raw_materials rm
  WHERE rm.id = p_raw_material_id;

  IF v_material_branch IS NULL THEN
    RETURN;
  END IF;
  IF p_branch_id IS NOT NULL AND p_branch_id <> v_material_branch THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  IF NOT public.user_may_access_branch(v_material_branch) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT
      il.id::text AS event_id,
      il.raw_material_id,
      il.branch_id,
      il.unit_cost::numeric(18,6) AS unit_cost,
      'purchase'::text AS source,
      il.created_at AS priced_at,
      COALESCE(NULLIF(il.reference_number, ''), p.invoice_number) AS reference_number,
      s.name::text AS detail
    FROM public.inventory_ledger il
    JOIN public.purchases p
      ON p.id = il.reference_id
     AND il.reference_type = 'purchase'
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE il.raw_material_id = p_raw_material_id
      AND il.branch_id = v_material_branch
      AND il.entry_type = 'purchase'
      AND p.status = 'completed'
      AND COALESCE(il.unit_cost, 0) > 0

    UNION ALL

    SELECT
      'legacy-purchase:' || pi.id::text AS event_id,
      pi.raw_material_id,
      p.branch_id,
      (norm.value->>'stock_unit_cost')::numeric(18,6) AS unit_cost,
      'purchase'::text AS source,
      COALESCE(p.approved_at, pi.created_at, p.created_at) AS priced_at,
      p.invoice_number AS reference_number,
      s.name::text AS detail
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
    WHERE pi.raw_material_id = p_raw_material_id
      AND p.branch_id = v_material_branch
      AND p.status = 'completed'
      AND COALESCE(pi.unit_cost, 0) > 0
      AND COALESCE((norm.value->>'success')::boolean, false)
      AND COALESCE((norm.value->>'stock_unit_cost')::numeric, 0) > 0
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
      sc.count_number,
      sci.reason
    FROM public.stock_count_items sci
    JOIN public.stock_counts sc ON sc.id = sci.stock_count_id
    WHERE sci.raw_material_id = p_raw_material_id
      AND sc.branch_id = v_material_branch
      AND sc.status = 'applied'
      AND COALESCE(sci.unit_cost, 0) > 0
  ),
  sequenced AS (
    SELECT
      e.*,
      LEAD(e.unit_cost) OVER (
        ORDER BY e.priced_at DESC NULLS LAST,
                 CASE WHEN e.source = 'stock_count' THEN 1 ELSE 2 END,
                 e.reference_number DESC NULLS LAST
      ) AS previous_cost
    FROM events e
  )
  SELECT
    e.event_id,
    e.raw_material_id,
    COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material')::text,
    e.branch_id,
    e.unit_cost,
    e.previous_cost::numeric(18,6),
    CASE
      WHEN e.previous_cost IS NULL THEN NULL
      ELSE (e.unit_cost - e.previous_cost)::numeric(18,6)
    END,
    CASE
      WHEN COALESCE(e.previous_cost, 0) <= 0 THEN NULL
      ELSE round((e.unit_cost - e.previous_cost) * 100.0 / e.previous_cost, 4)::numeric(12,4)
    END,
    e.source,
    e.priced_at,
    e.reference_number,
    e.detail
  FROM sequenced e
  JOIN public.raw_materials rm ON rm.id = e.raw_material_id
  ORDER BY e.priced_at DESC NULLS LAST,
           CASE WHEN e.source = 'stock_count' THEN 1 ELSE 2 END,
           e.reference_number DESC NULLS LAST
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_raw_material_cost_history(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_cost_history(uuid, uuid, integer) TO authenticated, service_role;


-- Product detail now displays the exact raw price source/date/reference used by
-- Costing Center, while keeping product/BOM cost logic unchanged.
CREATE OR REPLACE FUNCTION public.get_product_costing_detail(
  p_product_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_scope uuid;
  v_row record;
  v_components jsonb;
  v_recipe jsonb;
  v_history jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('reports.costing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;
  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT
    p.id, p.name, p.barcode, p.sku, p.branch_id,
    COALESCE(p.sale_price, 0) AS sale_price,
    COALESCE(public._product_wavg_cost(p.id, p.branch_id), 0) AS unit_cost,
    COALESCE(public._product_bom_cost(p.id, p.branch_id), 0) AS theoretical_cost,
    COALESCE(public._product_recipe_cost(p.id, p.branch_id), 0) AS actual_cost,
    (SELECT COUNT(*) FROM public.product_components pc WHERE pc.product_id = p.id) AS component_count,
    (SELECT COUNT(*) FROM public.recipe_items ri JOIN public.recipes r ON r.id = ri.recipe_id
      WHERE r.product_id = p.id) AS recipe_item_count
  INTO v_row
  FROM public.products p
  WHERE p.id = p_product_id
    AND public.user_may_access_branch(p.branch_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id);

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  v_scope := v_row.branch_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'component_product_id', cp.id,
    'component_name', COALESCE(NULLIF(btrim(cp.name), ''), 'Component'),
    'quantity', pc.quantity,
    'unit_cost', COALESCE(public._product_wavg_cost(pc.component_product_id, v_scope), 0),
    'line_cost', round(pc.quantity * COALESCE(public._product_wavg_cost(pc.component_product_id, v_scope), 0), 2)
  ) ORDER BY cp.name), '[]'::jsonb)
  INTO v_components
  FROM public.product_components pc
  JOIN public.products cp ON cp.id = pc.component_product_id
  WHERE pc.product_id = p_product_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'raw_material_id', rm.id,
    'raw_material_name', COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
    'quantity', ri.quantity,
    'wastage_percent', ri.wastage_percent,
    'unit_cost', COALESCE((ctx.context->>'unit_cost')::numeric, 0),
    'line_cost', round(
      ri.quantity * (1 + COALESCE(ri.wastage_percent, 0) / 100.0)
      * COALESCE((ctx.context->>'unit_cost')::numeric, 0),
      2
    ),
    'cost_source', ctx.context->>'source',
    'cost_priced_at', ctx.context->>'priced_at',
    'cost_reference', ctx.context->>'reference_number',
    'cost_detail', ctx.context->>'detail'
  ) ORDER BY rm.name), '[]'::jsonb)
  INTO v_recipe
  FROM public.recipe_items ri
  JOIN public.recipes r ON r.id = ri.recipe_id
  JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
  CROSS JOIN LATERAL (
    SELECT public._raw_cost_context_for_costing(ri.raw_material_id, v_scope) AS context
  ) ctx
  WHERE r.product_id = p_product_id
    AND (v_scope IS NULL OR r.branch_id = v_scope);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ch.id,
    'old_cost', ch.old_cost,
    'new_cost', ch.new_cost,
    'changed_at', ch.changed_at,
    'changed_by', COALESCE(NULLIF(btrim(u.username), ''), u.full_name, u.email, ''),
    'source', ch.source
  ) ORDER BY ch.changed_at DESC), '[]'::jsonb)
  INTO v_history
  FROM public.product_cost_history ch
  LEFT JOIN public.users u ON u.id = ch.changed_by
  WHERE ch.product_id = p_product_id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_row.id,
    'product_name', v_row.name,
    'barcode', v_row.barcode,
    'sku', v_row.sku,
    'sale_price', v_row.sale_price,
    'unit_cost', v_row.unit_cost,
    'theoretical_cost', v_row.theoretical_cost,
    'actual_cost', v_row.actual_cost,
    'component_count', v_row.component_count,
    'recipe_item_count', v_row.recipe_item_count,
    'components', v_components,
    'recipe_items', v_recipe,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_costing_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_costing_detail(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public._raw_cost_for_costing(uuid, uuid) IS
  'Costing-only raw material price: latest completed purchase or applied stock count; falls back to inventory average, batch average, then default cost. Inventory valuation remains on _raw_wavg_cost.';

COMMENT ON FUNCTION public.get_raw_material_cost_history(uuid, uuid, integer) IS
  'Dated normalized raw-material price history from completed purchases and applied stock counts, branch/permission scoped.';
