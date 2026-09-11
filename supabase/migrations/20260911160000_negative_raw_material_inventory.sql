-- Negative raw-material inventory.
--
-- Sales may now fully consume raw stock and run the branch/warehouse balance
-- negative. The uncovered quantity is not silently clamped: it is posted as a
-- negative "oversold" debt batch that future purchases offset through plain
-- SUM netting (current + delta) with no GREATEST clamp.
--
-- Scope of this policy (deliberately narrow):
--   - raw_material_inventory / raw_material_batches may go negative.
--   - The sale/kitchen deduction path is the only remover that enables it.
--   - finished-goods batches, manufactured-unit production and transfers stay
--     strict (their callers keep the default allow_negative=false).
--
-- This migration also fixes the Stage B wiring of the sale/kitchen path: the
-- deduction core now passes its explicitly-resolved warehouse into the
-- canonical FIFO helper instead of the legacy 8-arg bridge, and the kitchen
-- void restore passes the event warehouse into the canonical _raw_add.

-- ---------------------------------------------------------------------
-- 1. Relax the raw-material quantity CHECK constraints.
-- finished goods (inventory_batches) and units remain strictly non-negative.
-- ---------------------------------------------------------------------
ALTER TABLE public.raw_material_inventory
  DROP CONSTRAINT IF EXISTS raw_material_inventory_quantity_check;
ALTER TABLE public.raw_material_batches
  DROP CONSTRAINT IF EXISTS raw_material_batches_quantity_check;

-- ---------------------------------------------------------------------
-- 2. Canonical FIFO remover: optional negative allow-list.
-- Existing 9-arg callers keep the strict default (allow_negative=false).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid);
CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_qty numeric,
  p_entry_type text DEFAULT 'production',p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,p_reference_number text DEFAULT NULL,p_created_by uuid DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
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
END $$;

REVOKE ALL ON FUNCTION public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean) TO service_role,postgres;

-- ---------------------------------------------------------------------
-- 3. Sale/kitchen deduction core: raw shortage is now permitted.
-- Unit, finished-product and configuration gates stay authoritative.
-- The raw FIFO is called with the resolved warehouse + allow_negative=true.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._deduct_sale_inventory_with_modifiers_core(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_reference_number text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_link record;
  v_effect record;
  v_batch record;
  v_need numeric(14,6);
  v_take numeric(14,6);
  v_available numeric(14,6);
  v_total_cost numeric(18,4) := 0;
  v_units jsonb := '[]'::jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_oversold jsonb := '[]'::jsonb;
  v_user_branch uuid;
  v_recipe_id uuid;
  v_yield numeric(14,6);
  v_res jsonb;
  v_mod jsonb;
  v_recipe_component_count integer;
  v_link_count integer;
  v_base_ready boolean;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'units_deducted', '[]'::jsonb,
      'raw_materials_deducted', '[]'::jsonb,
      'ready_products_deducted', '[]'::jsonb,
      'raw_oversold', '[]'::jsonb,
      'errors', '[]'::jsonb
    );
  END IF;

  SELECT branch_id INTO v_user_branch
  FROM public.users
  WHERE id = auth.uid();

  IF NOT public.is_pos_admin()
     AND v_user_branch IS NOT NULL
     AND v_user_branch <> p_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_unit_need(
    unit_id uuid PRIMARY KEY,
    unit_name text,
    unit_type text,
    required_qty numeric(14,6) NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_raw_need(
    raw_material_id uuid PRIMARY KEY,
    raw_name text,
    required_qty numeric(14,6) NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_ready_need(
    product_id uuid PRIMARY KEY,
    product_name text,
    required_qty numeric(14,6) NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE pg_temp.sale_unit_need;
  TRUNCATE pg_temp.sale_raw_need;
  TRUNCATE pg_temp.sale_ready_need;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);

    IF v_quantity <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_product_id
        AND p.branch_id = p_branch_id
        AND p.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
    END IF;

    v_mod := public.resolve_product_modifiers(
      v_product_id,
      p_branch_id,
      COALESCE(v_item->'modifier_option_ids', '[]'::jsonb)
    );
    IF COALESCE((v_mod->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_mod;
    END IF;

    -- Use the same authoritative base-stock decision as POS availability, but
    -- treat a raw-material shortage as sellable into the negative-inventory
    -- policy. Unit / finished-product / configuration gates still return here.
    v_res := public.check_product_availability(
      v_product_id,
      p_branch_id,
      p_warehouse_id,
      v_quantity
    );
    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE
       AND COALESCE(v_res->>'error', '') <> 'INSUFFICIENT_RAW_MATERIAL_STOCK' THEN
      RETURN v_res;
    END IF;

    v_base_ready := COALESCE(v_res->>'mode', '') = 'ready_product';
    v_link_count := 0;
    v_recipe_component_count := 0;

    IF v_base_ready THEN
      INSERT INTO pg_temp.sale_ready_need(product_id, product_name, required_qty)
      SELECT p.id, p.name, v_quantity
      FROM public.products p
      WHERE p.id = v_product_id
      ON CONFLICT(product_id) DO UPDATE
      SET required_qty = pg_temp.sale_ready_need.required_qty + EXCLUDED.required_qty;
    ELSE
      SELECT COUNT(*) INTO v_link_count
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu ON iu.id = pul.unit_id
      WHERE pul.product_id = v_product_id
        AND iu.branch_id = p_branch_id
        AND iu.is_active = true;

      FOR v_link IN
        SELECT pul.unit_id, pul.quantity, iu.name AS unit_name, iu.unit_type
        FROM public.product_unit_links pul
        JOIN public.inventory_units iu ON iu.id = pul.unit_id
        WHERE pul.product_id = v_product_id
          AND iu.branch_id = p_branch_id
          AND iu.is_active = true
      LOOP
        INSERT INTO pg_temp.sale_unit_need(unit_id, unit_name, unit_type, required_qty)
        VALUES(v_link.unit_id, v_link.unit_name, v_link.unit_type, v_quantity * v_link.quantity)
        ON CONFLICT(unit_id) DO UPDATE
        SET required_qty = pg_temp.sale_unit_need.required_qty + EXCLUDED.required_qty;
      END LOOP;

      SELECT r.id, COALESCE(NULLIF(r.yield_quantity, 0), 1)
      INTO v_recipe_id, v_yield
      FROM public.recipes r
      WHERE r.product_id = v_product_id
        AND r.branch_id = p_branch_id
        AND COALESCE(r.is_active, true) = true
      ORDER BY COALESCE(r.version, 1) DESC, r.created_at DESC
      LIMIT 1;

      IF v_recipe_id IS NOT NULL THEN
        FOR v_link IN
          SELECT ri.raw_material_id,
                 rm.name AS raw_name,
                 ri.quantity / v_yield AS quantity_per_sale
          FROM public.recipe_items ri
          JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
          WHERE ri.recipe_id = v_recipe_id
            AND NOT EXISTS (
              SELECT 1
              FROM public.product_unit_links pul
              JOIN public.inventory_units iu ON iu.id = pul.unit_id
              WHERE pul.product_id = v_product_id
                AND iu.branch_id = p_branch_id
                AND iu.is_active = true
                AND regexp_replace(lower(btrim(iu.name)), '[ .]+$', '', 'g') =
                    regexp_replace(lower(btrim(rm.name)), '[ .]+$', '', 'g')
            )
        LOOP
          v_recipe_component_count := v_recipe_component_count + 1;
          INSERT INTO pg_temp.sale_raw_need(raw_material_id, raw_name, required_qty)
          VALUES(v_link.raw_material_id, v_link.raw_name, v_quantity * v_link.quantity_per_sale)
          ON CONFLICT(raw_material_id) DO UPDATE
          SET required_qty = pg_temp.sale_raw_need.required_qty + EXCLUDED.required_qty;
        END LOOP;
      END IF;

      IF v_link_count = 0 AND v_recipe_component_count = 0 THEN
        INSERT INTO pg_temp.sale_ready_need(product_id, product_name, required_qty)
        SELECT p.id, p.name, v_quantity
        FROM public.products p
        WHERE p.id = v_product_id
        ON CONFLICT(product_id) DO UPDATE
        SET required_qty = pg_temp.sale_ready_need.required_qty + EXCLUDED.required_qty;
      END IF;
    END IF;

    -- Selected modifier effects remain independent from the base-stock source.
    FOR v_effect IN
      SELECT e.target_type,
             e.raw_material_id,
             e.inventory_unit_id,
             e.quantity_delta,
             rm.name AS raw_name,
             iu.name AS unit_name,
             iu.unit_type
      FROM public.product_modifier_inventory_effects e
      JOIN public.product_modifier_options o ON o.id = e.option_id AND o.is_active = true
      JOIN public.product_modifier_groups g ON g.id = o.group_id AND g.is_active = true
      LEFT JOIN public.raw_materials rm ON rm.id = e.raw_material_id
      LEFT JOIN public.inventory_units iu ON iu.id = e.inventory_unit_id
      WHERE g.product_id = v_product_id
        AND g.branch_id = p_branch_id
        AND o.id IN (
          SELECT NULLIF(value, '')::uuid
          FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))
        )
    LOOP
      IF v_effect.target_type = 'raw_material' THEN
        INSERT INTO pg_temp.sale_raw_need(raw_material_id, raw_name, required_qty)
        VALUES(v_effect.raw_material_id, v_effect.raw_name, v_quantity * v_effect.quantity_delta)
        ON CONFLICT(raw_material_id) DO UPDATE
        SET required_qty = pg_temp.sale_raw_need.required_qty + EXCLUDED.required_qty;
      ELSE
        INSERT INTO pg_temp.sale_unit_need(unit_id, unit_name, unit_type, required_qty)
        VALUES(v_effect.inventory_unit_id, v_effect.unit_name, v_effect.unit_type, v_quantity * v_effect.quantity_delta)
        ON CONFLICT(unit_id) DO UPDATE
        SET required_qty = pg_temp.sale_unit_need.required_qty + EXCLUDED.required_qty;
      END IF;
    END LOOP;

    v_recipe_id := NULL;
    v_yield := NULL;
  END LOOP;

  IF EXISTS(SELECT 1 FROM pg_temp.sale_unit_need WHERE required_qty < 0)
     OR EXISTS(SELECT 1 FROM pg_temp.sale_raw_need WHERE required_qty < 0) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_MODIFIER_INVENTORY_EFFECT',
      'detail', 'Modifier removal exceeds the base component quantity.'
    );
  END IF;

  FOR v_link IN
    SELECT * FROM pg_temp.sale_unit_need
    WHERE required_qty > 0 AND unit_type = 'manufactured'
    ORDER BY unit_id
  LOOP
    PERFORM public._ensure_inventory_unit_stock(
      v_link.unit_id,
      v_link.required_qty,
      p_warehouse_id,
      p_branch_id,
      0
    );
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty > 0 ORDER BY unit_id
  LOOP
    SELECT COALESCE(SUM(quantity), 0) INTO v_available
    FROM public.inventory_unit_batches
    WHERE unit_id = v_link.unit_id
      AND branch_id = p_branch_id
      AND warehouse_id = p_warehouse_id;
    IF v_available < v_link.required_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_UNIT_STOCK unit=% required=% available=%',
        v_link.unit_id, v_link.required_qty, v_available;
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty > 0 ORDER BY product_id
  LOOP
    SELECT COALESCE(SUM(quantity), 0) INTO v_available
    FROM public.inventory_batches
    WHERE product_id = v_link.product_id
      AND branch_id = p_branch_id
      AND warehouse_id = p_warehouse_id;
    IF v_available < v_link.required_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_PRODUCT_STOCK product=% required=% available=%',
        v_link.product_id, v_link.required_qty, v_available;
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty > 0 ORDER BY unit_id
  LOOP
    v_need := v_link.required_qty;
    FOR v_batch IN
      SELECT id, quantity, unit_cost, batch_number
      FROM public.inventory_unit_batches
      WHERE unit_id = v_link.unit_id
        AND branch_id = p_branch_id
        AND warehouse_id = p_warehouse_id
        AND quantity > 0
      ORDER BY created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.quantity);
      UPDATE public.inventory_unit_batches
      SET quantity = quantity - v_take
      WHERE id = v_batch.id;
      INSERT INTO public.inventory_unit_entries(
        unit_id, branch_id, warehouse_id, quantity, unit_cost,
        entry_type, reference_type, reference_id, reference_number,
        batch_number, created_by
      ) VALUES(
        v_link.unit_id, p_branch_id, p_warehouse_id, -v_take, v_batch.unit_cost,
        'sale', 'sale', p_reference_id, p_reference_number,
        v_batch.batch_number, auth.uid()
      );
      v_need := v_need - v_take;
      v_total_cost := v_total_cost + (v_take * COALESCE(v_batch.unit_cost, 0));
    END LOOP;
    v_units := v_units || jsonb_build_object(
      'unit_id', v_link.unit_id,
      'unit_name', v_link.unit_name,
      'unit_type', v_link.unit_type,
      'quantity', v_link.required_qty
    );
  END LOOP;

  -- Raw appetite is deducted with its resolved warehouse and is allowed to run
  -- negative: the FIFO helper posts an oversold debt batch for the shortfall.
  FOR v_link IN SELECT * FROM pg_temp.sale_raw_need WHERE required_qty > 0 ORDER BY raw_material_id
  LOOP
    v_res := public._raw_remove_fifo(
      v_link.raw_material_id,
      p_branch_id,
      p_warehouse_id,
      v_link.required_qty,
      'sale', 'sale', p_reference_id, p_reference_number, auth.uid(),
      true
    );
    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_res;
    END IF;
    v_total_cost := v_total_cost + COALESCE((v_res->>'total_cost')::numeric, 0);
    v_raws := v_raws || jsonb_build_object(
      'raw_material_id', v_link.raw_material_id,
      'raw_name', v_link.raw_name,
      'quantity', v_link.required_qty,
      'total_cost', COALESCE((v_res->>'total_cost')::numeric, 0)
    );
    IF COALESCE((v_res->>'oversold')::numeric, 0) > 0 THEN
      v_oversold := v_oversold || jsonb_build_object(
        'raw_material_id', v_link.raw_material_id,
        'raw_name', v_link.raw_name,
        'quantity', COALESCE((v_res->>'oversold')::numeric, 0),
        'total_cost', 0
      );
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty > 0 ORDER BY product_id
  LOOP
    v_res := public._product_inv_remove_fifo(
      v_link.product_id,
      p_warehouse_id,
      p_branch_id,
      v_link.required_qty,
      'sale', 'sale', p_reference_id, p_reference_number, auth.uid()
    );
    IF COALESCE((v_res->>'shortage')::numeric, 0) > 0 THEN
      RAISE EXCEPTION 'PRODUCT_STOCK_CHANGED_DURING_SALE product=% shortage=%',
        v_link.product_id, v_res->>'shortage';
    END IF;
    v_total_cost := v_total_cost + COALESCE((v_res->>'total_cost')::numeric, 0);
    v_ready := v_ready || jsonb_build_object(
      'product_id', v_link.product_id,
      'product_name', v_link.product_name,
      'quantity', v_link.required_qty,
      'total_cost', COALESCE((v_res->>'total_cost')::numeric, 0)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'units_deducted', v_units,
    'raw_materials_deducted', v_raws,
    'ready_products_deducted', v_ready,
    'raw_oversold', v_oversold,
    'total_cost', v_total_cost,
    'errors', '[]'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'SALE_INVENTORY_DEDUCTION_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)
  TO service_role, postgres;

-- ---------------------------------------------------------------------
-- 4. Kitchen void restore: use the event's explicit warehouse (Stage B
-- regression: the legacy _raw_add bridge cannot resolve 'kitchen_send').
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._restore_kitchen_inventory_for_void(
  p_order_id uuid,
  p_order_item_id uuid,
  p_quantity numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_remaining numeric(14,6) := p_quantity;
  v_event record;
  v_effect record;
  v_take numeric(14,6);
  v_restore numeric(14,6);
  v_cost numeric(18,6);
  v_batch text;
  v_res jsonb;
  v_restored numeric(14,6) := 0;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_QUANTITY');
  END IF;

  FOR v_event IN
    SELECT * FROM public.order_kitchen_inventory_events
    WHERE order_id=p_order_id AND order_item_id=p_order_item_id
      AND sent_quantity>voided_quantity AND settled_sale_id IS NULL
    ORDER BY created_at DESC,id DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_take:=LEAST(v_remaining,v_event.sent_quantity-v_event.voided_quantity);

    FOR v_effect IN
      SELECT * FROM public.order_kitchen_inventory_effects
      WHERE event_id=v_event.id ORDER BY target_type,target_id
    LOOP
      v_restore:=round(v_effect.quantity*v_take/v_event.sent_quantity,6);
      IF v_restore<=0 THEN CONTINUE; END IF;
      v_cost:=CASE WHEN v_effect.quantity>0 THEN v_effect.total_cost/v_effect.quantity ELSE 0 END;
      v_batch:='KV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

      IF v_effect.target_type='inventory_unit' THEN
        INSERT INTO public.inventory_unit_batches(
          unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date
        ) VALUES (
          v_effect.target_id,v_event.branch_id,v_event.warehouse_id,v_batch,v_restore,v_cost,CURRENT_DATE
        );
        INSERT INTO public.inventory_unit_entries(
          unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,
          reference_type,reference_id,reference_number,batch_number,created_by
        ) VALUES (
          v_effect.target_id,v_event.branch_id,v_event.warehouse_id,v_restore,v_cost,'kitchen_void',
          'kitchen_send',v_event.id,p_order_id::text,v_batch,auth.uid()
        );
      ELSIF v_effect.target_type='raw_material' THEN
        v_res:=public._raw_add(
          v_effect.target_id,v_event.branch_id,v_event.warehouse_id,v_restore,v_cost,v_batch,CURRENT_DATE,NULL,
          'kitchen_void','kitchen_send',v_event.id,p_order_id::text,auth.uid()
        );
        IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
          RAISE EXCEPTION 'KITCHEN_VOID_RAW_RESTORE_FAILED: %',v_res;
        END IF;
      ELSE
        v_res:=public._product_inv_add(
          v_effect.target_id,v_event.warehouse_id,v_event.branch_id,v_restore,v_cost,v_batch,
          CURRENT_DATE,NULL,'kitchen_void','kitchen_send',v_event.id,p_order_id::text,auth.uid()
        );
        IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
          RAISE EXCEPTION 'KITCHEN_VOID_PRODUCT_RESTORE_FAILED: %',v_res;
        END IF;
      END IF;
    END LOOP;

    UPDATE public.order_kitchen_inventory_events
    SET voided_quantity=voided_quantity+v_take WHERE id=v_event.id;
    v_remaining:=v_remaining-v_take;
    v_restored:=v_restored+v_take;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'inventory_changed',v_restored>0,
    'restored_sent_quantity',v_restored,
    'legacy_untracked_quantity',GREATEST(v_remaining,0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._restore_kitchen_inventory_for_void(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._restore_kitchen_inventory_for_void(uuid,uuid,numeric) TO service_role,postgres;

-- ---------------------------------------------------------------------
-- 5. POS availability: expose the raw-only shortage signal so the POS can
-- permit adding a recipe product whose raw stock is zero/negative (the sale
-- is settled against the negative-inventory policy) while every other known
-- shortage state still blocks. Products whose availability depends on a
-- manufactured unit stay strict (their production cannot run negative).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_pos_product_availability(uuid, uuid, integer);
CREATE OR REPLACE FUNCTION public.get_pos_product_availability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_cap integer DEFAULT 100000
) RETURNS TABLE(product_id uuid, available_quantity numeric, is_available boolean, raw_shortage_only boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_product record;
  v_low integer;
  v_high integer;
  v_mid integer;
  v_check jsonb;
  v_high_ok boolean;
  v_error text;
  v_source_unknown boolean;
  v_has_manufactured_unit boolean;
BEGIN
  IF p_cap IS NULL OR p_cap < 1 THEN
    p_cap := 1;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_IN_BRANCH'
      USING ERRCODE = '22023';
  END IF;

  FOR v_product IN
    SELECT p.id
    FROM public.products p
    WHERE p.branch_id = p_branch_id
      AND p.is_active = true
    ORDER BY p.id
  LOOP
    v_low := 0;
    v_high := 1;
    v_high_ok := false;
    v_source_unknown := false;
    v_error := NULL;
    v_has_manufactured_unit := false;

    SELECT EXISTS(
      SELECT 1
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu ON iu.id = pul.unit_id
      WHERE pul.product_id = v_product.id
        AND iu.branch_id = p_branch_id
        AND iu.unit_type = 'manufactured'
        AND iu.is_active = true
    ) INTO v_has_manufactured_unit;

    LOOP
      v_check := public.check_product_availability(
        v_product.id,
        p_branch_id,
        p_warehouse_id,
        v_high
      );
      v_high_ok := COALESCE((v_check->>'success')::boolean, false);

      IF NOT v_high_ok THEN
        v_error := COALESCE(v_check->>'error', 'UNKNOWN_AVAILABILITY_SOURCE');
        v_source_unknown := v_error NOT IN (
          'INSUFFICIENT_PRODUCT_STOCK',
          'INSUFFICIENT_UNIT_STOCK',
          'INSUFFICIENT_RAW_MATERIAL_STOCK'
        );
        EXIT;
      END IF;

      v_low := v_high;
      EXIT WHEN v_high >= p_cap;
      v_high := LEAST(v_high * 2, p_cap);
    END LOOP;

    -- No authoritative quantity is known. Omit the row so callers can keep
    -- the product in an explicit unknown/non-blocking availability state.
    IF v_source_unknown AND v_low = 0 THEN
      CONTINUE;
    END IF;

    IF v_low < p_cap AND NOT v_high_ok THEN
      WHILE v_high - v_low > 1 LOOP
        v_mid := (v_low + v_high) / 2;
        v_check := public.check_product_availability(
          v_product.id,
          p_branch_id,
          p_warehouse_id,
          v_mid
        );

        IF COALESCE((v_check->>'success')::boolean, false) THEN
          v_low := v_mid;
        ELSE
          v_error := COALESCE(v_check->>'error', 'UNKNOWN_AVAILABILITY_SOURCE');
          IF v_error NOT IN (
            'INSUFFICIENT_PRODUCT_STOCK',
            'INSUFFICIENT_UNIT_STOCK',
            'INSUFFICIENT_RAW_MATERIAL_STOCK'
          ) THEN
            v_source_unknown := true;
          END IF;
          v_high := v_mid;
        END IF;
      END LOOP;
    END IF;

    IF v_source_unknown AND v_low = 0 THEN
      CONTINUE;
    END IF;

    product_id := v_product.id;
    available_quantity := v_low;
    is_available := v_low > 0;
    raw_shortage_only := (NOT v_high_ok)
      AND COALESCE(v_error, '') = 'INSUFFICIENT_RAW_MATERIAL_STOCK'
      AND NOT v_has_manufactured_unit;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean) IS
  'Canonical FIFO raw remover. allow_negative=true posts the uncovered quantity as an oversold debt batch (negative row), keeping the branch/warehouse balance netted by SUM against future purchases.';
COMMENT ON FUNCTION public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text) IS
  'Sale/kitchen inventory core. Raw-material shortage is permitted (negative-inventory policy); unit and finished-product shortage still fail the sale.';