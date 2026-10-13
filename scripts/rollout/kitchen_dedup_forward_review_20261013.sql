-- REVIEW PACKAGE ONLY: not a migration, not authorized for production.
-- Repository Premieros/johna-s; production identity azzdesuowpdcoflmyezn.
-- Run only after separate owner approval, maintenance quiescence and identity check.
-- Owns its transaction. Fail-closed body/owner/security/search_path/ACL tripwires.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $guard$
DECLARE p record;
BEGIN
 IF current_user <> 'postgres' OR current_setting('app.kitchen_rollout_ack',true) IS DISTINCT FROM 'johnas-kitchen-20261013-review-required' THEN RAISE EXCEPTION 'KITCHEN_ROLLOUT_NOT_ACKNOWLEDGED'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._capture_kitchen_ingredient_prices()');
 IF p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM '4c958bda8fe9cdcc2079662e556a9d2f' OR p.prosecdef IS DISTINCT FROM false OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'KITCHEN_CANONICAL_DRIFT: _capture_kitchen_ingredient_prices()'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._raw_fifo_settle_receipt(bigint,uuid,uuid)');
 IF p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM '7d9af107f3dedc1fb09b743ef6e6d387' OR p.prosecdef IS DISTINCT FROM true OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'KITCHEN_CANONICAL_DRIFT: _raw_fifo_settle_receipt(bigint,uuid,uuid)'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._send_to_kitchen_core_20260914(uuid,uuid)');
 IF p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM 'd9d480eeaf2d1c3afecdac1666e3a0bd' OR p.prosecdef IS DISTINCT FROM true OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'KITCHEN_CANONICAL_DRIFT: _send_to_kitchen_core_20260914(uuid,uuid)'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.apply_stock_count(uuid)');
 IF p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM 'f1a121ce49aee97d7174391885976852' OR p.prosecdef IS DISTINCT FROM true OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'KITCHEN_CANONICAL_DRIFT: apply_stock_count(uuid)'; END IF;
 IF to_regprocedure('public._kitchen_dispatch_component_plans(uuid,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'KITCHEN_HELPER_ALREADY_EXISTS'; END IF;
 IF to_regprocedure('public._raw_remove_fifo_negative_dispatch(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean,numeric)') IS NOT NULL THEN RAISE EXCEPTION 'KITCHEN_HELPER_ALREADY_EXISTS'; END IF;
 IF to_regprocedure('public._kitchen_dispatch_deduct_planned(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid,jsonb,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'KITCHEN_HELPER_ALREADY_EXISTS'; END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public._kitchen_dispatch_component_plans(p_branch_id uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public','pg_temp'
AS $plans$
DECLARE
  v_config record;
  v_components jsonb;
  v_envelope jsonb;
  v_result jsonb := '{}'::jsonb;
  v_item uuid;
  v_count integer := 0;
BEGIN
  FOR v_config IN
    SELECT t.product_id,COALESCE(t.modifier_option_ids,'[]'::jsonb) modifiers,
           array_agg(t.order_item_id) item_ids
    FROM jsonb_to_recordset(COALESCE(p_items,'[]'::jsonb))
      AS t(order_item_id uuid,product_id uuid,modifier_option_ids jsonb)
    GROUP BY t.product_id,COALESCE(t.modifier_option_ids,'[]'::jsonb)
  LOOP
    v_count := v_count+1;
    BEGIN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'raw_material_id',r.raw_material_id,'raw_name',r.raw_name,
        'quantity_per_sale',r.quantity_per_sale
      ) ORDER BY r.raw_material_id),'[]'::jsonb)
      INTO v_components
      FROM public.resolve_kitchen_item_raw_components(v_config.product_id,p_branch_id,v_config.modifiers) r;
      v_envelope := jsonb_build_object('success',true,'components',v_components);
    EXCEPTION WHEN OTHERS THEN
      -- Preserve canonical per-item error propagation and rollback at dispatch.
      v_envelope := jsonb_build_object('success',false,'error','ORDER_ITEM_CONFIGURATION_INVALID','detail',SQLERRM);
    END;
    FOREACH v_item IN ARRAY v_config.item_ids LOOP
      v_result := v_result || jsonb_build_object(v_item::text,v_envelope);
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('plans',v_result,'configuration_count',v_count);
END;
$plans$;

CREATE OR REPLACE FUNCTION public._raw_remove_fifo_negative_dispatch(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_entry_type text DEFAULT 'production'::text, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_allow_negative boolean DEFAULT false, p_start_warehouse_qty numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_running numeric(14,4):=0;
  v_branch_qty numeric(14,4):=0;
  v_branch_value numeric(18,4):=0;
  v_total_cost numeric(18,4):=0;
  v_total_removed numeric(14,4):=0;
  v_oversold numeric(14,4):=0;
  v_debt_batch text;
  v_debt_batch_id uuid;
  v_oversold_ledger_id bigint;
  v_oversold_created_at timestamptz;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN
    RETURN jsonb_build_object(
      'success',true,'shortage',0,'removed',0,'total_cost',0,'avg_cost',0
    );
  END IF;

  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_REQUIRED');
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );

  IF p_allow_negative IS NOT TRUE OR p_start_warehouse_qty IS NULL OR p_start_warehouse_qty>0 THEN
    RETURN jsonb_build_object('success',false,'error','NEGATIVE_REUSE_CONTEXT_REQUIRED');
  END IF;
  v_running:=p_start_warehouse_qty;

  v_remaining:=p_qty;

  -- Caller proved no positive batches anywhere in this branch under the material lock.
  -- Keep each source's oversold batch, ledger and debt; there is no positive FIFO allocation.



  IF v_remaining>0 AND p_allow_negative THEN
    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    INSERT INTO public.raw_material_batches(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,production_date,expiry_date,source_type,source_id
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_remaining,0,NULL,NULL,
      COALESCE(NULLIF(p_reference_type,''),p_entry_type)||'_oversold',
      p_reference_id
    )
    RETURNING id INTO v_debt_batch_id;

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_remaining,0,0,v_running,v_running-v_remaining,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    )
    RETURNING id,created_at INTO v_oversold_ledger_id,v_oversold_created_at;

    INSERT INTO public.raw_fifo_debts(
      source_ledger_id,raw_material_id,branch_id,warehouse_id,
      oversold_batch_id,reference_type,reference_id,reference_number,
      debt_quantity,settled_quantity,source_created_at
    ) VALUES (
      v_oversold_ledger_id,p_raw_material_id,p_branch_id,p_warehouse_id,
      v_debt_batch_id,p_reference_type,p_reference_id,p_reference_number,
      v_remaining,0,v_oversold_created_at
    )
    ON CONFLICT (source_ledger_id) DO NOTHING;

    v_running:=v_running-v_remaining;
    v_oversold:=v_remaining;
    v_remaining:=0;
  END IF;

  -- The dispatch updates the official branch summary once after all sources.

  RETURN jsonb_build_object(
    'success',true,
    'shortage',v_remaining,
    'removed',v_total_removed,
    'total_cost',v_total_cost,
    'avg_cost',CASE
      WHEN v_total_removed>0 THEN round(v_total_cost/v_total_removed,2)
      ELSE 0
    END,
    'warehouse_id',p_warehouse_id,
    'candidate_warehouse_qty_after',v_running,
    'oversold',v_oversold,
    'debt_batch_number',v_debt_batch,
    'fifo_debt_ledger_id',v_oversold_ledger_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._kitchen_dispatch_deduct_planned(p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_quantity numeric, p_modifier_option_ids jsonb, p_event_id uuid, p_reference_number text, p_created_by uuid, p_component_plan jsonb, p_negative_balances jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_res jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_oversold jsonb := '[]'::jsonb;
  v_total_cost numeric(18,6) := 0;
  v_count integer := 0;
  v_fallback_raw_id uuid;
  v_fallback_raw_name text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_QUANTITY'
    );
  END IF;

  IF COALESCE((p_component_plan->>'success')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_ITEM_CONFIGURATION_INVALID',
      'detail',COALESCE(p_component_plan->>'detail','COMPONENT_PLAN_MISSING'));
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.kitchen_raw_need (
    raw_material_id uuid PRIMARY KEY,
    raw_name text,
    required_qty numeric(18,6) NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.kitchen_raw_need;

  INSERT INTO pg_temp.kitchen_raw_need(raw_material_id, raw_name, required_qty)
  SELECT
    r.raw_material_id,
    r.raw_name,
    round(r.quantity_per_sale * p_quantity, 6)
  FROM jsonb_to_recordset(COALESCE(p_component_plan->'components','[]'::jsonb))
    AS r(raw_material_id uuid,raw_name text,quantity_per_sale numeric)
  ON CONFLICT(raw_material_id) DO UPDATE
  SET required_qty = pg_temp.kitchen_raw_need.required_qty + EXCLUDED.required_qty,
      raw_name = EXCLUDED.raw_name;

  SELECT count(*) INTO v_count
  FROM pg_temp.kitchen_raw_need
  WHERE abs(required_qty) > 0.000001;

  IF v_count = 0 THEN
    -- Business rule: an unconfigured sellable product is still valid.
    -- Materialize one branch-scoped fallback raw with the product name and
    -- consume it directly. Because FIFO allows debt, the resulting raw balance
    -- becomes negative when no stock exists.
    v_fallback_raw_id := public._ensure_pos_fallback_product_raw(
      p_product_id,
      p_branch_id
    );

    SELECT rm.name
    INTO v_fallback_raw_name
    FROM public.raw_materials rm
    WHERE rm.id = v_fallback_raw_id
      AND rm.branch_id = p_branch_id
      AND rm.is_active = true;

    IF v_fallback_raw_id IS NULL OR v_fallback_raw_name IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ORDER_ITEM_CONFIGURATION_INVALID',
        'detail', 'FALLBACK_RAW_CREATE_FAILED'
      );
    END IF;

    INSERT INTO pg_temp.kitchen_raw_need(
      raw_material_id,
      raw_name,
      required_qty
    ) VALUES (
      v_fallback_raw_id,
      v_fallback_raw_name,
      round(p_quantity, 6)
    );

    v_count := 1;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.kitchen_raw_need
    WHERE required_qty < -0.000001
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_MODIFIER_INVENTORY_EFFECT',
      'detail', 'Modifier removal exceeds the product raw component quantity.'
    );
  END IF;

  FOR v_row IN
    SELECT *
    FROM pg_temp.kitchen_raw_need
    WHERE required_qty > 0.000001
    ORDER BY raw_material_id
  LOOP
    IF p_negative_balances ? v_row.raw_material_id::text THEN
    v_res := public._raw_remove_fifo_negative_dispatch(
      v_row.raw_material_id,
      p_branch_id,
      p_warehouse_id,
      v_row.required_qty,
      'kitchen_send',
      'kitchen_send',
      p_event_id,
      p_reference_number,
      p_created_by,
      true,
      (p_negative_balances->>v_row.raw_material_id::text)::numeric
    );

      IF COALESCE((v_res->>'success')::boolean,false) THEN
        p_negative_balances:=jsonb_set(p_negative_balances,ARRAY[v_row.raw_material_id::text],v_res->'candidate_warehouse_qty_after');
      END IF;
    ELSE
    v_res := public._raw_remove_fifo(
      v_row.raw_material_id,
      p_branch_id,
      p_warehouse_id,
      v_row.required_qty,
      'kitchen_send',
      'kitchen_send',
      p_event_id,
      p_reference_number,
      p_created_by,
      true
    );

    END IF;

    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', COALESCE(v_res->>'error', 'KITCHEN_RAW_DEDUCTION_FAILED'),
        'detail', COALESCE(v_res->>'detail', v_res::text),
        'raw_material_id', v_row.raw_material_id
      );
    END IF;

    v_total_cost := v_total_cost + COALESCE((v_res->>'total_cost')::numeric, 0);

    v_raws := v_raws || jsonb_build_object(
      'raw_material_id', v_row.raw_material_id,
      'raw_name', v_row.raw_name,
      'quantity', v_row.required_qty,
      'total_cost', COALESCE((v_res->>'total_cost')::numeric, 0)
    );

    IF COALESCE((v_res->>'oversold')::numeric, 0) > 0 THEN
      v_oversold := v_oversold || jsonb_build_object(
        'raw_material_id', v_row.raw_material_id,
        'raw_name', v_row.raw_name,
        'quantity', COALESCE((v_res->>'oversold')::numeric, 0),
        'total_cost', 0
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'candidate_negative_balances', p_negative_balances,
    'raw_materials_deducted', v_raws,
    'raw_oversold', v_oversold,
    'total_cost', v_total_cost,
    'errors', '[]'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'ORDER_ITEM_CONFIGURATION_INVALID',
    'detail', SQLERRM
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._kitchen_dispatch_component_plans(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._raw_remove_fifo_negative_dispatch(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean,numeric) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._kitchen_dispatch_deduct_planned(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._capture_kitchen_ingredient_prices()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raw_ids uuid[];
  v_prices jsonb := '{}'::jsonb;
  v_component jsonb;
  v_price jsonb;
  v_components jsonb := '[]'::jsonb;
  v_unit_cost numeric;
  v_quantity numeric;
  v_lookup_failed boolean := false;
  v_context_oid oid;
  v_scope jsonb;
  v_missing uuid[];
  v_use_context boolean := false;
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

  -- A name or client-set GUC is never sufficient. Accept only this backend's
  -- temporary table owned by the canonical dispatcher owner, with every client
  -- read/write privilege denied, plus exact event/branch/user/as-of/transaction.
  BEGIN
    SELECT c.oid INTO v_context_oid FROM pg_class c
       WHERE c.oid=to_regclass('pg_temp.kitchen_dispatch_price_context')
         AND c.relnamespace=pg_my_temp_schema() AND c.relpersistence='t'
         AND c.relowner=(SELECT proowner FROM pg_proc
           WHERE oid='public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure)
         AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE');
    IF v_context_oid IS NOT NULL THEN
      SELECT payload INTO v_scope FROM pg_temp.kitchen_dispatch_price_context WHERE key='scope';
      v_use_context := COALESCE(
        v_scope->>'branch_id'=NEW.branch_id::text
        AND v_scope->>'actor_id'=auth.uid()::text
        AND (v_scope->>'as_of')::timestamptz=COALESCE(NEW.created_at,now())
        AND v_scope->>'txid'=txid_current()::text
        AND (v_scope->'event_ids') ? NEW.id::text,false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_use_context := false;
  END;

  BEGIN
    IF v_use_context THEN
      SELECT array_agg(raw_id) INTO v_missing
      FROM unnest(v_raw_ids) raw_id
      WHERE NOT EXISTS (SELECT 1 FROM pg_temp.kitchen_dispatch_price_context c
                        WHERE c.key='raw:'||raw_id::text);
      IF cardinality(v_missing)>0 THEN
        SELECT COALESCE(jsonb_object_agg(
          p.raw_material_id::text,
          jsonb_build_object('unit_cost',p.unit_cost,'price_source',p.price_source,'priced_at',p.priced_at)
        ),'{}'::jsonb) INTO v_prices
        FROM public._kitchen_approved_price_candidate(NEW.branch_id,v_missing,COALESCE(NEW.created_at,now())) p
        WHERE p.unit_cost>0 AND p.price_source IN ('purchase','pricing','stock_count')
          AND p.priced_at IS NOT NULL AND p.priced_at<=COALESCE(NEW.created_at,now());
        -- Unknowns are cached as explicit null, never a zero/default guess.
        INSERT INTO pg_temp.kitchen_dispatch_price_context(key,payload)
        SELECT 'raw:'||raw_id::text,COALESCE(v_prices->(raw_id::text),'null'::jsonb)
        FROM unnest(v_missing) raw_id
        ON CONFLICT(key) DO NOTHING;
      END IF;
      SELECT COALESCE(jsonb_object_agg(raw_id::text,c.payload),'{}'::jsonb)
      INTO v_prices FROM unnest(v_raw_ids) raw_id
      JOIN pg_temp.kitchen_dispatch_price_context c ON c.key='raw:'||raw_id::text;
    ELSE
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

    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Match canonical all-components lookup_failed for this event; a failed
    -- lookup never enters the cache or poisons the next event's retry.
    v_lookup_failed := true;
    v_prices := '{}'::jsonb;
    RAISE LOG 'kitchen_price_snapshot_lookup_failed event % SQLSTATE %',NEW.id,SQLSTATE;
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
$function$;

CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt(p_receipt_ledger_id bigint, p_receipt_batch_id uuid, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_receipt public.inventory_ledger%ROWTYPE;
  v_batch public.raw_material_batches%ROWTYPE;
  v_debt record;
  v_source public.inventory_ledger%ROWTYPE;
  v_estimate public.raw_fifo_debt_price_estimates%ROWTYPE;
  v_take numeric(18,6);
  v_available numeric(18,6);
  v_actual_value numeric(18,6);
  v_estimate_take numeric(18,6);
  v_estimate_value numeric(18,6);
  v_delta numeric(18,6);
  v_new_total numeric(18,6);
  v_settlement_id uuid;
  v_res jsonb;
  v_had_estimate boolean;
  v_pending_receipt numeric(18,6):=0;
  v_total_settled numeric(18,6):=0;
  v_total_value numeric(18,6):=0;
  v_total_adjustment numeric(18,6):=0;
BEGIN
  SELECT * INTO v_receipt
  FROM public.inventory_ledger
  WHERE id=p_receipt_ledger_id
    AND raw_material_id IS NOT NULL
    AND quantity>0
  FOR SHARE;

  SELECT * INTO v_batch
  FROM public.raw_material_batches
  WHERE id=p_receipt_batch_id
  FOR UPDATE;

  IF v_receipt.id IS NULL OR v_batch.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_RECEIPT_NOT_FOUND');
  END IF;

  IF v_batch.raw_material_id<>v_receipt.raw_material_id
     OR v_batch.branch_id<>v_receipt.branch_id
     OR v_batch.warehouse_id IS DISTINCT FROM v_receipt.warehouse_id THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_RECEIPT_BATCH_MISMATCH');
  END IF;

  v_available:=LEAST(v_receipt.quantity,GREATEST(v_batch.quantity,0));

  FOR v_debt IN
    SELECT d.*
    FROM public.raw_fifo_debts d
    WHERE d.raw_material_id=v_receipt.raw_material_id
      AND d.branch_id=v_receipt.branch_id
      AND d.warehouse_id=v_receipt.warehouse_id
      AND d.source_created_at<=v_receipt.created_at
      AND d.settled_quantity<d.debt_quantity
    ORDER BY d.source_created_at,d.source_ledger_id
    FOR UPDATE
  LOOP
    EXIT WHEN v_available<=0;

    v_take:=LEAST(v_available,v_debt.debt_quantity-v_debt.settled_quantity);
    IF v_take<=0 THEN CONTINUE; END IF;

    INSERT INTO public.raw_fifo_settlements(
      debt_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,run_id
    ) VALUES (
      v_debt.id,v_receipt.id,v_batch.id,v_take,
      COALESCE(v_receipt.unit_cost,0),
      v_take*COALESCE(v_receipt.unit_cost,0),
      p_run_id
    )
    ON CONFLICT (debt_id,receipt_ledger_id) DO NOTHING
    RETURNING id INTO v_settlement_id;

    IF v_settlement_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_source
    FROM public.inventory_ledger
    WHERE id=v_debt.source_ledger_id
    FOR UPDATE;

    IF v_source.id IS NULL OR v_source.quantity>=0 THEN
      UPDATE public.raw_fifo_settlements
      SET reconciliation_status='error',
          reconciliation_error='FIFO_SOURCE_LEDGER_INVALID'
      WHERE id=v_settlement_id;
      CONTINUE;
    END IF;

    v_had_estimate:=false;
    v_estimate_take:=0;
    v_estimate_value:=0;
    v_actual_value:=v_take*COALESCE(v_receipt.unit_cost,0);
    v_delta:=v_actual_value;

    SELECT * INTO v_estimate
    FROM public.raw_fifo_debt_price_estimates
    WHERE debt_id=v_debt.id
    FOR UPDATE;

    IF v_estimate.debt_id IS NOT NULL
       AND v_estimate.remaining_estimated_quantity>0 THEN
      v_had_estimate:=true;
      v_estimate_take:=LEAST(v_take,v_estimate.remaining_estimated_quantity);
      v_estimate_value:=v_estimate_take*v_estimate.estimated_unit_cost;

      IF COALESCE(v_receipt.unit_cost,0)>0 THEN
        -- Actual receipt replaces the provisional basis only by the difference.
        v_delta:=v_actual_value-v_estimate_value;
        UPDATE public.raw_fifo_debt_price_estimates
        SET remaining_estimated_quantity=GREATEST(remaining_estimated_quantity-v_estimate_take,0),
            replaced_quantity=replaced_quantity+v_estimate_take,
            updated_at=now()
        WHERE debt_id=v_debt.id;
      ELSE
        -- A zero-cost receipt is not a stronger valuation source; preserve fallback cost.
        v_delta:=0;
        UPDATE public.raw_fifo_debt_price_estimates
        SET remaining_estimated_quantity=GREATEST(remaining_estimated_quantity-v_estimate_take,0),
            zero_cost_finalized_quantity=zero_cost_finalized_quantity+v_estimate_take,
            updated_at=now()
        WHERE debt_id=v_debt.id;
      END IF;
    END IF;

    v_new_total:=COALESCE(v_source.total_cost,0)-v_delta;
    IF v_new_total>0.005 THEN
      RAISE EXCEPTION
        'FIFO_PRICE_FALLBACK_SETTLEMENT_NEGATIVE_COST ledger=% current=% delta=%',
        v_source.id,v_source.total_cost,v_delta;
    END IF;

    UPDATE public.raw_fifo_debts
    SET settled_quantity=settled_quantity+v_take,
        updated_at=now()
    WHERE id=v_debt.id;

    IF v_debt.oversold_batch_id IS NOT NULL THEN
      UPDATE public.raw_material_batches
      SET quantity=LEAST(quantity+v_take,0)
      WHERE id=v_debt.oversold_batch_id;
    END IF;

    -- Defer only sale/kitchen sources, whose reconciliation does not mutate stock.
    v_pending_receipt:=v_pending_receipt+v_take;
    IF v_source.reference_type IS NULL
       OR v_source.reference_type NOT IN ('sale','kitchen_send') THEN
      -- Production/transfer/other propagation must see the canonical receipt quantity.
      UPDATE public.raw_material_batches
      SET quantity=GREATEST(quantity-v_pending_receipt,0)
      WHERE id=v_batch.id;
      v_pending_receipt:=0;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=v_new_total,
        unit_cost=CASE
          WHEN quantity<0 THEN abs(v_new_total/quantity)
          ELSE unit_cost
        END
    WHERE id=v_source.id;

    IF abs(v_delta)>0.000001 THEN
      v_res:=public._fifo_adjust_reference_delta(
        v_source.reference_type,
        v_source.reference_id,
        v_source.branch_id,
        v_source.warehouse_id,
        'raw_material',
        v_source.raw_material_id,
        v_delta,
        0
      );

      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        IF v_had_estimate THEN
          RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REFERENCE_RECONCILIATION_FAILED ledger=% detail=%',
            v_source.id,v_res;
        END IF;

        UPDATE public.raw_fifo_settlements
        SET reconciliation_status='error',
            reconciliation_error=COALESCE(v_res->>'error','FIFO_REFERENCE_RECONCILIATION_FAILED')
        WHERE id=v_settlement_id;
      END IF;
    END IF;

    v_available:=v_available-v_take;
    v_total_settled:=v_total_settled+v_take;
    v_total_value:=v_total_value+v_actual_value;
    v_total_adjustment:=v_total_adjustment+v_delta;
  END LOOP;

  -- Flush only successful, not already flushed source quantities.
  IF v_pending_receipt>0 THEN
    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_pending_receipt,0)
    WHERE id=v_batch.id;
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,
    'settled_value',v_total_value,
    'cost_adjustment',v_total_adjustment,
    'remaining_receipt_quantity',v_available
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._send_to_kitchen_core_20260914(p_order_id uuid, p_sent_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_id uuid;
  v_status text;
  v_order_number text;
  v_table_id uuid;
  v_table_name text;
  v_order_type text;
  v_guest_count integer;
  v_warehouse_id uuid;
  v_sent_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_all_sent boolean := false;
  v_row record;
  v_inventory jsonb;
  v_failure_product uuid;
  v_failure_name text;
  v_failure_error text;
  v_failure_detail text;
  v_first_sent_at timestamptz;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_effective_sent_by uuid;
  v_snapshot jsonb;
  v_component_plan jsonb;
  v_plan_items jsonb;
  v_dynamic_products uuid[];
  v_dispatch_raw_ids uuid[];
  v_dispatch_prices jsonb;
  v_negative_balances jsonb := '{}'::jsonb;
  v_repeated_raw_ids uuid[];
  v_lock_raw uuid;
  v_lock_started timestamptz;
  v_lock_timeout interval := current_setting('lock_timeout')::interval;
  v_summary_row record;
BEGIN
  BEGIN
    IF NOT v_is_service_role AND auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    SELECT branch_id, status, order_number, table_id, order_type, guest_count, inventory_warehouse_id
    INTO v_branch_id, v_status, v_order_number, v_table_id, v_order_type, v_guest_count, v_warehouse_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    IF NOT v_is_service_role THEN
      IF NOT public.user_may_access_branch(v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      IF NOT (public.is_platform_admin() OR public.can_permission('pos.send_kitchen')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'detail', 'pos.send_kitchen');
      END IF;
    END IF;

    IF v_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE');
    END IF;

    IF v_warehouse_id IS NULL THEN
      SELECT w.id INTO v_warehouse_id
      FROM public.warehouses w
      WHERE w.branch_id = v_branch_id
        AND w.is_active = true
      ORDER BY COALESCE(w.is_default, false) DESC, w.created_at, w.id
      LIMIT 1;

      IF v_warehouse_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_FOUND');
      END IF;

      UPDATE public.orders
      SET inventory_warehouse_id = v_warehouse_id
      WHERE id = p_order_id;
    END IF;

    IF v_table_id IS NOT NULL THEN
      SELECT name INTO v_table_name
      FROM public.dining_tables
      WHERE id = v_table_id
        AND branch_id = v_branch_id;
    END IF;

    v_effective_sent_by := CASE
      WHEN v_is_service_role THEN COALESCE(p_sent_by, auth.uid())
      ELSE auth.uid()
    END;

    CREATE TEMP TABLE IF NOT EXISTS pg_temp.kns_delta (
      order_item_id uuid PRIMARY KEY,
      send_id uuid,
      event_id uuid,
      delta_quantity numeric(14,4) NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.kns_delta;

    INSERT INTO pg_temp.kns_delta(order_item_id, event_id, delta_quantity)
    SELECT oi.id, gen_random_uuid(), oi.quantity - COALESCE(s.sent_quantity, 0)
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.quantity > COALESCE(s.sent_quantity, 0);

    IF EXISTS (
      SELECT 1
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.categories c ON c.id = p.category_id AND c.branch_id = v_branch_id
      LEFT JOIN public.kitchen_stations ks ON ks.id = c.kitchen_station_id AND ks.is_active = true
      WHERE (
        p.category_id IS NOT NULL
        AND (
          c.id IS NULL
          OR ks.id IS NULL
          OR ks.branch_id IS DISTINCT FROM v_branch_id
          OR lower(btrim(ks.code)) = 'cashier'
        )
      )
      OR (
        p.category_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.kitchen_stations default_ks
          WHERE default_ks.branch_id = v_branch_id
            AND lower(btrim(default_ks.code)) = 'main'
            AND default_ks.is_active = true
        )
      )
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'KITCHEN_STATION_NOT_CONFIGURED'
      );
    END IF;

    -- Keep the backend-local object, delete data at commit. Recreating
    -- temporary catalogs for every send would increase WAL and CPU.
    IF (SELECT count(*) FROM pg_temp.kns_delta)>1 THEN
      IF to_regclass('pg_temp.kitchen_dispatch_price_context') IS NULL THEN
        CREATE TEMP TABLE pg_temp.kitchen_dispatch_price_context (
          key text PRIMARY KEY,payload jsonb NOT NULL
        ) ON COMMIT DELETE ROWS;
        REVOKE ALL ON TABLE pg_temp.kitchen_dispatch_price_context FROM PUBLIC,anon,authenticated,service_role;
      END IF;
      IF EXISTS (
        SELECT c.oid FROM pg_class c
       WHERE c.oid=to_regclass('pg_temp.kitchen_dispatch_price_context')
         AND c.relnamespace=pg_my_temp_schema() AND c.relpersistence='t'
         AND c.relowner=(SELECT proowner FROM pg_proc
           WHERE oid='public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure)
         AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE')
      ) THEN
        -- DELETE, rather than TRUNCATE, avoids replacing temporary relfilenodes.
        DELETE FROM pg_temp.kitchen_dispatch_price_context;
        INSERT INTO pg_temp.kitchen_dispatch_price_context(key,payload)
        SELECT 'scope',jsonb_build_object(
          'branch_id',v_branch_id,'actor_id',auth.uid(),'as_of',now(),
          'txid',txid_current()::text,'event_ids',jsonb_agg(event_id::text)
        ) FROM pg_temp.kns_delta;
      END IF;
    END IF;

    -- Resolve each configuration once; use that result for BOTH deduction
    -- and one approved-price lookup across every known dispatch material.
    IF (SELECT count(*) FROM pg_temp.kns_delta)>1 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'order_item_id',d.order_item_id,'product_id',oi.product_id,
      'modifier_option_ids',to_jsonb(COALESCE(oi.modifier_option_ids,'{}'::uuid[]))
    ) ORDER BY oi.created_at,oi.id),'[]'::jsonb)
    INTO v_plan_items
    FROM pg_temp.kns_delta d JOIN public.order_items oi ON oi.id=d.order_item_id
    JOIN public.products p ON p.id=oi.product_id;

    v_component_plan := public._kitchen_dispatch_component_plans(v_branch_id,v_plan_items);
    -- The canonical fallback can CREATE this product's recipe during dispatch.
    -- Never memoize any configuration of a product with an empty/error plan:
    -- later lines must observe that materialized recipe and their modifiers.
    SELECT array_agg(DISTINCT (item->>'product_id')::uuid)
    INTO v_dynamic_products
    FROM jsonb_array_elements(v_plan_items) item
    WHERE COALESCE(jsonb_array_length(
      (v_component_plan->'plans'->(item->>'order_item_id'))->'components'
    ),0)=0;

    END IF;

    IF v_component_plan IS NOT NULL AND EXISTS (
      SELECT c.oid FROM pg_class c
       WHERE c.oid=to_regclass('pg_temp.kitchen_dispatch_price_context')
         AND c.relnamespace=pg_my_temp_schema() AND c.relpersistence='t'
         AND c.relowner=(SELECT proowner FROM pg_proc
           WHERE oid='public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure)
         AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE')
    ) THEN
      SELECT array_agg(DISTINCT (component->>'raw_material_id')::uuid)
      INTO v_dispatch_raw_ids
      FROM jsonb_each(v_component_plan->'plans') item
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(item.value->'components','[]'::jsonb)) component;
      IF cardinality(v_dispatch_raw_ids)>0 THEN
        BEGIN
          SELECT COALESCE(jsonb_object_agg(p.raw_material_id::text,
            jsonb_build_object('unit_cost',p.unit_cost,'price_source',p.price_source,'priced_at',p.priced_at)
          ),'{}'::jsonb) INTO v_dispatch_prices
          FROM public._kitchen_approved_price_candidate(v_branch_id,v_dispatch_raw_ids,now()) p
          WHERE p.unit_cost>0 AND p.price_source IN ('purchase','pricing','stock_count')
            AND p.priced_at IS NOT NULL AND p.priced_at<=now();
          INSERT INTO pg_temp.kitchen_dispatch_price_context(key,payload)
          SELECT 'raw:'||raw_id::text,COALESCE(v_dispatch_prices->(raw_id::text),'null'::jsonb)
          FROM unnest(v_dispatch_raw_ids) raw_id ON CONFLICT(key) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          -- No partial cache on failure; per-event capture retains canonical
          -- nonblocking lookup/failure semantics and may retry missing raws.
          RAISE LOG 'kitchen_price_dispatch_lookup_failed order % SQLSTATE %',p_order_id,SQLSTATE;
        END;
      END IF;
    END IF;


    -- Only fixed plans qualify. Fallback can materialize recipes mid-send.
    IF v_component_plan IS NOT NULL AND cardinality(COALESCE(v_dynamic_products,'{}'::uuid[]))=0 THEN
      SELECT array_agg(raw_id ORDER BY raw_id) INTO v_repeated_raw_ids
      FROM (
        SELECT (r->>'raw_material_id')::uuid raw_id
        FROM jsonb_each(v_component_plan->'plans') plan
        CROSS JOIN LATERAL jsonb_array_elements(plan.value->'components') r
        WHERE (r->>'quantity_per_sale')::numeric>0
        GROUP BY (r->>'raw_material_id')::uuid HAVING count(*)>1
      ) repeated;
      IF cardinality(COALESCE(v_repeated_raw_ids,'{}'::uuid[]))>0 THEN
        -- Prelock ALL known materials in UUID order before any deduction.
        -- Retain these xact locks across every reuse; no shared stock cache exists.
-- All-or-nothing admission: release this attempt's partial locks before
    -- retrying, so an inverse-order canonical writer can finish. Never read
    -- reusable quantities until the complete lock set is held.
    v_lock_started := clock_timestamp();
    LOOP
      BEGIN
        FOR v_lock_raw IN
          SELECT DISTINCT (r->>'raw_material_id')::uuid
          FROM jsonb_each(v_component_plan->'plans') plan
          CROSS JOIN LATERAL jsonb_array_elements(plan.value->'components') r
          ORDER BY 1
        LOOP
          IF NOT pg_try_advisory_xact_lock(hashtextextended(v_lock_raw::text||':'||v_branch_id::text,0)) THEN
            RAISE lock_not_available USING MESSAGE='KITCHEN_MATERIAL_ADMISSION_RETRY';
          END IF;
        END LOOP;
        EXIT;
      EXCEPTION WHEN lock_not_available THEN
        -- Exception-block rollback releases only locks acquired in this attempt.
        IF v_lock_timeout > interval '0'
           AND clock_timestamp()-v_lock_started >= v_lock_timeout THEN
          RAISE lock_not_available USING MESSAGE='canceling statement due to lock timeout';
        END IF;
        PERFORM pg_sleep(0.005);
      END;
    END LOOP;
        SELECT COALESCE(jsonb_object_agg(raw_id::text,warehouse_qty),'{}'::jsonb)
        INTO v_negative_balances
        FROM (
          SELECT wanted.raw_id,
            COALESCE(sum(b.quantity) FILTER (WHERE b.warehouse_id=v_warehouse_id),0)::numeric(14,4) warehouse_qty
          FROM unnest(v_repeated_raw_ids) wanted(raw_id)
          LEFT JOIN public.raw_material_batches b ON b.raw_material_id=wanted.raw_id AND b.branch_id=v_branch_id
          GROUP BY wanted.raw_id
          HAVING count(*) FILTER (WHERE b.quantity>0)=0
        ) eligible;
      END IF;
    END IF;

    FOR v_row IN
      SELECT
        d.order_item_id,
        d.event_id,
        d.delta_quantity,
        oi.product_id,
        oi.modifier_option_ids,
        p.name AS product_name
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      ORDER BY oi.created_at, oi.id
    LOOP
      v_failure_product := v_row.product_id;
      v_failure_name := v_row.product_name;
      v_failure_error := NULL;
      v_failure_detail := NULL;

      IF v_component_plan IS NULL OR v_row.product_id=ANY(COALESCE(v_dynamic_products,'{}'::uuid[])) THEN
      v_inventory := public._deduct_kitchen_raw_components(
        v_row.product_id,
        v_branch_id,
        v_warehouse_id,
        v_row.delta_quantity,
        to_jsonb(COALESCE(v_row.modifier_option_ids, '{}'::uuid[])),
        v_row.event_id,
        v_order_number,
        v_effective_sent_by
      );

      ELSE
      v_inventory := public._kitchen_dispatch_deduct_planned(
        v_row.product_id,
        v_branch_id,
        v_warehouse_id,
        v_row.delta_quantity,
        to_jsonb(COALESCE(v_row.modifier_option_ids, '{}'::uuid[])),
        v_row.event_id,
        v_order_number,
        v_effective_sent_by,
        (v_component_plan->'plans')->(v_row.order_item_id::text),
        v_negative_balances
      );

      END IF;
      v_negative_balances:=COALESCE(v_inventory->'candidate_negative_balances',v_negative_balances);
      IF COALESCE((v_inventory->>'success')::boolean, false) IS NOT TRUE THEN
        v_failure_error := COALESCE(
          NULLIF(v_inventory->>'error', ''),
          'KITCHEN_RAW_DEDUCTION_FAILED'
        );
        v_failure_detail := COALESCE(
          NULLIF(v_inventory->>'detail', ''),
          v_failure_error
        );
        RAISE EXCEPTION 'KITCHEN_RAW_DEDUCTION_FAILED';
      END IF;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'raw_material_id', e->>'raw_material_id',
            'raw_name', e->>'raw_name',
            'quantity', (e->>'quantity')::numeric
          )
          ORDER BY e->>'raw_material_id'
        ),
        '[]'::jsonb
      )
      INTO v_snapshot
      FROM jsonb_array_elements(
        COALESCE(v_inventory->'raw_materials_deducted', '[]'::jsonb)
      ) e;

      INSERT INTO public.order_kitchen_inventory_events(
        id,
        branch_id,
        warehouse_id,
        order_id,
        order_item_id,
        sent_quantity,
        total_cost,
        created_by,
        component_snapshot,
        snapshot_version
      ) VALUES (
        v_row.event_id,
        v_branch_id,
        v_warehouse_id,
        p_order_id,
        v_row.order_item_id,
        v_row.delta_quantity,
        COALESCE((v_inventory->>'total_cost')::numeric, 0),
        v_effective_sent_by,
        v_snapshot,
        2
      );

      INSERT INTO public.order_kitchen_inventory_effects(
        event_id,
        branch_id,
        warehouse_id,
        target_type,
        target_id,
        quantity,
        total_cost
      )
      SELECT
        v_row.event_id,
        v_branch_id,
        v_warehouse_id,
        'raw_material',
        (e->>'raw_material_id')::uuid,
        (e->>'quantity')::numeric,
        COALESCE((e->>'total_cost')::numeric, 0)
      FROM jsonb_array_elements(
        COALESCE(v_inventory->'raw_materials_deducted', '[]'::jsonb)
      ) e
      WHERE COALESCE((e->>'quantity')::numeric, 0) > 0;

      v_failure_product := NULL;
      v_failure_name := NULL;
      v_failure_error := NULL;
      v_failure_detail := NULL;
    END LOOP;


    -- Only materials that remained fully nonpositive are batched. Their last
    -- positive avg_cost cannot change during this dispatch. The ORIGINAL avg
    -- guard still owns the final value; do not disable it or invent a counter.
    FOR v_summary_row IN
      SELECT (entry.key)::uuid raw_id,COALESCE(sum(b.quantity),0)::numeric(14,4) branch_qty
      FROM jsonb_each(v_negative_balances) entry
      LEFT JOIN public.raw_material_batches b
        ON b.raw_material_id=(entry.key)::uuid AND b.branch_id=v_branch_id
      GROUP BY entry.key ORDER BY entry.key
    LOOP
      INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
      VALUES(v_summary_row.raw_id,v_branch_id,v_summary_row.branch_qty,0)
      ON CONFLICT(raw_material_id,branch_id) DO UPDATE
      SET quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();
    END LOOP;

    WITH candidates AS (
      SELECT d.order_item_id, d.delta_quantity, oi.quantity AS target_quantity
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
    ),
    upserted AS (
      INSERT INTO public.order_kitchen_sends(
        branch_id,
        order_id,
        order_item_id,
        sent_at,
        sent_by,
        sent_quantity
      )
      SELECT
        v_branch_id,
        p_order_id,
        c.order_item_id,
        now(),
        v_effective_sent_by,
        c.target_quantity
      FROM candidates c
      ON CONFLICT (order_item_id) DO UPDATE
      SET sent_quantity = EXCLUDED.sent_quantity,
          sent_at = now(),
          sent_by = EXCLUDED.sent_by
      WHERE public.order_kitchen_sends.sent_quantity < EXCLUDED.sent_quantity
      RETURNING id, order_item_id
    )
    UPDATE pg_temp.kns_delta d
    SET send_id = u.id
    FROM upserted u
    WHERE u.order_item_id = d.order_item_id;

    UPDATE public.order_kitchen_inventory_events e
    SET kitchen_send_id = d.send_id
    FROM pg_temp.kns_delta d
    WHERE e.id = d.event_id;

    SELECT count(*) INTO v_count
    FROM pg_temp.kns_delta;

    IF v_count > 0 THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'send_id', d.send_id,
            'order_item_id', d.order_item_id,
            'product_id', oi.product_id,
            'product_name', p.name,
            'unit_name', oi.unit_name,
            'station_code', CASE
              WHEN p.category_id IS NULL THEN 'main'
              ELSE ks.code
            END,
            'quantity', d.delta_quantity,
            'current_quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'discount_amount', oi.discount_amount,
            'bonus_quantity', oi.bonus_quantity,
            'total', oi.total,
            'notes', oi.notes,
            'modifiers', COALESCE(oi.modifiers_snapshot, '[]'::jsonb)
          )
          ORDER BY oi.created_at
        ),
        '[]'::jsonb
      )
      INTO v_sent_items
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      LEFT JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.categories c
        ON c.id = p.category_id
       AND c.branch_id = v_branch_id
      LEFT JOIN public.kitchen_stations ks
        ON ks.id = c.kitchen_station_id
       AND ks.is_active = true;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      LEFT JOIN public.order_kitchen_sends s
        ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND oi.quantity > COALESCE(s.sent_quantity, 0)
    )
    INTO v_all_sent;

    SELECT min(s.sent_at)
    INTO v_first_sent_at
    FROM public.order_kitchen_sends s
    WHERE s.order_id = p_order_id;

    IF v_first_sent_at IS NOT NULL THEN
      UPDATE public.orders
      SET kitchen_status = CASE
            WHEN kitchen_status = 'pending' THEN 'sent'
            ELSE kitchen_status
          END,
          kitchen_sent_at = COALESCE(kitchen_sent_at, v_first_sent_at)
      WHERE id = p_order_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', p_order_id,
      'order_number', v_order_number,
      'table_name', v_table_name,
      'order_type', v_order_type,
      'guest_count', v_guest_count,
      'warehouse_id', v_warehouse_id,
      'sent', v_sent_items,
      'items_sent_count', v_count,
      'all_sent', v_all_sent,
      'inventory_deducted', v_count > 0
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_failure_error, 'TRANSACTION_FAILED'),
      'product_id', v_failure_product,
      'product_name', v_failure_name,
      'detail', COALESCE(v_failure_detail, SQLERRM)
    );
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_stock_count(p_stock_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count public.stock_counts%ROWTYPE;
  v_item public.stock_count_items%ROWTYPE;
  v_current numeric(14,4);
  v_variance numeric(14,4);
  v_applied integer := 0;
  v_res jsonb;
  v_shortage numeric(14,4);
  v_value numeric(14,2);
  v_fg_delta numeric(14,2) := 0;
  v_rm_delta numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_journal_id uuid;
  v_locked_raw uuid;
  v_lock_started timestamptz;
  v_lock_timeout interval := current_setting('lock_timeout')::interval;
BEGIN
  BEGIN
    SELECT *
      INTO v_count
      FROM public.stock_counts
      WHERE id = p_stock_count_id
      FOR UPDATE;

    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;

    IF v_count.status <> 'approved' THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_APPROVED', 'status', v_count.status);
    END IF;

    IF NOT public.can_permission('inventory.count.apply') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NOT public.user_may_access_branch(v_count.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    -- Read counted variance only after the same material/branch lock used
    -- by canonical inbound and FIFO consumption. Lock all counted raws in
    -- UUID order to keep two stock counts' material lock order deterministic.
-- All-or-nothing admission: release this attempt's partial locks before
    -- retrying, so an inverse-order canonical writer can finish. Never read
    -- reusable quantities until the complete lock set is held.
    v_lock_started := clock_timestamp();
    LOOP
      BEGIN
    FOR v_locked_raw IN
      SELECT DISTINCT raw_material_id FROM public.stock_count_items
      WHERE stock_count_id=p_stock_count_id AND raw_material_id IS NOT NULL
      ORDER BY raw_material_id
    LOOP
      IF NOT pg_try_advisory_xact_lock(hashtextextended(v_locked_raw::text||':'||v_count.branch_id::text,0)) THEN
            RAISE lock_not_available USING MESSAGE='KITCHEN_MATERIAL_ADMISSION_RETRY';
          END IF;
    END LOOP;
        EXIT;
      EXCEPTION WHEN lock_not_available THEN
        -- Exception-block rollback releases only locks acquired in this attempt.
        IF v_lock_timeout > interval '0'
           AND clock_timestamp()-v_lock_started >= v_lock_timeout THEN
          RAISE lock_not_available USING MESSAGE='canceling statement due to lock timeout';
        END IF;
        PERFORM pg_sleep(0.005);
      END;
    END LOOP;

    FOR v_item IN
      SELECT *
      FROM public.stock_count_items
      WHERE stock_count_id = p_stock_count_id
      ORDER BY id
      FOR UPDATE
    LOOP
      v_value := 0;

      IF v_item.raw_material_id IS NOT NULL THEN
        SELECT COALESCE(quantity, 0)
          INTO v_current
          FROM public.raw_material_warehouse_inventory
          WHERE raw_material_id = v_item.raw_material_id
            AND branch_id = v_count.branch_id
            AND warehouse_id = v_count.warehouse_id;

        v_current := COALESCE(v_current, 0);
        v_variance := v_item.counted_quantity - v_current;

        IF v_variance > 0 THEN
          v_res := public._raw_add(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            v_variance, v_item.unit_cost, NULL, NULL, NULL,
            'adjustment', 'stock_count', v_count.id, v_count.count_number, auth.uid()
          );
          IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RETURN jsonb_build_object(
              'success', false, 'error', 'RAW_ADJUST_FAILED',
              'raw_material_id', v_item.raw_material_id, 'detail', v_res->>'error'
            );
          END IF;
          v_value := round(v_variance * COALESCE(v_item.unit_cost, 0), 2);
          v_rm_delta := v_rm_delta + v_value;
        ELSIF v_variance < 0 THEN
          v_res := public._raw_remove_fifo(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            -v_variance, 'adjustment', 'stock_count', v_count.id,
            v_count.count_number, auth.uid()
          );
          v_shortage := COALESCE((v_res->>'shortage')::numeric, 0);
          IF v_shortage > 0 THEN
            RETURN jsonb_build_object(
              'success', false, 'error', 'STOCK_COUNT_SHORTAGE',
              'raw_material_id', v_item.raw_material_id, 'shortage', v_shortage
            );
          END IF;
          v_value := round(COALESCE((v_res->>'total_cost')::numeric, 0), 2);
          v_rm_delta := v_rm_delta - v_value;
        END IF;
      ELSE
        SELECT COALESCE(quantity, 0)
          INTO v_current
          FROM public.inventory
          WHERE product_id = v_item.product_id
            AND warehouse_id = v_count.warehouse_id;

        v_current := COALESCE(v_current, 0);
        v_variance := v_item.counted_quantity - v_current;

        IF v_variance > 0 THEN
          v_res := public._product_inv_add(
            v_item.product_id, v_count.warehouse_id, v_count.branch_id,
            v_variance, v_item.unit_cost, NULL, NULL, NULL,
            'adjustment', 'stock_count', v_count.id, v_count.count_number, auth.uid()
          );
          IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RETURN jsonb_build_object(
              'success', false, 'error', 'ADJUST_FAILED',
              'product_id', v_item.product_id, 'detail', v_res->>'error'
            );
          END IF;
          v_value := round(v_variance * COALESCE(v_item.unit_cost, 0), 2);
          v_fg_delta := v_fg_delta + v_value;
        ELSIF v_variance < 0 THEN
          v_res := public._product_inv_remove_fifo(
            v_item.product_id, v_count.warehouse_id, v_count.branch_id,
            -v_variance, 'adjustment', 'stock_count', v_count.id,
            v_count.count_number, auth.uid()
          );
          v_shortage := COALESCE((v_res->>'shortage')::numeric, 0);
          IF v_shortage > 0 THEN
            RETURN jsonb_build_object(
              'success', false, 'error', 'STOCK_COUNT_SHORTAGE',
              'product_id', v_item.product_id, 'shortage', v_shortage
            );
          END IF;
          v_value := round(COALESCE((v_res->>'total_cost')::numeric, 0), 2);
          v_fg_delta := v_fg_delta - v_value;
        END IF;
      END IF;

      v_applied := v_applied + 1;
    END LOOP;

    IF v_fg_delta > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_fg', 'debit', round(v_fg_delta, 2), 'credit', 0,
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', 0, 'credit', round(v_fg_delta, 2),
        'note', v_count.count_number || ' · finished goods'
      );
    ELSIF v_fg_delta < 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_fg', 'debit', 0, 'credit', round(-v_fg_delta, 2),
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', round(-v_fg_delta, 2), 'credit', 0,
        'note', v_count.count_number || ' · finished goods'
      );
    END IF;

    IF v_rm_delta > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_rm', 'debit', round(v_rm_delta, 2), 'credit', 0,
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', 0, 'credit', round(v_rm_delta, 2),
        'note', v_count.count_number || ' · raw materials'
      );
    ELSIF v_rm_delta < 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_rm', 'debit', 0, 'credit', round(-v_rm_delta, 2),
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', round(-v_rm_delta, 2), 'credit', 0,
        'note', v_count.count_number || ' · raw materials'
      );
    END IF;

    IF jsonb_array_length(v_lines) > 0 THEN
      v_journal_id := public._post_journal_entry(
        v_count.branch_id,
        'stock_count',
        v_count.id,
        v_count.count_number,
        'تسوية جرد ' || COALESCE(v_count.count_number, v_count.id::text),
        v_lines
      );
    END IF;

    UPDATE public.stock_counts
    SET status = 'applied', applied_at = now()
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object(
      'success', true,
      'items_applied', v_applied,
      'journal_entry_id', v_journal_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TRANSACTION_FAILED',
        'detail', SQLERRM
      );
  END;
END;
$function$;
COMMIT;
