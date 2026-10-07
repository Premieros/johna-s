-- Recovery snapshot before #467; azzdesuowpdcoflmyezn only.
-- REVIEW ONLY. Use only if rollback is necessary and authorized.
-- Restore previous report/helper definitions; retain the new invoker RPC for
-- cached frontend compatibility. No rows, layers, permissions or policies change.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
-- _product_recipe_cost(uuid,uuid) md5=17f2185f99b20342d457babbca223a0b acl={postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public._product_recipe_cost(p_product_id uuid, p_branch_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH raw_lines AS (
    SELECT
      ri.raw_material_id,
      ri.quantity::numeric AS quantity,
      COALESCE(ri.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.recipe_items ri
    JOIN public.recipes r ON r.id = ri.recipe_id
    WHERE r.product_id = p_product_id
      AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)

    UNION ALL

    SELECT
      iur.raw_material_id,
      (pul.quantity * iur.quantity)::numeric AS quantity,
      COALESCE(iur.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.unit_type = 'manufactured'
     AND iu.is_active = true
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
    WHERE pul.product_id = p_product_id
      AND (p_branch_id IS NULL OR iu.branch_id = p_branch_id)
  )
  SELECT COALESCE(round(SUM(
    rl.quantity
    * (1 + rl.wastage_percent / 100.0)
    * COALESCE(public._raw_cost_for_costing(rl.raw_material_id, p_branch_id), 0)
  ), 2), 0)
  FROM raw_lines rl
$function$
;

-- _raw_cost_context_for_costing(uuid,uuid) md5=5f5e0390290b61f5295f79e170a74514 acl={postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public._raw_cost_context_for_costing(p_raw_material_id uuid, p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_cost numeric;
  v_priced_at timestamptz;
BEGIN
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
END;
$function$
;

-- get_costing_overview(uuid) md5=e0071074f106cba6acecfc7101502ff2 acl={postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.get_costing_overview(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, product_name text, barcode text, sku text, category_name text, product_type text, sale_price numeric, unit_cost numeric, theoretical_cost numeric, actual_cost numeric, component_count bigint, recipe_item_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT public.is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch
    FROM public.users u
    WHERE u.id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  WITH scoped_products AS MATERIALIZED (
    SELECT p.id, p.name, p.barcode, p.sku, p.category_id, p.branch_id, p.product_type, p.sale_price
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
    SELECT rm.id, rm.branch_id, rm.default_cost
    FROM public.raw_materials rm
    JOIN scoped_branches sb ON sb.branch_id = rm.branch_id
  ),
  raw_costs AS MATERIALIZED (
    SELECT srm.id AS raw_material_id, srm.branch_id,
      COALESCE(rmi.avg_cost, 0)::numeric AS unit_cost
    FROM scoped_raw_materials srm
    LEFT JOIN public.raw_material_inventory rmi
      ON rmi.raw_material_id = srm.id AND rmi.branch_id = srm.branch_id
  ),
  product_wavg AS MATERIALIZED (
    SELECT b.product_id, b.branch_id,
      CASE WHEN SUM(b.quantity) > 0
        THEN round(SUM(b.quantity * b.unit_cost) / SUM(b.quantity), 2)
        ELSE 0
      END::numeric AS unit_cost
    FROM public.inventory_batches b
    JOIN scoped_branches sb ON sb.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.product_id, b.branch_id
  ),
  component_counts AS MATERIALIZED (
    SELECT pc.product_id, COUNT(*)::bigint AS component_count
    FROM public.product_components pc
    JOIN scoped_products sp ON sp.id = pc.product_id
    GROUP BY pc.product_id
  ),
  recipe_lines AS MATERIALIZED (
    SELECT
      r.product_id,
      ri.raw_material_id,
      ri.quantity::numeric AS quantity,
      COALESCE(ri.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.recipes r
    JOIN scoped_products sp ON sp.id = r.product_id
    JOIN public.recipe_items ri ON ri.recipe_id = r.id
    WHERE v_scope IS NULL OR r.branch_id = v_scope

    UNION ALL

    SELECT
      pul.product_id,
      iur.raw_material_id,
      (pul.quantity * iur.quantity)::numeric AS quantity,
      COALESCE(iur.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.product_unit_links pul
    JOIN scoped_products sp ON sp.id = pul.product_id
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.unit_type = 'manufactured'
     AND iu.is_active = true
     AND (sp.branch_id IS NULL OR iu.branch_id = sp.branch_id)
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
  ),
  recipe_costs AS MATERIALIZED (
    SELECT
      rl.product_id,
      round(SUM(
        rl.quantity
        * (1 + rl.wastage_percent / 100.0)
        * COALESCE(rc.unit_cost, 0)
      ), 2)::numeric AS cost
    FROM recipe_lines rl
    LEFT JOIN raw_costs rc ON rc.raw_material_id = rl.raw_material_id
    GROUP BY rl.product_id
  ),
  recipe_counts AS MATERIALIZED (
    SELECT rl.product_id, COUNT(*)::bigint AS recipe_item_count
    FROM recipe_lines rl
    GROUP BY rl.product_id
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
    COALESCE(rc.cost, 0)::numeric(12,2),
    COALESCE(rc.cost, 0)::numeric(12,2),
    COALESCE(cc.component_count, 0)::bigint,
    COALESCE(rct.recipe_item_count, 0)::bigint
  FROM scoped_products sp
  LEFT JOIN public.categories c ON c.id = sp.category_id
  LEFT JOIN product_wavg pw ON pw.product_id = sp.id AND pw.branch_id = sp.branch_id
  LEFT JOIN recipe_costs rc ON rc.product_id = sp.id
  LEFT JOIN component_counts cc ON cc.product_id = sp.id
  LEFT JOIN recipe_counts rct ON rct.product_id = sp.id
  ORDER BY sp.name ASC;
END;
$function$
;

-- get_current_raw_material_valuation(uuid) md5=68729dbc4a3408cd7147105ed7ed5044 acl={postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.get_current_raw_material_valuation(p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT (
    public.can_permission('reports.costing')
    OR public.can_permission('reports.financial')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:reports.costing';
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;

  RETURN (
    WITH batches AS (
      SELECT
        b.raw_material_id,
        COALESCE(SUM(b.quantity),0) AS current_qty,
        COALESCE(SUM(b.quantity*COALESCE(b.unit_cost,0)),0) AS current_value,
        COUNT(*) FILTER (WHERE b.quantity<>0) AS open_batches
      FROM public.raw_material_batches b
      WHERE b.branch_id=p_branch_id
      GROUP BY b.raw_material_id
    ),
    debt_by_warehouse AS (
      SELECT
        d.raw_material_id,
        d.warehouse_id,
        SUM(GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0))::numeric AS outstanding_qty,
        COUNT(*) FILTER (
          WHERE GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0)>0.0001
        )::bigint AS outstanding_rows,
        MIN(d.source_created_at) FILTER (
          WHERE GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0)>0.0001
        ) AS oldest_debt_at
      FROM public.raw_fifo_debts d
      WHERE d.branch_id=p_branch_id
      GROUP BY d.raw_material_id,d.warehouse_id
      HAVING SUM(GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0))>0.0001
    ),
    purchase_receipts AS (
      SELECT
        il.raw_material_id,
        il.warehouse_id,
        MAX(il.created_at) AS last_purchase_receipt_at
      FROM public.inventory_ledger il
      WHERE il.branch_id=p_branch_id
        AND il.raw_material_id IS NOT NULL
        AND il.warehouse_id IS NOT NULL
        AND il.quantity>0
        AND (
          COALESCE(il.entry_type,'') IN ('purchase','purchase_receipt')
          OR COALESCE(il.reference_type,'') IN ('purchase','purchase_receipt')
        )
      GROUP BY il.raw_material_id,il.warehouse_id
    ),
    debt_priced AS (
      SELECT
        d.raw_material_id,
        d.warehouse_id,
        d.outstanding_qty,
        d.outstanding_rows,
        d.oldest_debt_at,
        pr.last_purchase_receipt_at,
        public._raw_last_known_fifo_cost(
          d.raw_material_id,
          p_branch_id,
          d.warehouse_id
        )::numeric AS known_cost
      FROM debt_by_warehouse d
      LEFT JOIN purchase_receipts pr
        ON pr.raw_material_id=d.raw_material_id
       AND pr.warehouse_id=d.warehouse_id
    ),
    debt AS (
      SELECT
        dp.raw_material_id,
        SUM(dp.outstanding_qty)::numeric AS outstanding_qty,
        SUM(dp.outstanding_rows)::bigint AS outstanding_rows,
        MIN(dp.oldest_debt_at) AS oldest_debt_at,
        MAX(dp.last_purchase_receipt_at) AS last_purchase_receipt_at,
        COUNT(*)::bigint AS debt_warehouse_count,
        COUNT(*) FILTER (
          WHERE dp.last_purchase_receipt_at IS NULL
        )::bigint AS warehouses_without_receipt_history,
        SUM(CASE
          WHEN COALESCE(dp.known_cost,0)>0 THEN dp.outstanding_qty
          ELSE 0
        END)::numeric AS priced_debt_qty,
        SUM(CASE
          WHEN COALESCE(dp.known_cost,0)<=0 THEN dp.outstanding_qty
          ELSE 0
        END)::numeric AS unpriced_debt_qty,
        SUM(
          CASE
            WHEN COALESCE(dp.known_cost,0)>0
              THEN dp.outstanding_qty*dp.known_cost
            ELSE 0
          END
        )::numeric AS estimated_debt_value
      FROM debt_priced dp
      GROUP BY dp.raw_material_id
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'raw_material_id',rm.id,
        'raw_material_name',rm.name,
        'raw_material_code',rm.code,
        'unit_name',COALESCE(u.name,''),
        'current_quantity',round(COALESCE(b.current_qty,0),4),
        'fifo_current_unit_cost',round(
          CASE
            WHEN COALESCE(b.current_qty,0)<>0
              THEN COALESCE(b.current_value,0)/NULLIF(b.current_qty,0)
            ELSE 0
          END,
          6
        ),
        'current_inventory_value',round(COALESCE(b.current_value,0),2),
        'latest_authoritative_cost',round(COALESCE((ctx.context->>'unit_cost')::numeric,0),6),
        'price_source',COALESCE(ctx.context->>'source',''),
        'priced_at',ctx.context->>'priced_at',
        'open_fifo_batches',COALESCE(b.open_batches,0),
        'outstanding_fifo_debt_quantity',round(COALESCE(d.outstanding_qty,0),4),
        'outstanding_fifo_debt_rows',COALESCE(d.outstanding_rows,0),
        'oldest_outstanding_debt_at',d.oldest_debt_at,
        'last_purchase_receipt_at',d.last_purchase_receipt_at,
        'fifo_debt_warehouse_count',COALESCE(d.debt_warehouse_count,0),
        'fifo_debt_warehouses_without_receipt_history',COALESCE(d.warehouses_without_receipt_history,0),
        'unpriced_fifo_debt_quantity',round(COALESCE(d.unpriced_debt_qty,0),4),
        'fifo_debt_estimated_unit_cost',round(
          CASE
            WHEN COALESCE(d.priced_debt_qty,0)>0
              THEN COALESCE(d.estimated_debt_value,0)/NULLIF(d.priced_debt_qty,0)
            ELSE 0
          END,
          6
        ),
        'estimated_fifo_debt_value',round(COALESCE(d.estimated_debt_value,0),2),
        'fifo_debt_pricing_coverage_pct',round(
          CASE
            WHEN COALESCE(d.outstanding_qty,0)>0
              THEN COALESCE(d.priced_debt_qty,0)*100.0/NULLIF(d.outstanding_qty,0)
            ELSE 100
          END,
          2
        ),
        'has_unpriced_fifo_debt',COALESCE(d.unpriced_debt_qty,0)>0.0001,
        'has_missing_purchase_receipt_history',COALESCE(d.warehouses_without_receipt_history,0)>0,
        'fifo_debt_status',
          CASE
            WHEN COALESCE(d.outstanding_qty,0)<=0.0001 THEN 'OK'
            WHEN COALESCE(d.unpriced_debt_qty,0)>0.0001
              AND COALESCE(d.warehouses_without_receipt_history,0)>0
              THEN 'UNPRICED_NO_RECEIPT'
            WHEN COALESCE(d.unpriced_debt_qty,0)>0.0001 THEN 'UNPRICED'
            WHEN COALESCE(d.warehouses_without_receipt_history,0)>0
              THEN 'NO_RECEIPT_HISTORY'
            ELSE 'OUTSTANDING'
          END
      )
      ORDER BY rm.name
    ),'[]'::jsonb)
    FROM public.raw_materials rm
    LEFT JOIN public.units u ON u.id=rm.unit_id
    LEFT JOIN batches b ON b.raw_material_id=rm.id
    LEFT JOIN debt d ON d.raw_material_id=rm.id
    CROSS JOIN LATERAL (
      SELECT public._raw_cost_context_for_costing(rm.id,p_branch_id) AS context
    ) ctx
    WHERE rm.branch_id=p_branch_id
      AND (
        rm.is_active
        OR COALESCE(b.current_qty,0)<>0
        OR COALESCE(d.outstanding_qty,0)>0.0001
      )
  );
END;
$function$
;

-- get_product_costing_detail(uuid,uuid) md5=80aecdcfe2f74208a4c8edbe2220f2cd acl={postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.get_product_costing_detail(p_product_id uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    (
      SELECT COUNT(*)
      FROM (
        SELECT ri.id
        FROM public.recipe_items ri
        JOIN public.recipes r ON r.id = ri.recipe_id
        WHERE r.product_id = p.id

        UNION ALL

        SELECT iur.id
        FROM public.product_unit_links pul
        JOIN public.inventory_units iu
          ON iu.id = pul.unit_id
         AND iu.unit_type = 'manufactured'
         AND iu.is_active = true
        JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
        WHERE pul.product_id = p.id
          AND (p.branch_id IS NULL OR iu.branch_id = p.branch_id)
      ) q
    ) AS recipe_item_count
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

  WITH raw_lines AS (
    SELECT
      ri.raw_material_id,
      ri.quantity::numeric AS quantity,
      COALESCE(ri.wastage_percent, 0)::numeric AS wastage_percent,
      NULL::uuid AS component_group_id,
      NULL::text AS component_group_name,
      NULL::numeric AS component_group_quantity
    FROM public.recipe_items ri
    JOIN public.recipes r ON r.id = ri.recipe_id
    WHERE r.product_id = p_product_id
      AND (v_scope IS NULL OR r.branch_id = v_scope)

    UNION ALL

    SELECT
      iur.raw_material_id,
      (pul.quantity * iur.quantity)::numeric AS quantity,
      COALESCE(iur.wastage_percent, 0)::numeric AS wastage_percent,
      iu.id AS component_group_id,
      iu.name::text AS component_group_name,
      pul.quantity::numeric AS component_group_quantity
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.unit_type = 'manufactured'
     AND iu.is_active = true
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
    WHERE pul.product_id = p_product_id
      AND (v_scope IS NULL OR iu.branch_id = v_scope)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'raw_material_id', rm.id,
    'raw_material_name', COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
    'quantity', rl.quantity,
    'wastage_percent', rl.wastage_percent,
    'unit_cost', COALESCE((ctx.context->>'unit_cost')::numeric, 0),
    'line_cost', round(
      rl.quantity * (1 + COALESCE(rl.wastage_percent, 0) / 100.0)
      * COALESCE((ctx.context->>'unit_cost')::numeric, 0),
      2
    ),
    'cost_source', ctx.context->>'source',
    'cost_priced_at', ctx.context->>'priced_at',
    'cost_reference', ctx.context->>'reference_number',
    'cost_detail', ctx.context->>'detail',
    'component_group_id', rl.component_group_id,
    'component_group_name', rl.component_group_name,
    'component_group_quantity', rl.component_group_quantity
  ) ORDER BY rl.component_group_name NULLS FIRST, rm.name), '[]'::jsonb)
  INTO v_recipe
  FROM raw_lines rl
  JOIN public.raw_materials rm ON rm.id = rl.raw_material_id
  CROSS JOIN LATERAL (
    SELECT public._raw_cost_context_for_costing(rl.raw_material_id, v_scope) AS context
  ) ctx;

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
$function$
;

-- get_raw_consumption_cost_breakdown(uuid,timestamp with time zone,timestamp with time zone) md5=217d9e9d36e826d2cfdc7852aeb7c70a acl={postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.get_raw_consumption_cost_breakdown(p_branch_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(raw_material_id uuid, raw_material_name text, raw_material_code text, unit_name text, consumed_quantity numeric, actual_quantity numeric, estimated_quantity numeric, actual_cost numeric, estimated_cost numeric, displayed_cost numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  IF NOT (
    public.can_permission('reports.costing')
    OR public.can_permission('shifts.report.shift')
    OR public.can_permission('shifts.day_close')
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  RETURN QUERY
  WITH movements AS MATERIALIZED (
    SELECT
      il.id,
      il.raw_material_id,
      il.branch_id,
      il.warehouse_id,
      il.created_at,
      abs(il.quantity)::numeric AS consumed_qty,
      COALESCE(il.unit_cost, 0)::numeric AS actual_unit_cost,
      COALESCE(il.total_cost, 0)::numeric AS total_cost
    FROM public.inventory_ledger il
    WHERE il.branch_id = p_branch_id
      AND il.raw_material_id IS NOT NULL
      AND il.quantity < 0
      AND il.created_at >= p_from
      AND il.created_at <= p_to
      AND il.entry_type IN ('sale','kitchen_send')
      AND COALESCE(il.reference_type, '') IN ('sale','kitchen_send')
      AND private.financial_reference_visible(
        il.reference_type,
        il.reference_id,
        (md5(il.id::text))::uuid,
        il.branch_id,
        il.created_at
      )
  ),
  priced AS MATERIALIZED (
    SELECT
      m.*,
      CASE
        WHEN m.actual_unit_cost > 0 OR abs(m.total_cost) > 0 THEN 0::numeric
        ELSE public._raw_last_known_fifo_cost(
          m.raw_material_id,
          m.branch_id,
          m.warehouse_id
        )
      END AS estimated_unit_cost
    FROM movements m
  )
  SELECT
    rm.id,
    rm.name::text,
    rm.code::text,
    COALESCE(mu.symbol, mu.code, mu.name, '')::text,
    round(SUM(p.consumed_qty), 6)::numeric,
    round(SUM(CASE WHEN p.actual_unit_cost > 0 OR abs(p.total_cost) > 0 THEN p.consumed_qty ELSE 0 END), 6)::numeric,
    round(SUM(CASE WHEN p.actual_unit_cost <= 0 AND abs(p.total_cost) <= 0 THEN p.consumed_qty ELSE 0 END), 6)::numeric,
    round(SUM(CASE
      WHEN p.actual_unit_cost > 0 OR abs(p.total_cost) > 0 THEN abs(p.total_cost)
      ELSE 0
    END), 2)::numeric,
    round(SUM(CASE
      WHEN p.actual_unit_cost <= 0 AND abs(p.total_cost) <= 0
        THEN p.consumed_qty * COALESCE(p.estimated_unit_cost, 0)
      ELSE 0
    END), 2)::numeric,
    round(SUM(CASE
      WHEN p.actual_unit_cost > 0 OR abs(p.total_cost) > 0 THEN abs(p.total_cost)
      ELSE p.consumed_qty * COALESCE(p.estimated_unit_cost, 0)
    END), 2)::numeric
  FROM priced p
  JOIN public.raw_materials rm ON rm.id = p.raw_material_id
  LEFT JOIN public.measurement_units mu ON mu.id = rm.unit_id
  GROUP BY rm.id, rm.name, rm.code, mu.symbol, mu.code, mu.name
  ORDER BY rm.name;
END;
$function$
;

-- get_raw_material_cost_valuation_overview(uuid) md5=0f29f9d848279aa00b500325d71f6926 acl={postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.get_raw_material_cost_valuation_overview(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(raw_material_id uuid, raw_material_name text, raw_material_code text, branch_id uuid, latest_cost numeric, previous_cost numeric, change_amount numeric, change_pct numeric, price_source text, priced_at timestamp with time zone, reference_number text, source_detail text, event_count bigint, stock_quantity numeric, positive_quantity numeric, negative_quantity numeric, actual_stock_value numeric, estimated_negative_value numeric, unpriced_negative_quantity numeric, estimated_net_stock_value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
      COALESCE(SUM((-b.quantity) * COALESCE(NULLIF(fi.avg_cost, 0), 0))
        FILTER (WHERE b.quantity < 0), 0)::numeric AS estimated_negative_value,
      COALESCE(SUM((-b.quantity))
        FILTER (
          WHERE b.quantity < 0
            AND COALESCE(NULLIF(fi.avg_cost, 0), 0) <= 0
        ), 0)::numeric AS unpriced_negative_quantity
    FROM public.raw_material_batches b
    JOIN price_rows pr
      ON pr.raw_material_id = b.raw_material_id
     AND pr.branch_id = b.branch_id
    LEFT JOIN public.raw_material_inventory fi
      ON fi.raw_material_id = b.raw_material_id AND fi.branch_id = b.branch_id
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
    round(COALESCE(bv.unpriced_negative_quantity, 0), 6)::numeric,
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
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;

