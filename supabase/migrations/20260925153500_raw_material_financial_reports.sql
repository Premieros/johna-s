BEGIN;

-- Raw-material reporting contract:
-- 1) period movement / consumption per material;
-- 2) current residual FIFO valuation from raw_material_batches;
-- 3) finance report combining opening/purchases/sales-consumption/closing.
--
-- Quantity totals are intentionally kept per material. Financial totals aggregate
-- values only; summing kilograms, litres and pieces would be misleading.

CREATE OR REPLACE FUNCTION public.get_raw_material_consumption_report(
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (public.can_permission('reports.costing') OR public.can_permission('reports.financial')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:reports.costing';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;

  RETURN (
    WITH visible_ledger AS (
      SELECT il.*
      FROM public.inventory_ledger il
      WHERE il.branch_id=p_branch_id
        AND il.raw_material_id IS NOT NULL
        AND private.financial_reference_visible(
          il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at
        )
    ),
    opening AS (
      SELECT
        raw_material_id,
        COALESCE(SUM(quantity),0) AS opening_qty,
        COALESCE(SUM(total_cost),0) AS opening_value
      FROM visible_ledger
      WHERE v_from IS NULL OR (created_at AT TIME ZONE 'Africa/Cairo')::date < v_from
      GROUP BY raw_material_id
    ),
    period AS (
      SELECT
        raw_material_id,
        COALESCE(SUM(quantity),0) AS net_qty,
        COALESCE(SUM(total_cost),0) AS net_value,
        COALESCE(SUM(CASE WHEN entry_type='purchase' AND quantity>0 THEN quantity ELSE 0 END),0) AS purchase_qty,
        COALESCE(SUM(CASE WHEN entry_type='purchase' AND total_cost>0 THEN total_cost ELSE 0 END),0) AS purchase_value,
        COALESCE(SUM(CASE WHEN entry_type IN ('sale','kitchen_send') AND quantity<0 THEN -quantity ELSE 0 END),0) AS consumption_qty,
        COALESCE(SUM(CASE WHEN entry_type IN ('sale','kitchen_send') AND total_cost<0 THEN -total_cost ELSE 0 END),0) AS consumption_value,
        COALESCE(SUM(CASE WHEN (entry_type ILIKE '%transfer%' OR COALESCE(reference_type,'') ILIKE '%transfer%') AND quantity>0 THEN quantity ELSE 0 END),0) AS transfer_in_qty,
        COALESCE(SUM(CASE WHEN (entry_type ILIKE '%transfer%' OR COALESCE(reference_type,'') ILIKE '%transfer%') AND quantity<0 THEN -quantity ELSE 0 END),0) AS transfer_out_qty,
        COALESCE(SUM(CASE WHEN entry_type ILIKE '%waste%' AND quantity<0 THEN -quantity ELSE 0 END),0) AS waste_qty,
        COALESCE(SUM(CASE WHEN entry_type ILIKE '%waste%' AND total_cost<0 THEN -total_cost ELSE 0 END),0) AS waste_value,
        COALESCE(SUM(CASE
          WHEN entry_type='purchase' THEN 0
          WHEN entry_type IN ('sale','kitchen_send') THEN 0
          WHEN entry_type ILIKE '%waste%' THEN 0
          WHEN entry_type ILIKE '%transfer%' OR COALESCE(reference_type,'') ILIKE '%transfer%' THEN 0
          ELSE quantity
        END),0) AS other_net_qty,
        COALESCE(SUM(CASE
          WHEN entry_type='purchase' THEN 0
          WHEN entry_type IN ('sale','kitchen_send') THEN 0
          WHEN entry_type ILIKE '%waste%' THEN 0
          WHEN entry_type ILIKE '%transfer%' OR COALESCE(reference_type,'') ILIKE '%transfer%' THEN 0
          ELSE total_cost
        END),0) AS other_net_value
      FROM visible_ledger
      WHERE (v_from IS NULL OR (created_at AT TIME ZONE 'Africa/Cairo')::date >= v_from)
        AND (v_to IS NULL OR (created_at AT TIME ZONE 'Africa/Cairo')::date <= v_to)
      GROUP BY raw_material_id
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'raw_material_id',rm.id,
        'raw_material_name',rm.name,
        'raw_material_code',rm.code,
        'unit_name',COALESCE(u.name,''),
        'opening_quantity',round(COALESCE(o.opening_qty,0),4),
        'opening_value',round(COALESCE(o.opening_value,0),2),
        'purchase_quantity',round(COALESCE(p.purchase_qty,0),4),
        'purchase_value',round(COALESCE(p.purchase_value,0),2),
        'transfer_in_quantity',round(COALESCE(p.transfer_in_qty,0),4),
        'transfer_out_quantity',round(COALESCE(p.transfer_out_qty,0),4),
        'sales_consumption_quantity',round(COALESCE(p.consumption_qty,0),4),
        'sales_consumption_value',round(COALESCE(p.consumption_value,0),2),
        'waste_quantity',round(COALESCE(p.waste_qty,0),4),
        'waste_value',round(COALESCE(p.waste_value,0),2),
        'other_net_quantity',round(COALESCE(p.other_net_qty,0),4),
        'other_net_value',round(COALESCE(p.other_net_value,0),2),
        'closing_quantity',round(COALESCE(o.opening_qty,0)+COALESCE(p.net_qty,0),4),
        'closing_value',round(COALESCE(o.opening_value,0)+COALESCE(p.net_value,0),2)
      )
      ORDER BY rm.name
    ),'[]'::jsonb)
    FROM public.raw_materials rm
    LEFT JOIN public.units u ON u.id=rm.unit_id
    LEFT JOIN opening o ON o.raw_material_id=rm.id
    LEFT JOIN period p ON p.raw_material_id=rm.id
    WHERE rm.branch_id=p_branch_id
      AND (
        COALESCE(o.opening_qty,0)<>0 OR COALESCE(p.net_qty,0)<>0
        OR COALESCE(p.purchase_qty,0)<>0 OR COALESCE(p.consumption_qty,0)<>0
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_raw_material_valuation(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (public.can_permission('reports.costing') OR public.can_permission('reports.financial')) THEN
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
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'raw_material_id',rm.id,
        'raw_material_name',rm.name,
        'raw_material_code',rm.code,
        'unit_name',COALESCE(u.name,''),
        'current_quantity',round(COALESCE(b.current_qty,0),4),
        'fifo_current_unit_cost',round(
          CASE WHEN COALESCE(b.current_qty,0)<>0
            THEN COALESCE(b.current_value,0)/NULLIF(b.current_qty,0)
            ELSE 0
          END,6
        ),
        'current_inventory_value',round(COALESCE(b.current_value,0),2),
        'latest_authoritative_cost',round(COALESCE((ctx.context->>'unit_cost')::numeric,0),6),
        'price_source',COALESCE(ctx.context->>'source',''),
        'priced_at',ctx.context->>'priced_at',
        'open_fifo_batches',COALESCE(b.open_batches,0)
      )
      ORDER BY rm.name
    ),'[]'::jsonb)
    FROM public.raw_materials rm
    LEFT JOIN public.units u ON u.id=rm.unit_id
    LEFT JOIN batches b ON b.raw_material_id=rm.id
    CROSS JOIN LATERAL (
      SELECT public._raw_cost_context_for_costing(rm.id,p_branch_id) AS context
    ) ctx
    WHERE rm.branch_id=p_branch_id
      AND (rm.is_active OR COALESCE(b.current_qty,0)<>0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_raw_material_financial_report(
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
  v_rows jsonb := '[]'::jsonb;
  v_net_sales numeric := 0;
  v_opening_value numeric := 0;
  v_purchase_value numeric := 0;
  v_consumption_value numeric := 0;
  v_closing_value numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('reports.financial') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:reports.financial';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;

  v_rows := public.get_raw_material_consumption_report(p_branch_id,v_from,v_to);

  SELECT
    COALESCE(SUM((r->>'opening_value')::numeric),0),
    COALESCE(SUM((r->>'purchase_value')::numeric),0),
    COALESCE(SUM((r->>'sales_consumption_value')::numeric),0),
    COALESCE(SUM((r->>'closing_value')::numeric),0)
  INTO v_opening_value,v_purchase_value,v_consumption_value,v_closing_value
  FROM jsonb_array_elements(v_rows) r;

  SELECT COALESCE(round(SUM(
    GREATEST(COALESCE(s.total,0)-COALESCE(s.refunded_amount,0),0)
  ),2),0)
  INTO v_net_sales
  FROM public.sales s
  WHERE s.branch_id=p_branch_id
    AND s.status IN ('completed','returned','refunded')
    AND (v_from IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=v_from)
    AND (v_to IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=v_to)
    AND private.financial_reference_visible(
      'sale',s.id,s.id,s.branch_id,s.created_at
    );

  RETURN jsonb_build_object(
    'branch_id',p_branch_id,
    'from_date',v_from,
    'to_date',v_to,
    'summary',jsonb_build_object(
      'opening_inventory_value',round(v_opening_value,2),
      'purchases_value',round(v_purchase_value,2),
      'net_sales',round(v_net_sales,2),
      'sales_consumption_value',round(v_consumption_value,2),
      'closing_inventory_value',round(v_closing_value,2),
      'gross_profit',round(v_net_sales-v_consumption_value,2),
      'food_cost_pct',CASE WHEN v_net_sales>0 THEN round(v_consumption_value*100.0/v_net_sales,2) ELSE 0 END
    ),
    'rows',v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_raw_material_consumption_report(uuid,date,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_current_raw_material_valuation(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_raw_material_financial_report(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_consumption_report(uuid,date,date) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_current_raw_material_valuation(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_raw_material_financial_report(uuid,date,date) TO authenticated,service_role;

COMMIT;
