-- Manufacturing retirement Phase 3:
-- kitchen send consumes the canonical raw-material graph directly.
-- No inventory unit production, ready-product stock, or manufacturing prebuild
-- is allowed on the new kitchen-send path.
--
-- Historical events/effects stay intact for payment/void compatibility.

DO $preflight$
BEGIN
  IF to_regprocedure('public.resolve_product_raw_components(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PHASE2_COMPONENT_RESOLVER_REQUIRED';
  END IF;
  IF to_regprocedure('public._send_to_kitchen_core_20260914(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_CORE_REQUIRED';
  END IF;
  IF to_regprocedure('public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'RAW_FIFO_REQUIRED';
  END IF;
END;
$preflight$;

ALTER TABLE public.order_kitchen_inventory_events
  ADD COLUMN IF NOT EXISTS component_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_version smallint NOT NULL DEFAULT 1;

ALTER TABLE public.order_kitchen_inventory_events
  DROP CONSTRAINT IF EXISTS order_kitchen_inventory_events_component_snapshot_array;
ALTER TABLE public.order_kitchen_inventory_events
  ADD CONSTRAINT order_kitchen_inventory_events_component_snapshot_array
  CHECK (jsonb_typeof(component_snapshot) = 'array');

ALTER TABLE public.order_kitchen_inventory_events
  DROP CONSTRAINT IF EXISTS order_kitchen_inventory_events_snapshot_version_positive;
ALTER TABLE public.order_kitchen_inventory_events
  ADD CONSTRAINT order_kitchen_inventory_events_snapshot_version_positive
  CHECK (snapshot_version >= 1);

CREATE OR REPLACE FUNCTION public.resolve_inventory_unit_raw_components(
  p_unit_id uuid,
  p_branch_id uuid
)
RETURNS TABLE(
  raw_material_id uuid,
  raw_name text,
  quantity_per_unit numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cycle boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_units iu
    WHERE iu.id = p_unit_id
      AND iu.branch_id = p_branch_id
      AND iu.is_active = true
  ) THEN
    RAISE EXCEPTION 'COMPONENT_GROUP_NOT_IN_BRANCH';
  END IF;

  WITH RECURSIVE walk(unit_id, path, cycle) AS (
    SELECT p_unit_id, ARRAY[p_unit_id]::uuid[], false

    UNION ALL

    SELECT
      rel.component_unit_id,
      w.path || rel.component_unit_id,
      rel.component_unit_id = ANY(w.path)
    FROM walk w
    JOIN public.inventory_unit_recipe_units rel
      ON rel.unit_id = w.unit_id
    WHERE NOT w.cycle
  )
  SELECT COALESCE(bool_or(cycle), false)
  INTO v_cycle
  FROM walk;

  IF v_cycle THEN
    RAISE EXCEPTION 'COMPONENT_GROUP_CYCLE';
  END IF;

  IF EXISTS (
    WITH RECURSIVE unit_walk(unit_id, path) AS (
      SELECT p_unit_id, ARRAY[p_unit_id]::uuid[]

      UNION ALL

      SELECT rel.component_unit_id, w.path || rel.component_unit_id
      FROM unit_walk w
      JOIN public.inventory_unit_recipe_units rel
        ON rel.unit_id = w.unit_id
      WHERE NOT rel.component_unit_id = ANY(w.path)
    )
    SELECT 1
    FROM unit_walk w
    JOIN public.inventory_units iu ON iu.id = w.unit_id
    WHERE iu.branch_id IS DISTINCT FROM p_branch_id
       OR iu.is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'COMPONENT_GROUP_NOT_IN_BRANCH';
  END IF;

  IF EXISTS (
    WITH RECURSIVE unit_walk(unit_id, path) AS (
      SELECT p_unit_id, ARRAY[p_unit_id]::uuid[]

      UNION ALL

      SELECT rel.component_unit_id, w.path || rel.component_unit_id
      FROM unit_walk w
      JOIN public.inventory_unit_recipe_units rel
        ON rel.unit_id = w.unit_id
      WHERE NOT rel.component_unit_id = ANY(w.path)
    )
    SELECT 1
    FROM unit_walk w
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = w.unit_id
    LEFT JOIN public.raw_materials rm ON rm.id = iur.raw_material_id
    WHERE rm.id IS NULL
       OR rm.branch_id IS DISTINCT FROM p_branch_id
       OR rm.is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'RAW_MATERIAL_NOT_IN_BRANCH';
  END IF;

  RETURN QUERY
  WITH RECURSIVE unit_walk(unit_id, multiplier, path) AS (
    SELECT p_unit_id, 1::numeric, ARRAY[p_unit_id]::uuid[]

    UNION ALL

    SELECT
      rel.component_unit_id,
      (
        w.multiplier
        * rel.quantity
        * (1 + COALESCE(rel.wastage_percent, 0) / 100.0)
      )::numeric,
      w.path || rel.component_unit_id
    FROM unit_walk w
    JOIN public.inventory_unit_recipe_units rel
      ON rel.unit_id = w.unit_id
    WHERE NOT rel.component_unit_id = ANY(w.path)
  )
  SELECT
    iur.raw_material_id,
    max(rm.name)::text AS raw_name,
    sum(
      uw.multiplier
      * iur.quantity
      * (1 + COALESCE(iur.wastage_percent, 0) / 100.0)
    )::numeric AS quantity_per_unit
  FROM unit_walk uw
  JOIN public.inventory_unit_recipes iur
    ON iur.unit_id = uw.unit_id
  JOIN public.raw_materials rm
    ON rm.id = iur.raw_material_id
   AND rm.branch_id = p_branch_id
   AND rm.is_active = true
  GROUP BY iur.raw_material_id
  HAVING sum(
    uw.multiplier
    * iur.quantity
    * (1 + COALESCE(iur.wastage_percent, 0) / 100.0)
  ) <> 0
  ORDER BY max(rm.name), iur.raw_material_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_kitchen_item_raw_components(
  p_product_id uuid,
  p_branch_id uuid,
  p_modifier_option_ids jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(
  raw_material_id uuid,
  raw_name text,
  quantity_per_sale numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mod jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.branch_id = p_branch_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_IN_BRANCH';
  END IF;

  v_mod := public.resolve_product_modifiers(
    p_product_id,
    p_branch_id,
    COALESCE(p_modifier_option_ids, '[]'::jsonb)
  );

  IF COALESCE((v_mod->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'MODIFIER_SELECTION_INVALID: %',
      COALESCE(v_mod->>'error', v_mod->>'detail', 'UNKNOWN');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.product_modifier_inventory_effects e
    JOIN public.product_modifier_options o
      ON o.id = e.option_id
     AND o.branch_id = p_branch_id
     AND o.is_active = true
    JOIN public.product_modifier_groups g
      ON g.id = o.group_id
     AND g.branch_id = p_branch_id
     AND g.is_active = true
    JOIN public.product_modifier_group_products gp
      ON gp.group_id = g.id
     AND gp.product_id = p_product_id
     AND gp.branch_id = p_branch_id
    LEFT JOIN public.raw_materials rm
      ON e.target_type = 'raw_material'
     AND rm.id = e.raw_material_id
    LEFT JOIN public.inventory_units iu
      ON e.target_type = 'inventory_unit'
     AND iu.id = e.inventory_unit_id
    WHERE e.branch_id = p_branch_id
      AND o.id IN (
        SELECT NULLIF(value, '')::uuid
        FROM jsonb_array_elements_text(COALESCE(p_modifier_option_ids, '[]'::jsonb))
      )
      AND (
        (e.target_type = 'raw_material' AND (
          rm.id IS NULL
          OR rm.branch_id IS DISTINCT FROM p_branch_id
          OR rm.is_active IS DISTINCT FROM true
        ))
        OR
        (e.target_type = 'inventory_unit' AND (
          iu.id IS NULL
          OR iu.branch_id IS DISTINCT FROM p_branch_id
          OR iu.is_active IS DISTINCT FROM true
        ))
      )
  ) THEN
    RAISE EXCEPTION 'MODIFIER_COMPONENT_NOT_IN_BRANCH';
  END IF;

  RETURN QUERY
  WITH base_raw AS (
    SELECT
      r.raw_material_id,
      r.raw_name,
      r.quantity_per_sale::numeric AS quantity_per_sale
    FROM public.resolve_product_raw_components(p_product_id, p_branch_id) r
  ),
  selected_effects AS (
    SELECT
      e.target_type,
      e.raw_material_id,
      e.inventory_unit_id,
      e.quantity_delta
    FROM public.product_modifier_inventory_effects e
    JOIN public.product_modifier_options o
      ON o.id = e.option_id
     AND o.branch_id = p_branch_id
     AND o.is_active = true
    JOIN public.product_modifier_groups g
      ON g.id = o.group_id
     AND g.branch_id = p_branch_id
     AND g.is_active = true
    JOIN public.product_modifier_group_products gp
      ON gp.group_id = g.id
     AND gp.product_id = p_product_id
     AND gp.branch_id = p_branch_id
    WHERE e.branch_id = p_branch_id
      AND o.id IN (
        SELECT NULLIF(value, '')::uuid
        FROM jsonb_array_elements_text(COALESCE(p_modifier_option_ids, '[]'::jsonb))
      )
  ),
  modifier_raw AS (
    SELECT
      e.raw_material_id,
      rm.name::text AS raw_name,
      e.quantity_delta::numeric AS quantity_per_sale
    FROM selected_effects e
    JOIN public.raw_materials rm
      ON rm.id = e.raw_material_id
     AND rm.branch_id = p_branch_id
     AND rm.is_active = true
    WHERE e.target_type = 'raw_material'
  ),
  selected_unit_effects AS (
    SELECT *
    FROM selected_effects
    WHERE target_type = 'inventory_unit'
  ),
  modifier_group_raw AS (
    SELECT
      r.raw_material_id,
      r.raw_name,
      (r.quantity_per_unit * e.quantity_delta)::numeric AS quantity_per_sale
    FROM selected_unit_effects e
    CROSS JOIN LATERAL public.resolve_inventory_unit_raw_components(
      e.inventory_unit_id,
      p_branch_id
    ) r
  ),
  combined AS (
    SELECT * FROM base_raw
    UNION ALL
    SELECT * FROM modifier_raw
    UNION ALL
    SELECT * FROM modifier_group_raw
  )
  SELECT
    c.raw_material_id,
    max(c.raw_name)::text AS raw_name,
    sum(c.quantity_per_sale)::numeric AS quantity_per_sale
  FROM combined c
  GROUP BY c.raw_material_id
  HAVING sum(c.quantity_per_sale) <> 0
  ORDER BY max(c.raw_name), c.raw_material_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._deduct_kitchen_raw_components(
  p_product_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_modifier_option_ids jsonb,
  p_event_id uuid,
  p_reference_number text,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_res jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_oversold jsonb := '[]'::jsonb;
  v_total_cost numeric(18,6) := 0;
  v_count integer := 0;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_QUANTITY'
    );
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
  FROM public.resolve_kitchen_item_raw_components(
    p_product_id,
    p_branch_id,
    COALESCE(p_modifier_option_ids, '[]'::jsonb)
  ) r
  ON CONFLICT(raw_material_id) DO UPDATE
  SET required_qty = pg_temp.kitchen_raw_need.required_qty + EXCLUDED.required_qty,
      raw_name = EXCLUDED.raw_name;

  SELECT count(*) INTO v_count
  FROM pg_temp.kitchen_raw_need
  WHERE abs(required_qty) > 0.000001;

  IF v_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ORDER_ITEM_CONFIGURATION_INVALID',
      'detail', 'NO_RAW_COMPONENTS'
    );
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

-- Replace only the internal kitchen core. The public wrapper and its
-- action-specific ownership/permission context remain unchanged.
CREATE OR REPLACE FUNCTION public._send_to_kitchen_core_20260914(
  p_order_id uuid,
  p_sent_by uuid DEFAULT NULL
)
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

REVOKE ALL ON FUNCTION public.resolve_inventory_unit_raw_components(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_kitchen_item_raw_components(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._deduct_kitchen_raw_components(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._send_to_kitchen_core_20260914(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_inventory_unit_raw_components(uuid,uuid)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.resolve_kitchen_item_raw_components(uuid,uuid,jsonb)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public._deduct_kitchen_raw_components(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public._send_to_kitchen_core_20260914(uuid,uuid)
  TO service_role, postgres;

DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure)
  INTO v_def;

  IF position('_deduct_kitchen_raw_components' in v_def) = 0 THEN
    RAISE EXCEPTION 'PHASE3_RAW_DEDUCTION_NOT_ACTIVE';
  END IF;
  IF position('_deduct_sale_inventory_with_modifiers_core' in v_def) > 0 THEN
    RAISE EXCEPTION 'LEGACY_SALE_CORE_STILL_IN_KITCHEN_SEND';
  END IF;
  IF position('_ensure_inventory_unit_stock' in v_def) > 0
     OR position('_produce_inventory_unit_internal' in v_def) > 0 THEN
    RAISE EXCEPTION 'AUTO_PRODUCTION_STILL_IN_KITCHEN_SEND';
  END IF;
  IF position('component_snapshot' in v_def) = 0
     OR position('snapshot_version' in v_def) = 0 THEN
    RAISE EXCEPTION 'KITCHEN_COMPONENT_SNAPSHOT_MISSING';
  END IF;
END;
$verify$;
