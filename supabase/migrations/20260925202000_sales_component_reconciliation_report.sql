-- Read-only reconciliation report: sold products x current canonical components
-- versus authoritative raw-material inventory consumption tied to the same sales.
-- No inventory, sales, kitchen, print or accounting mutations.

CREATE OR REPLACE FUNCTION public.get_sales_component_reconciliation_report(
  p_branch_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from date := public.history_clamp_from(p_from_date);
  v_to date := public.history_clamp_to(p_to_date);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT (public.can_permission('reports.costing') OR public.can_permission('reports.financial')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:reports.costing';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;

  RETURN (
    WITH sales_scope AS MATERIALIZED (
      SELECT
        s.id,
        s.total,
        COALESCE(s.refunded_amount,0) AS refunded_amount
      FROM public.sales s
      WHERE s.branch_id=p_branch_id
        AND COALESCE(s.is_archived,false)=false
        AND COALESCE(s.status,'') <> 'cancelled'
        AND (v_from IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date >= v_from)
        AND (v_to IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date <= v_to)
    ),
    scoped_items AS MATERIALIZED (
      SELECT
        si.id,
        si.sale_id,
        si.product_id,
        GREATEST(COALESCE(si.quantity,0)-COALESCE(si.refunded_quantity,0),0) AS sold_qty,
        GREATEST(COALESCE(si.total,0)-COALESCE(si.refunded_amount,0),0) AS net_line_value,
        p.id IS NOT NULL AS product_valid
      FROM public.sale_items si
      JOIN sales_scope s ON s.id=si.sale_id
      LEFT JOIN public.products p
        ON p.id=si.product_id
       AND p.branch_id=p_branch_id
    ),
    valid_items AS MATERIALIZED (
      SELECT product_id, SUM(sold_qty) AS sold_qty
      FROM scoped_items
      WHERE product_valid AND sold_qty>0
      GROUP BY product_id
    ),
    resolved_lines AS MATERIALIZED (
      SELECT
        vi.product_id,
        vi.sold_qty,
        r.raw_material_id,
        r.raw_name,
        r.quantity_per_sale,
        (r.quantity_per_sale*vi.sold_qty) AS theoretical_qty
      FROM valid_items vi
      CROSS JOIN LATERAL public.resolve_product_raw_components(vi.product_id,p_branch_id) r
    ),
    theoretical AS (
      SELECT
        raw_material_id,
        MAX(raw_name) AS raw_name,
        SUM(theoretical_qty) AS theoretical_qty,
        COUNT(DISTINCT product_id) AS product_count
      FROM resolved_lines
      GROUP BY raw_material_id
    ),
    direct_actual AS (
      SELECT
        il.raw_material_id,
        SUM(CASE WHEN il.quantity<0 THEN -il.quantity ELSE 0 END) AS actual_qty,
        SUM(CASE WHEN il.total_cost<0 THEN -il.total_cost ELSE 0 END) AS actual_value,
        COUNT(*) FILTER (WHERE il.quantity<0) AS movement_count
      FROM public.inventory_ledger il
      JOIN sales_scope s ON s.id=il.reference_id
      WHERE il.branch_id=p_branch_id
        AND il.raw_material_id IS NOT NULL
        AND il.entry_type='sale'
        AND il.reference_type='sale'
      GROUP BY il.raw_material_id
    ),
    kitchen_actual AS (
      SELECT
        il.raw_material_id,
        SUM(CASE WHEN il.quantity<0 THEN -il.quantity ELSE 0 END) AS actual_qty,
        SUM(CASE WHEN il.total_cost<0 THEN -il.total_cost ELSE 0 END) AS actual_value,
        COUNT(*) FILTER (WHERE il.quantity<0) AS movement_count
      FROM public.inventory_ledger il
      JOIN public.order_kitchen_inventory_events e
        ON e.id=il.reference_id
       AND e.branch_id=il.branch_id
      JOIN sales_scope s ON s.id=e.settled_sale_id
      WHERE il.branch_id=p_branch_id
        AND il.raw_material_id IS NOT NULL
        AND il.entry_type='kitchen_send'
        AND il.reference_type='kitchen_send'
      GROUP BY il.raw_material_id
    ),
    actual AS (
      SELECT
        raw_material_id,
        SUM(actual_qty) AS actual_qty,
        SUM(actual_value) AS actual_value,
        SUM(movement_count) AS movement_count
      FROM (
        SELECT * FROM direct_actual
        UNION ALL
        SELECT * FROM kitchen_actual
      ) x
      GROUP BY raw_material_id
    ),
    combined AS MATERIALIZED (
      SELECT
        COALESCE(t.raw_material_id,a.raw_material_id) AS raw_material_id,
        COALESCE(t.raw_name,rm.name,'') AS raw_name,
        COALESCE(t.theoretical_qty,0) AS theoretical_qty,
        COALESCE(a.actual_qty,0) AS actual_qty,
        COALESCE(a.actual_value,0) AS actual_value,
        COALESCE(a.movement_count,0) AS movement_count,
        COALESCE(t.product_count,0) AS product_count,
        CASE
          WHEN COALESCE(a.actual_qty,0)>0 THEN COALESCE(a.actual_value,0)/NULLIF(a.actual_qty,0)
          ELSE COALESCE((public._raw_cost_context_for_costing(COALESCE(t.raw_material_id,a.raw_material_id),p_branch_id)->>'unit_cost')::numeric,0)
        END AS compare_unit_cost,
        CASE WHEN COALESCE(a.actual_qty,0)>0 THEN 'period_actual' ELSE 'authoritative_fallback' END AS price_source
      FROM theoretical t
      FULL OUTER JOIN actual a ON a.raw_material_id=t.raw_material_id
      LEFT JOIN public.raw_materials rm ON rm.id=COALESCE(t.raw_material_id,a.raw_material_id)
    ),
    rows AS (
      SELECT
        c.*,
        c.theoretical_qty*c.compare_unit_cost AS theoretical_value,
        c.theoretical_qty-c.actual_qty AS quantity_difference,
        (c.theoretical_qty*c.compare_unit_cost)-c.actual_value AS value_difference,
        CASE
          WHEN ABS(c.theoretical_qty-c.actual_qty)<=0.0001 THEN 'MATCH'
          WHEN c.theoretical_qty>c.actual_qty THEN 'UNDER_CONSUMED'
          WHEN c.theoretical_qty<c.actual_qty THEN 'OVER_CONSUMED'
          ELSE 'MATCH'
        END AS reconciliation_status
      FROM combined c
    ),
    invalid_items AS (
      SELECT
        COUNT(*) AS row_count,
        COALESCE(SUM(sold_qty),0) AS qty,
        COALESCE(SUM(net_line_value),0) AS value
      FROM scoped_items
      WHERE sold_qty>0 AND NOT product_valid
    ),
    componentless_items AS (
      SELECT
        COUNT(*) AS product_count,
        COALESCE(SUM(vi.sold_qty),0) AS qty
      FROM valid_items vi
      WHERE NOT EXISTS (
        SELECT 1
        FROM resolved_lines rl
        WHERE rl.product_id=vi.product_id
      )
    ),
    summary AS (
      SELECT
        COALESCE((SELECT SUM(GREATEST(s.total-s.refunded_amount,0)) FROM sales_scope s),0) AS net_sales,
        COALESCE(SUM(r.theoretical_qty),0) AS theoretical_qty,
        COALESCE(SUM(r.actual_qty),0) AS actual_qty,
        COALESCE(SUM(r.theoretical_value),0) AS theoretical_value,
        COALESCE(SUM(r.actual_value),0) AS actual_value,
        COALESCE(SUM(r.value_difference),0) AS value_difference,
        COUNT(*) FILTER (WHERE r.reconciliation_status<>'MATCH') AS mismatched_raws,
        COUNT(*) FILTER (WHERE r.price_source='authoritative_fallback') AS fallback_priced_raws
      FROM rows r
    )
    SELECT jsonb_build_object(
      'summary', jsonb_build_object(
        'net_sales', round(s.net_sales,2),
        'theoretical_quantity', round(s.theoretical_qty,4),
        'actual_quantity', round(s.actual_qty,4),
        'theoretical_value', round(s.theoretical_value,2),
        'actual_value', round(s.actual_value,2),
        'value_difference', round(s.value_difference,2),
        'theoretical_food_cost_pct', round(CASE WHEN s.net_sales<>0 THEN s.theoretical_value/s.net_sales*100 ELSE 0 END,2),
        'actual_food_cost_pct', round(CASE WHEN s.net_sales<>0 THEN s.actual_value/s.net_sales*100 ELSE 0 END,2),
        'mismatched_raws', s.mismatched_raws,
        'fallback_priced_raws', s.fallback_priced_raws,
        'unmatched_sale_rows', i.row_count,
        'unmatched_sale_quantity', round(i.qty,4),
        'unmatched_sale_value', round(i.value,2),
        'componentless_products', c.product_count,
        'componentless_sale_quantity', round(c.qty,4)
      ),
      'rows', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'raw_material_id',r.raw_material_id,
            'raw_material_name',r.raw_name,
            'product_count',r.product_count,
            'theoretical_quantity',round(r.theoretical_qty,4),
            'actual_quantity',round(r.actual_qty,4),
            'quantity_difference',round(r.quantity_difference,4),
            'compare_unit_cost',round(r.compare_unit_cost,6),
            'theoretical_value',round(r.theoretical_value,2),
            'actual_value',round(r.actual_value,2),
            'value_difference',round(r.value_difference,2),
            'variance_pct',round(CASE WHEN r.theoretical_value<>0 THEN r.value_difference/r.theoretical_value*100 ELSE 0 END,2),
            'movement_count',r.movement_count,
            'price_source',r.price_source,
            'status',r.reconciliation_status
          )
          ORDER BY ABS(r.value_difference) DESC, r.raw_name
        )
        FROM rows r
      ),'[]'::jsonb)
    )
    FROM summary s
    CROSS JOIN invalid_items i
    CROSS JOIN componentless_items c
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sales_component_reconciliation_report(uuid,date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_component_reconciliation_report(uuid,date,date)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sales_component_reconciliation_report(uuid,date,date)
IS 'Read-only reconciliation of theoretical current canonical BOM consumption against authoritative sale/kitchen inventory_ledger consumption for the same settled sales.';
