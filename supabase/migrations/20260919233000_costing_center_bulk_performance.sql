-- Bulk-costing performance repair.
--
-- Problem:
--   Costing Center repeatedly invoked scalar cost functions per raw material
--   and per recipe line. With hundreds of raw materials and 1k+ recipe lines,
--   this caused the same purchase/count/pricing sources to be rescanned
--   hundreds of times.
--
-- Repair:
--   1) Build raw-material authoritative pricing once per request.
--   2) Aggregate recipe/BOM costs in set-based CTEs.
--   3) Add an index for settled kitchen-cost lookups used by sales summary.
--
-- Business rules, branch scope, permissions, FIFO/inventory valuation and
-- pricing chronology are unchanged.

CREATE INDEX IF NOT EXISTS idx_kitchen_inventory_events_settled_sale
  ON public.order_kitchen_inventory_events(settled_sale_id)
  WHERE settled_sale_id IS NOT NULL;


CREATE OR REPLACE FUNCTION public.get_raw_material_cost_overview(
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
  IF p_branch_id IS NOT NULL
     AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  WITH scoped_materials AS MATERIALIZED (
    SELECT
      rm.id,
      rm.name,
      rm.code,
      rm.branch_id,
      rm.default_cost
    FROM public.raw_materials rm
    WHERE rm.is_active = true
      AND (p_branch_id IS NULL OR rm.branch_id = p_branch_id)
      AND public.user_may_access_branch(rm.branch_id)
  ),
  scoped_branches AS MATERIALIZED (
    SELECT DISTINCT sm.branch_id
    FROM scoped_materials sm
  ),
  events AS MATERIALIZED (
    SELECT e.*
    FROM public._raw_cost_events_for_costing(NULL, p_branch_id) e
    JOIN scoped_branches sb ON sb.branch_id = e.branch_id
  ),
  ranked AS MATERIALIZED (
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
      COUNT(*) OVER (
        PARTITION BY e.raw_material_id, e.branch_id
      )::bigint AS event_count
    FROM events e
  ),
  inventory_latest AS MATERIALIZED (
    SELECT DISTINCT ON (rmi.raw_material_id, rmi.branch_id)
      rmi.raw_material_id,
      rmi.branch_id,
      rmi.avg_cost::numeric(18,6) AS unit_cost,
      rmi.updated_at AS priced_at
    FROM public.raw_material_inventory rmi
    JOIN scoped_materials sm
      ON sm.id = rmi.raw_material_id
     AND sm.branch_id = rmi.branch_id
    WHERE COALESCE(rmi.avg_cost, 0) > 0
    ORDER BY
      rmi.raw_material_id,
      rmi.branch_id,
      rmi.updated_at DESC NULLS LAST,
      rmi.id DESC
  ),
  batch_average AS MATERIALIZED (
    SELECT
      b.raw_material_id,
      b.branch_id,
      NULLIF(
        SUM(b.quantity * COALESCE(b.unit_cost, 0))
        / NULLIF(SUM(b.quantity), 0),
        0
      )::numeric(18,6) AS unit_cost,
      MAX(b.created_at) AS priced_at
    FROM public.raw_material_batches b
    JOIN scoped_materials sm
      ON sm.id = b.raw_material_id
     AND sm.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.raw_material_id, b.branch_id
  )
  SELECT
    sm.id,
    COALESCE(NULLIF(btrim(sm.name), ''), 'Raw Material')::text,
    sm.code::text,
    sm.branch_id,
    COALESCE(
      r1.unit_cost,
      inv.unit_cost,
      ba.unit_cost,
      sm.default_cost,
      0
    )::numeric(18,6) AS latest_cost,
    r2.unit_cost::numeric(18,6) AS previous_cost,
    CASE
      WHEN r2.unit_cost IS NULL THEN NULL
      ELSE (
        COALESCE(
          r1.unit_cost,
          inv.unit_cost,
          ba.unit_cost,
          sm.default_cost,
          0
        ) - r2.unit_cost
      )::numeric(18,6)
    END AS change_amount,
    CASE
      WHEN COALESCE(r2.unit_cost, 0) <= 0 THEN NULL
      ELSE round(
        (
          COALESCE(
            r1.unit_cost,
            inv.unit_cost,
            ba.unit_cost,
            sm.default_cost,
            0
          ) - r2.unit_cost
        ) * 100.0 / r2.unit_cost,
        4
      )::numeric(12,4)
    END AS change_pct,
    COALESCE(
      r1.source,
      CASE
        WHEN inv.unit_cost IS NOT NULL THEN 'inventory_average'
        WHEN ba.unit_cost IS NOT NULL THEN 'batch_average'
        ELSE 'default_cost'
      END
    )::text AS price_source,
    CASE
      WHEN r1.event_id IS NOT NULL THEN r1.priced_at
      WHEN inv.unit_cost IS NOT NULL THEN inv.priced_at
      WHEN ba.unit_cost IS NOT NULL THEN ba.priced_at
      ELSE NULL
    END AS priced_at,
    r1.reference_number::text,
    r1.detail::text,
    COALESCE(r1.event_count, 0)::bigint
  FROM scoped_materials sm
  LEFT JOIN ranked r1
    ON r1.raw_material_id = sm.id
   AND r1.branch_id = sm.branch_id
   AND r1.rn = 1
  LEFT JOIN ranked r2
    ON r2.raw_material_id = sm.id
   AND r2.branch_id = sm.branch_id
   AND r2.rn = 2
  LEFT JOIN inventory_latest inv
    ON inv.raw_material_id = sm.id
   AND inv.branch_id = sm.branch_id
  LEFT JOIN batch_average ba
    ON ba.raw_material_id = sm.id
   AND ba.branch_id = sm.branch_id
  ORDER BY sm.name ASC;
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_costing_overview(
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  barcode text,
  sku text,
  category_name text,
  product_type text,
  sale_price numeric,
  unit_cost numeric,
  theoretical_cost numeric,
  actual_cost numeric,
  component_count bigint,
  recipe_item_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT public.is_pos_admin() THEN
    SELECT u.branch_id
      INTO v_user_branch
    FROM public.users u
    WHERE u.id = auth.uid();

    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  WITH scoped_products AS MATERIALIZED (
    SELECT
      p.id,
      p.name,
      p.barcode,
      p.sku,
      p.category_id,
      p.branch_id,
      p.product_type,
      p.sale_price
    FROM public.products p
    WHERE p.is_active = true
      AND (v_scope IS NULL OR p.branch_id = v_scope)
  ),
  scoped_branches AS MATERIALIZED (
    SELECT DISTINCT sp.branch_id
    FROM scoped_products sp
    WHERE sp.branch_id IS NOT NULL
  ),
  scoped_raw_materials AS MATERIALIZED (
    SELECT
      rm.id,
      rm.branch_id,
      rm.default_cost
    FROM public.raw_materials rm
    JOIN scoped_branches sb ON sb.branch_id = rm.branch_id
  ),
  events AS MATERIALIZED (
    SELECT e.*
    FROM public._raw_cost_events_for_costing(NULL, v_scope) e
    JOIN scoped_branches sb ON sb.branch_id = e.branch_id
  ),
  ranked AS MATERIALIZED (
    SELECT
      e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.raw_material_id, e.branch_id
        ORDER BY
          e.priced_at DESC NULLS LAST,
          e.source_rank,
          e.reference_number DESC NULLS LAST,
          e.event_id DESC
      ) AS rn
    FROM events e
  ),
  inventory_latest AS MATERIALIZED (
    SELECT DISTINCT ON (rmi.raw_material_id, rmi.branch_id)
      rmi.raw_material_id,
      rmi.branch_id,
      rmi.avg_cost::numeric AS unit_cost
    FROM public.raw_material_inventory rmi
    JOIN scoped_raw_materials srm
      ON srm.id = rmi.raw_material_id
     AND srm.branch_id = rmi.branch_id
    WHERE COALESCE(rmi.avg_cost, 0) > 0
    ORDER BY
      rmi.raw_material_id,
      rmi.branch_id,
      rmi.updated_at DESC NULLS LAST,
      rmi.id DESC
  ),
  batch_average AS MATERIALIZED (
    SELECT
      b.raw_material_id,
      b.branch_id,
      NULLIF(
        SUM(b.quantity * COALESCE(b.unit_cost, 0))
        / NULLIF(SUM(b.quantity), 0),
        0
      )::numeric AS unit_cost
    FROM public.raw_material_batches b
    JOIN scoped_raw_materials srm
      ON srm.id = b.raw_material_id
     AND srm.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.raw_material_id, b.branch_id
  ),
  raw_costs AS MATERIALIZED (
    SELECT
      srm.id AS raw_material_id,
      srm.branch_id,
      COALESCE(
        r1.unit_cost,
        inv.unit_cost,
        ba.unit_cost,
        srm.default_cost,
        0
      )::numeric AS unit_cost
    FROM scoped_raw_materials srm
    LEFT JOIN ranked r1
      ON r1.raw_material_id = srm.id
     AND r1.branch_id = srm.branch_id
     AND r1.rn = 1
    LEFT JOIN inventory_latest inv
      ON inv.raw_material_id = srm.id
     AND inv.branch_id = srm.branch_id
    LEFT JOIN batch_average ba
      ON ba.raw_material_id = srm.id
     AND ba.branch_id = srm.branch_id
  ),
  product_wavg AS MATERIALIZED (
    SELECT
      b.product_id,
      b.branch_id,
      CASE
        WHEN SUM(b.quantity) > 0
          THEN round(
            SUM(b.quantity * b.unit_cost) / SUM(b.quantity),
            2
          )
        ELSE 0
      END::numeric AS unit_cost
    FROM public.inventory_batches b
    JOIN scoped_branches sb ON sb.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.product_id, b.branch_id
  ),
  bom_costs AS MATERIALIZED (
    SELECT
      pc.product_id,
      round(
        SUM(pc.quantity * COALESCE(cw.unit_cost, 0)),
        2
      )::numeric AS cost,
      COUNT(*)::bigint AS component_count
    FROM public.product_components pc
    JOIN scoped_products sp ON sp.id = pc.product_id
    LEFT JOIN product_wavg cw
      ON cw.product_id = pc.component_product_id
     AND cw.branch_id = sp.branch_id
    GROUP BY pc.product_id
  ),
  recipe_costs AS MATERIALIZED (
    SELECT
      r.product_id,
      round(
        SUM(
          ri.quantity
          * (1 + COALESCE(ri.wastage_percent, 0) / 100.0)
          * COALESCE(rc.unit_cost, 0)
        ),
        2
      )::numeric AS cost
    FROM public.recipes r
    JOIN scoped_products sp ON sp.id = r.product_id
    JOIN public.recipe_items ri ON ri.recipe_id = r.id
    LEFT JOIN raw_costs rc ON rc.raw_material_id = ri.raw_material_id
    WHERE v_scope IS NULL OR r.branch_id = v_scope
    GROUP BY r.product_id
  ),
  recipe_counts AS MATERIALIZED (
    SELECT
      r.product_id,
      COUNT(*)::bigint AS recipe_item_count
    FROM public.recipes r
    JOIN scoped_products sp ON sp.id = r.product_id
    JOIN public.recipe_items ri ON ri.recipe_id = r.id
    GROUP BY r.product_id
  )
  SELECT
    sp.id,
    COALESCE(NULLIF(btrim(sp.name), ''), 'Product')::text,
    sp.barcode,
    sp.sku,
    c.name,
    COALESCE(sp.product_type, 'ready')::text,
    COALESCE(sp.sale_price, 0)::numeric(12,2),
    COALESCE(pw.unit_cost, 0)::numeric(12,2),
    COALESCE(bc.cost, 0)::numeric(12,2),
    COALESCE(rc.cost, 0)::numeric(12,2),
    COALESCE(bc.component_count, 0)::bigint,
    COALESCE(rct.recipe_item_count, 0)::bigint
  FROM scoped_products sp
  LEFT JOIN public.categories c ON c.id = sp.category_id
  LEFT JOIN product_wavg pw
    ON pw.product_id = sp.id
   AND pw.branch_id = sp.branch_id
  LEFT JOIN bom_costs bc ON bc.product_id = sp.id
  LEFT JOIN recipe_costs rc ON rc.product_id = sp.id
  LEFT JOIN recipe_counts rct ON rct.product_id = sp.id
  ORDER BY sp.name ASC;
END;
$function$;

NOTIFY pgrst, 'reload schema';
