-- EMERGENCY ROLLBACK PACKAGE
-- Snapshot date: 2026-09-21 18:29 Africa/Cairo
-- Git rollback point: rollback/pre-fifo-20260921-1829
-- Git SHA: 0559ec7e0bc21524cc029bc00055928837a7cd6d
--
-- Purpose:
-- Restore the PRE-FIFO raw-material costing behavior and costing reports immediately.
-- This file is intentionally OUTSIDE supabase/migrations so it is never auto-applied.
--
-- Safe behavior:
-- - restores only the four functions modified by the FIFO repair;
-- - does NOT delete sales, orders, stock, print jobs, recipes, or FIFO audit tables;
-- - FIFO audit/backfill tables may remain in place but become inert after these hooks are restored.
--
-- Apply only as an emergency rollback after explicit approval.

BEGIN;

CREATE OR REPLACE FUNCTION public._raw_add(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_qty numeric,
  p_unit_cost numeric DEFAULT 0,
  p_batch_number text DEFAULT NULL::text,
  p_production_date date DEFAULT NULL::date,
  p_expiry_date date DEFAULT NULL::date,
  p_entry_type text DEFAULT 'purchase'::text,
  p_reference_type text DEFAULT NULL::text,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_reference_number text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_before numeric(14,4):=0; v_after numeric(14,4):=0;
  v_branch_qty numeric(14,4):=0; v_branch_value numeric(18,4):=0;
  v_branch_avg numeric(12,2):=0; v_batch_no text;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_warehouse_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','INVALID_PARAMS'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.raw_materials WHERE id=p_raw_material_id AND branch_id=p_branch_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','RAW_MATERIAL_BRANCH_MISMATCH'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  SELECT COALESCE(SUM(quantity),0) INTO v_before FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
  v_batch_no:=COALESCE(NULLIF(btrim(COALESCE(p_batch_number,'')),''),'RB-'||substr(replace(gen_random_uuid()::text,'-',''),1,10));
  INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date,expiry_date,source_type,source_id)
  VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,p_qty,COALESCE(p_unit_cost,0),p_production_date,p_expiry_date,COALESCE(p_reference_type,p_entry_type),p_reference_id);
  v_after:=v_before+p_qty;
  SELECT COALESCE(SUM(quantity),0),COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0) INTO v_branch_qty,v_branch_value FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
  v_branch_avg:=CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES(p_raw_material_id,p_branch_id,v_branch_qty,v_branch_avg)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();
  INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_by)
  VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,p_qty,COALESCE(p_unit_cost,0),p_qty*COALESCE(p_unit_cost,0),v_before,v_after,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by);
  RETURN jsonb_build_object('success',true,'before_qty',v_before,'after_qty',v_after,'avg_cost',v_branch_avg,'batch_number',v_batch_no,'warehouse_id',p_warehouse_id);
END
$function$;

CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_qty numeric,
  p_entry_type text DEFAULT 'production'::text,
  p_reference_type text DEFAULT NULL::text,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_reference_number text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid,
  p_allow_negative boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_remaining numeric(14,4); v_batch record; v_deduct numeric(14,4);
  v_running numeric(14,4):=0; v_branch_qty numeric(14,4):=0; v_branch_value numeric(18,4):=0;
  v_total_cost numeric(18,4):=0; v_total_removed numeric(14,4):=0;
  v_oversold numeric(14,4):=0; v_debt_batch text;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN RETURN jsonb_build_object('success',true,'shortage',0,'removed',0,'total_cost',0,'avg_cost',0); END IF;
  IF p_warehouse_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','WAREHOUSE_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  SELECT COALESCE(SUM(quantity),0) INTO v_running FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
  v_remaining:=p_qty;
  FOR v_batch IN SELECT id,quantity,unit_cost,batch_number FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id AND quantity>0
    ORDER BY expiry_date NULLS LAST,created_at,id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0; v_deduct:=LEAST(v_batch.quantity,v_remaining);
    UPDATE public.raw_material_batches SET quantity=quantity-v_deduct WHERE id=v_batch.id;
    INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_by)
    VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,-v_deduct,COALESCE(v_batch.unit_cost,0),-v_deduct*COALESCE(v_batch.unit_cost,0),v_running,v_running-v_deduct,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by);
    v_running:=v_running-v_deduct; v_remaining:=v_remaining-v_deduct; v_total_removed:=v_total_removed+v_deduct; v_total_cost:=v_total_cost+v_deduct*COALESCE(v_batch.unit_cost,0);
  END LOOP;
  IF v_remaining>0 AND p_allow_negative THEN
    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
    INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date,expiry_date,source_type,source_id)
    VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,-v_remaining,0,NULL,NULL,COALESCE(NULLIF(p_reference_type,''),p_entry_type)||'_oversold',p_reference_id);
    INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_by)
    VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,-v_remaining,0,0,v_running,v_running-v_remaining,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by);
    v_running:=v_running-v_remaining; v_oversold:=v_remaining; v_remaining:=0;
  END IF;
  SELECT COALESCE(SUM(quantity),0),COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0) INTO v_branch_qty,v_branch_value FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES(p_raw_material_id,p_branch_id,v_branch_qty,CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();
  RETURN jsonb_build_object('success',true,'shortage',v_remaining,'removed',v_total_removed,'total_cost',v_total_cost,'avg_cost',CASE WHEN v_total_removed>0 THEN round(v_total_cost/v_total_removed,2) ELSE 0 END,'warehouse_id',p_warehouse_id,'oversold',v_oversold,'debt_batch_number',v_debt_batch);
END
$function$;

CREATE OR REPLACE FUNCTION public.get_costing_sales_summary(
  p_branch_id uuid DEFAULT NULL::uuid,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public','pg_temp'
AS $function$
WITH scoped_sales AS (
  SELECT
    s.id,
    GREATEST(COALESCE(s.total, 0) - COALESCE(s.tax_amount, 0), 0)::numeric AS net_sales
  FROM public.sales s
  WHERE (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND (public.history_clamp_from(p_from) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_clamp_from(p_from))
    AND (public.history_clamp_to(p_to) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_to(p_to))
    AND COALESCE(s.status, '') NOT IN ('returned', 'cancelled')
),
kitchen_costs AS (
  SELECT
    e.settled_sale_id AS sale_id,
    ROUND(
      COALESCE(
        SUM(
          CASE
            WHEN e.sent_quantity > 0 THEN
              COALESCE(e.total_cost, 0)
              * GREATEST(e.sent_quantity - COALESCE(e.voided_quantity, 0), 0)
              / e.sent_quantity
            ELSE 0
          END
        ),
        0
      ),
      2
    )::numeric AS cogs
  FROM public.order_kitchen_inventory_events e
  JOIN scoped_sales ss ON ss.id = e.settled_sale_id
  WHERE e.settled_sale_id IS NOT NULL
  GROUP BY e.settled_sale_id
),
legacy_costs AS (
  SELECT
    il.reference_id AS sale_id,
    GREATEST(COALESCE(-SUM(il.total_cost), 0), 0)::numeric AS cogs
  FROM public.inventory_ledger il
  JOIN scoped_sales ss ON ss.id = il.reference_id
  WHERE il.entry_type = 'sale'
    AND il.reference_type = 'sale'
  GROUP BY il.reference_id
),
resolved_costs AS (
  SELECT
    ss.id AS sale_id,
    CASE
      WHEN kc.sale_id IS NOT NULL THEN COALESCE(kc.cogs, 0)
      ELSE COALESCE(lc.cogs, 0)
    END::numeric AS cogs
  FROM scoped_sales ss
  LEFT JOIN kitchen_costs kc ON kc.sale_id = ss.id
  LEFT JOIN legacy_costs lc ON lc.sale_id = ss.id
),
totals AS (
  SELECT
    COUNT(*)::integer AS sales_count,
    ROUND(COALESCE(SUM(ss.net_sales), 0), 2) AS net_sales,
    ROUND(COALESCE(SUM(rc.cogs), 0), 2) AS cogs
  FROM scoped_sales ss
  LEFT JOIN resolved_costs rc ON rc.sale_id = ss.id
)
SELECT jsonb_build_object(
  'sales_count', sales_count,
  'net_sales', net_sales,
  'cogs', cogs,
  'ratio', CASE WHEN net_sales > 0 THEN ROUND(cogs * 100.0 / net_sales, 2) ELSE 0 END
)
FROM totals;
$function$;

CREATE OR REPLACE FUNCTION public.get_order_margin(
  p_branch_id uuid DEFAULT NULL::uuid,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date
)
RETURNS TABLE(
  sale_id uuid,
  invoice_number text,
  branch_id uuid,
  sale_date date,
  total numeric,
  discount_amount numeric,
  cogs numeric,
  gross_margin numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch FROM public.users u WHERE u.id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.invoice_number,
    s.branch_id,
    s.created_at::date,
    COALESCE(s.total, 0),
    COALESCE(s.discount_amount, 0),
    COALESCE(-SUM(il.total_cost), 0)::numeric(16,2) AS cogs,
    round(COALESCE(s.total, 0) - COALESCE(-SUM(il.total_cost), 0), 2)::numeric(16,2) AS gross_margin
  FROM public.sales s
  LEFT JOIN public.inventory_ledger il
    ON il.reference_id = s.id AND il.entry_type = 'sale' AND il.reference_type = 'sale'
  WHERE (v_scope IS NULL OR s.branch_id = v_scope)
    AND (public.history_clamp_from(p_from) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date >= public.history_clamp_from(p_from))
    AND (public.history_clamp_to(p_to) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_to(p_to))
  GROUP BY s.id
  ORDER BY s.created_at DESC
  LIMIT 500;
END;
$function$;

REVOKE ALL ON FUNCTION public._raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_costing_sales_summary(uuid,date,date)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_order_margin(uuid,date,date)
  FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public._raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid)
  TO postgres,service_role;
GRANT EXECUTE ON FUNCTION public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)
  TO postgres,service_role;
GRANT EXECUTE ON FUNCTION public.get_costing_sales_summary(uuid,date,date)
  TO postgres,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_order_margin(uuid,date,date)
  TO postgres,authenticated,service_role;

COMMIT;

-- Verification after emergency restore:
-- 1) SELECT pg_get_functiondef(...) for all four functions and compare with this file.
-- 2) Confirm POS sale/send-to-kitchen works.
-- 3) Confirm no new fifo_cogs_reconcile journals are created after restore.
-- 4) Confirm cloud print queue remains healthy; this script never touches printing tables/functions.
