-- Regression repair for the POS sell-through core introduced immediately before this migration.
-- Keep stock quantity informational for recipe/raw sell-through, but preserve two pre-existing contracts:
-- 1) ready products consume their finished-product batches (rather than an unrelated legacy recipe),
-- 2) a recipe that points at another branch is a configuration error, never a negative-stock sale.
-- The modifier/KDS/payment/printing paths are intentionally untouched.

DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = '_deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)';

  IF v_oid IS NULL OR v_def IS NULL THEN
    RAISE EXCEPTION 'POS_SALE_INVENTORY_CORE_NOT_FOUND';
  END IF;

  -- Track whether the base product is a ready/finished-stock product.
  v_old := '  v_auto_raw_id uuid;' || chr(10) || 'BEGIN';
  v_new := '  v_auto_raw_id uuid;' || chr(10) || '  v_product_type text;' || chr(10) || '  v_base_ready boolean := false;' || chr(10) || 'BEGIN';
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'POS_PATCH_DECLARATION_MARKER_MISSING'; END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := '    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=v_product_id AND p.branch_id=p_branch_id AND p.is_active=true) THEN' || chr(10) ||
           '      RETURN jsonb_build_object(''success'',false,''error'',''PRODUCT_NOT_IN_BRANCH'',''product_id'',v_product_id);' || chr(10) ||
           '    END IF;' || chr(10) || chr(10) ||
           '    v_mod := public.resolve_product_modifiers';
  v_new := '    SELECT p.product_type INTO v_product_type' || chr(10) ||
           '    FROM public.products p' || chr(10) ||
           '    WHERE p.id=v_product_id AND p.branch_id=p_branch_id AND p.is_active=true;' || chr(10) ||
           '    IF NOT FOUND THEN' || chr(10) ||
           '      RETURN jsonb_build_object(''success'',false,''error'',''PRODUCT_NOT_IN_BRANCH'',''product_id'',v_product_id);' || chr(10) ||
           '    END IF;' || chr(10) ||
           '    v_base_ready := (v_product_type = ''ready'');' || chr(10) || chr(10) ||
           '    v_mod := public.resolve_product_modifiers';
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'POS_PATCH_PRODUCT_MARKER_MISSING'; END IF;
  v_def := replace(v_def, v_old, v_new);

  -- Ready products keep their established finished-stock authority; recipe/unit expansion is only for non-ready items.
  v_old := '    v_link_count:=0; v_recipe_component_count:=0; v_recipe_id:=NULL; v_yield:=NULL;';
  v_new := '    IF v_base_ready THEN' || chr(10) ||
           '      INSERT INTO pg_temp.sale_ready_need(product_id,product_name,required_qty)' || chr(10) ||
           '      SELECT p.id,p.name,v_quantity FROM public.products p WHERE p.id=v_product_id' || chr(10) ||
           '      ON CONFLICT(product_id) DO UPDATE SET required_qty=pg_temp.sale_ready_need.required_qty+EXCLUDED.required_qty;' || chr(10) ||
           '    ELSE' || chr(10) ||
           '    v_link_count:=0; v_recipe_component_count:=0; v_recipe_id:=NULL; v_yield:=NULL;';
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'POS_PATCH_READY_OPEN_MARKER_MISSING'; END IF;
  v_def := replace(v_def, v_old, v_new);

  -- A foreign-branch recipe component is a broken configuration. Never convert it into stock debt.
  v_old := '    IF v_recipe_id IS NOT NULL THEN' || chr(10) ||
           '      FOR v_link IN';
  v_new := '    IF v_recipe_id IS NOT NULL AND EXISTS (' || chr(10) ||
           '      SELECT 1 FROM public.recipe_items ri' || chr(10) ||
           '      JOIN public.raw_materials rm ON rm.id=ri.raw_material_id' || chr(10) ||
           '      WHERE ri.recipe_id=v_recipe_id AND rm.branch_id<>p_branch_id' || chr(10) ||
           '    ) THEN' || chr(10) ||
           '      RETURN jsonb_build_object(''success'',false,''error'',''RAW_MATERIAL_NOT_IN_BRANCH'',''product_id'',v_product_id);' || chr(10) ||
           '    END IF;' || chr(10) || chr(10) ||
           '    IF v_recipe_id IS NOT NULL THEN' || chr(10) ||
           '      FOR v_link IN';
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'POS_PATCH_RECIPE_GUARD_MARKER_MISSING'; END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := '    IF v_link_count=0 AND v_recipe_component_count=0 THEN' || chr(10) ||
           '      v_auto_raw_id:=public._ensure_pos_fallback_product_raw(v_product_id,p_branch_id);' || chr(10) ||
           '      INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)' || chr(10) ||
           '      SELECT rm.id,rm.name,v_quantity FROM public.raw_materials rm WHERE rm.id=v_auto_raw_id' || chr(10) ||
           '      ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;' || chr(10) ||
           '    END IF;' || chr(10) || chr(10) ||
           '    FOR v_effect IN';
  v_new := '    IF v_link_count=0 AND v_recipe_component_count=0 THEN' || chr(10) ||
           '      v_auto_raw_id:=public._ensure_pos_fallback_product_raw(v_product_id,p_branch_id);' || chr(10) ||
           '      INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)' || chr(10) ||
           '      SELECT rm.id,rm.name,v_quantity FROM public.raw_materials rm WHERE rm.id=v_auto_raw_id' || chr(10) ||
           '      ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;' || chr(10) ||
           '    END IF;' || chr(10) ||
           '    END IF;' || chr(10) || chr(10) ||
           '    FOR v_effect IN';
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'POS_PATCH_READY_CLOSE_MARKER_MISSING'; END IF;
  v_def := replace(v_def, v_old, v_new);

  -- Restore finished-product FIFO deduction before unit/raw deduction.
  v_old := '  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type=''manufactured'' ORDER BY unit_id';
  v_new := '  FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty>0 ORDER BY product_id' || chr(10) ||
           '  LOOP' || chr(10) ||
           '    SELECT COALESCE(SUM(quantity),0) INTO v_available' || chr(10) ||
           '    FROM public.inventory_batches' || chr(10) ||
           '    WHERE product_id=v_link.product_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;' || chr(10) ||
           '    IF v_available<v_link.required_qty THEN' || chr(10) ||
           '      RETURN jsonb_build_object(''success'',false,''error'',''INSUFFICIENT_READY_PRODUCT_STOCK'',''product_id'',v_link.product_id,''required'',v_link.required_qty,''available'',v_available);' || chr(10) ||
           '    END IF;' || chr(10) ||
           '    v_need:=v_link.required_qty;' || chr(10) ||
           '    FOR v_batch IN' || chr(10) ||
           '      SELECT id,quantity,unit_cost,batch_number' || chr(10) ||
           '      FROM public.inventory_batches' || chr(10) ||
           '      WHERE product_id=v_link.product_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id AND quantity>0' || chr(10) ||
           '      ORDER BY created_at,id FOR UPDATE' || chr(10) ||
           '    LOOP' || chr(10) ||
           '      EXIT WHEN v_need<=0;' || chr(10) ||
           '      v_take:=LEAST(v_need,v_batch.quantity);' || chr(10) ||
           '      UPDATE public.inventory_batches SET quantity=quantity-v_take WHERE id=v_batch.id;' || chr(10) ||
           '      v_need:=v_need-v_take;' || chr(10) ||
           '      v_total_cost:=v_total_cost+(v_take*COALESCE(v_batch.unit_cost,0));' || chr(10) ||
           '    END LOOP;' || chr(10) ||
           '    v_ready:=v_ready||jsonb_build_object(''product_id'',v_link.product_id,''product_name'',v_link.product_name,''quantity'',v_link.required_qty);' || chr(10) ||
           '  END LOOP;' || chr(10) || chr(10) ||
           '  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type=''manufactured'' ORDER BY unit_id';
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'POS_PATCH_READY_DEDUCT_MARKER_MISSING'; END IF;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;
END
$patch$;

DO $verify$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.oid::regprocedure::text='_deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)';

  IF position('v_base_ready := (v_product_type = ''ready'')' in v_def)=0 THEN RAISE EXCEPTION 'READY_PRODUCT_MODE_RESTORE_MISSING'; END IF;
  IF position('sale_ready_need(product_id,product_name,required_qty)' in v_def)=0 THEN RAISE EXCEPTION 'READY_PRODUCT_DEDUCTION_RESTORE_MISSING'; END IF;
  IF position('RAW_MATERIAL_NOT_IN_BRANCH' in v_def)=0 THEN RAISE EXCEPTION 'CROSS_BRANCH_RECIPE_GUARD_MISSING'; END IF;
  IF position('check_product_availability' in v_def)>0 THEN RAISE EXCEPTION 'STOCK_AUTHORIZATION_GATE_REINTRODUCED'; END IF;
  IF position('product_modifier_group_products' in v_def)=0 THEN RAISE EXCEPTION 'REUSABLE_MODIFIER_LINK_LOST'; END IF;
  IF position('_raw_remove_fifo' in v_def)=0 THEN RAISE EXCEPTION 'RAW_NEGATIVE_DEDUCTION_LOST'; END IF;
END
$verify$;
