-- Treat manual raw-material pricing as an authoritative Costing Center event.
--
-- Business rule:
--   The newest event by timestamp wins for Costing Center recipe/raw pricing,
--   regardless of whether the source is:
--     1) completed purchase,
--     2) applied stock count,
--     3) manual pricing.
--
-- Inventory quantity / raw_material_inventory.avg_cost / batch valuation are
-- intentionally untouched. Manual pricing affects costing analysis only and is
-- retained in the same chronological history shown by Costing Center.

CREATE TABLE IF NOT EXISTS public.raw_material_price_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  unit_cost numeric(18,6) NOT NULL CHECK (unit_cost > 0),
  source text NOT NULL DEFAULT 'pricing' CHECK (source = 'pricing'),
  reference_number text NOT NULL,
  detail text,
  priced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_raw_material_price_events_lookup
  ON public.raw_material_price_events(raw_material_id, branch_id, priced_at DESC, id DESC);

ALTER TABLE public.raw_material_price_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS raw_material_price_events_select ON public.raw_material_price_events;
CREATE POLICY raw_material_price_events_select
ON public.raw_material_price_events
FOR SELECT
TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND (
    public.can_permission('reports.costing')
    OR public.can_permission('raw_materials.view')
    OR public.can_permission('raw_materials.manage')
  )
);

REVOKE ALL ON TABLE public.raw_material_price_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.raw_material_price_events TO authenticated;
GRANT ALL ON TABLE public.raw_material_price_events TO service_role;


CREATE OR REPLACE FUNCTION public.set_raw_material_price(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_unit_cost numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_material_branch uuid;
  v_event_id uuid := gen_random_uuid();
  v_priced_at timestamptz := clock_timestamp();
  v_reference text;
  v_role text := COALESCE(current_setting('role', true), '');
BEGIN
  IF p_unit_cost IS NULL OR p_unit_cost <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRICE');
  END IF;

  SELECT rm.branch_id
  INTO v_material_branch
  FROM public.raw_materials rm
  WHERE rm.id = p_raw_material_id
    AND rm.is_active = true
  FOR UPDATE;

  IF v_material_branch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_NOT_FOUND');
  END IF;

  IF p_branch_id IS NULL OR p_branch_id <> v_material_branch THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_role <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('raw_materials.manage') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PERMISSION_DENIED',
        'permission', 'raw_materials.manage'
      );
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
  END IF;

  v_reference :=
    'PRICE-' ||
    to_char(v_priced_at, 'YYYYMMDD-HH24MISSMS') ||
    '-' ||
    upper(substr(replace(v_event_id::text, '-', ''), 1, 6));

  INSERT INTO public.raw_material_price_events(
    id,
    raw_material_id,
    branch_id,
    unit_cost,
    source,
    reference_number,
    detail,
    priced_at,
    created_by
  )
  VALUES (
    v_event_id,
    p_raw_material_id,
    p_branch_id,
    round(p_unit_cost, 6),
    'pricing',
    v_reference,
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    v_priced_at,
    auth.uid()
  );

  -- Keep default_cost aligned as the catalog fallback/reference value only.
  -- This does NOT alter raw_material_inventory.avg_cost or batch valuation.
  UPDATE public.raw_materials
  SET default_cost = round(p_unit_cost, 6)
  WHERE id = p_raw_material_id
    AND branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'reference_number', v_reference,
    'unit_cost', round(p_unit_cost, 6),
    'source', 'pricing',
    'priced_at', v_priced_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_raw_material_price(uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_raw_material_price(uuid, uuid, numeric, text)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public._raw_cost_events_for_costing(
  p_raw_material_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  event_id text,
  raw_material_id uuid,
  branch_id uuid,
  unit_cost numeric(18,6),
  source text,
  priced_at timestamptz,
  reference_number text,
  detail text,
  source_rank integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
    AND (p_raw_material_id IS NULL OR il.raw_material_id = p_raw_material_id)
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
    AND (p_raw_material_id IS NULL OR pi.raw_material_id = p_raw_material_id)
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
    AND (p_raw_material_id IS NULL OR sci.raw_material_id = p_raw_material_id)
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
    AND (p_raw_material_id IS NULL OR pe.raw_material_id = p_raw_material_id)
    AND (p_branch_id IS NULL OR pe.branch_id = p_branch_id);
$function$;

REVOKE ALL ON FUNCTION public._raw_cost_events_for_costing(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_cost_events_for_costing(uuid, uuid)
  TO service_role, postgres;


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
  -- Newest authoritative event wins, regardless of source type.
  SELECT
    e.unit_cost,
    e.source,
    e.priced_at,
    e.reference_number,
    e.detail
  INTO v_row
  FROM public._raw_cost_events_for_costing(p_raw_material_id, p_branch_id) e
  ORDER BY
    e.priced_at DESC NULLS LAST,
    e.source_rank,
    e.reference_number DESC NULLS LAST,
    e.event_id DESC
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

  -- Fallbacks are used only when there is no authoritative purchase/count/pricing event.
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

REVOKE ALL ON FUNCTION public._raw_cost_context_for_costing(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_cost_context_for_costing(uuid, uuid)
  TO service_role, postgres;


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
    SELECT e.*
    FROM public._raw_cost_events_for_costing(NULL, p_branch_id) e
    WHERE public.user_may_access_branch(e.branch_id)
  ),
  ranked AS (
    SELECT
      e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.raw_material_id, e.branch_id
        ORDER BY
          e.priced_at DESC NULLS LAST,
          e.source_rank,
          e.reference_number DESC NULLS LAST,
          e.event_id DESC
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
      ELSE (
        COALESCE(r1.unit_cost, (ctx.context->>'unit_cost')::numeric, 0)
        - r2.unit_cost
      )::numeric(18,6)
    END,
    CASE
      WHEN COALESCE(r2.unit_cost, 0) <= 0 THEN NULL
      ELSE round(
        (
          COALESCE(r1.unit_cost, (ctx.context->>'unit_cost')::numeric, 0)
          - r2.unit_cost
        ) * 100.0 / r2.unit_cost,
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

REVOKE ALL ON FUNCTION public.get_raw_material_cost_overview(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_cost_overview(uuid)
  TO authenticated, service_role;


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
    SELECT e.*
    FROM public._raw_cost_events_for_costing(p_raw_material_id, v_material_branch) e
  ),
  sequenced AS (
    SELECT
      e.*,
      LEAD(e.unit_cost) OVER (
        ORDER BY
          e.priced_at DESC NULLS LAST,
          e.source_rank,
          e.reference_number DESC NULLS LAST,
          e.event_id DESC
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
      ELSE round(
        (e.unit_cost - e.previous_cost) * 100.0 / e.previous_cost,
        4
      )::numeric(12,4)
    END,
    e.source,
    e.priced_at,
    e.reference_number,
    e.detail
  FROM sequenced e
  JOIN public.raw_materials rm ON rm.id = e.raw_material_id
  ORDER BY
    e.priced_at DESC NULLS LAST,
    e.source_rank,
    e.reference_number DESC NULLS LAST,
    e.event_id DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_raw_material_cost_history(uuid, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_cost_history(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON TABLE public.raw_material_price_events IS
  'Manual raw-material pricing events used by Costing Center chronology. Newest purchase, applied stock count, or pricing event wins.';

COMMENT ON FUNCTION public.set_raw_material_price(uuid, uuid, numeric, text) IS
  'Records a manual raw-material costing price event. Does not change inventory quantity or avg_cost.';
