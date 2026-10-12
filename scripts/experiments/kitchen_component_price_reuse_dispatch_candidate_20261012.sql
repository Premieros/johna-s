-- #497 P2 EXPERIMENT ONLY. Depends on P1 candidate helpers being installed.
-- No trigger changes, canonical replacement, migration or production wiring.
-- Tests replace the capture trigger ONLY inside disposable rollback fixtures.

CREATE OR REPLACE FUNCTION public._capture_kitchen_ingredient_prices_reuse_candidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $capture$
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
       WHERE c.oid=to_regclass('pg_temp.kitchen_price_context_candidate')
         AND c.relnamespace=pg_my_temp_schema() AND c.relpersistence='t'
         AND c.relowner=(SELECT proowner FROM pg_proc
           WHERE oid='public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure)
         AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE');
    IF v_context_oid IS NOT NULL THEN
      SELECT payload INTO v_scope FROM pg_temp.kitchen_price_context_candidate WHERE key='scope';
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
      WHERE NOT EXISTS (SELECT 1 FROM pg_temp.kitchen_price_context_candidate c
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
        INSERT INTO pg_temp.kitchen_price_context_candidate(key,payload)
        SELECT 'raw:'||raw_id::text,COALESCE(v_prices->(raw_id::text),'null'::jsonb)
        FROM unnest(v_missing) raw_id
        ON CONFLICT(key) DO NOTHING;
      END IF;
      SELECT COALESCE(jsonb_object_agg(raw_id::text,c.payload),'{}'::jsonb)
      INTO v_prices FROM unnest(v_raw_ids) raw_id
      JOIN pg_temp.kitchen_price_context_candidate c ON c.key='raw:'||raw_id::text;
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
$capture$;

CREATE OR REPLACE FUNCTION public._send_to_kitchen_component_price_reuse_candidate(p_order_id uuid, p_sent_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
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
      IF to_regclass('pg_temp.kitchen_price_context_candidate') IS NULL THEN
        CREATE TEMP TABLE pg_temp.kitchen_price_context_candidate (
          key text PRIMARY KEY,payload jsonb NOT NULL
        ) ON COMMIT DELETE ROWS;
        REVOKE ALL ON TABLE pg_temp.kitchen_price_context_candidate FROM PUBLIC,anon,authenticated,service_role;
      END IF;
      IF EXISTS (
        SELECT c.oid FROM pg_class c
       WHERE c.oid=to_regclass('pg_temp.kitchen_price_context_candidate')
         AND c.relnamespace=pg_my_temp_schema() AND c.relpersistence='t'
         AND c.relowner=(SELECT proowner FROM pg_proc
           WHERE oid='public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure)
         AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE')
      ) THEN
        -- DELETE, rather than TRUNCATE, avoids replacing temporary relfilenodes.
        DELETE FROM pg_temp.kitchen_price_context_candidate;
        INSERT INTO pg_temp.kitchen_price_context_candidate(key,payload)
        SELECT 'scope',jsonb_build_object(
          'branch_id',v_branch_id,'actor_id',auth.uid(),'as_of',now(),
          'txid',txid_current()::text,'event_ids',jsonb_agg(event_id::text)
        ) FROM pg_temp.kns_delta;
      END IF;
    END IF;

    -- Plan only when an exact configuration is repeated.
    IF EXISTS (
      SELECT 1 FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id=d.order_item_id
      GROUP BY oi.product_id,COALESCE(oi.modifier_option_ids,'{}'::uuid[])
      HAVING count(*)>1
    ) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'order_item_id',d.order_item_id,'product_id',oi.product_id,
      'modifier_option_ids',to_jsonb(COALESCE(oi.modifier_option_ids,'{}'::uuid[]))
    ) ORDER BY oi.created_at,oi.id),'[]'::jsonb)
    INTO v_plan_items
    FROM pg_temp.kns_delta d JOIN public.order_items oi ON oi.id=d.order_item_id
    JOIN public.products p ON p.id=oi.product_id;

    v_component_plan := public._kitchen_component_plans_candidate(v_branch_id,v_plan_items);

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

      IF v_component_plan IS NULL THEN
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
      v_inventory := public._deduct_kitchen_raw_components_planned_candidate(
        v_row.product_id,
        v_branch_id,
        v_warehouse_id,
        v_row.delta_quantity,
        to_jsonb(COALESCE(v_row.modifier_option_ids, '{}'::uuid[])),
        v_row.event_id,
        v_order_number,
        v_effective_sent_by,
        (v_component_plan->'plans')->(v_row.order_item_id::text)
      );

      END IF;
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
REVOKE ALL ON FUNCTION public._capture_kitchen_ingredient_prices_reuse_candidate() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._send_to_kitchen_component_price_reuse_candidate(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
