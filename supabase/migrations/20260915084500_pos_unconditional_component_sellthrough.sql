-- POS sell-through contract:
-- * a sale is not rejected because configured stock is insufficient;
-- * configured raw materials / manufactured units / modifier effects are still consumed;
-- * raw-material shortages may become negative through the existing FIFO debt path;
-- * a product with no recipe/unit mapping is materialized as an auto raw material and deducted;
-- * a selected priced modifier with no positive inventory effect is materialized as an auto raw material and deducted;
-- * reusable modifier groups are resolved through product_modifier_group_products;
-- * payment, printing, KDS idempotency and manual production contracts are unchanged.

CREATE OR REPLACE FUNCTION public._ensure_pos_fallback_product_raw(
  p_product_id uuid,
  p_branch_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text;
  v_raw_id uuid;
  v_recipe_id uuid;
  v_code text := 'AUTO-PROD-' || replace(p_product_id::text,'-','');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-fallback-product:'||p_branch_id::text||':'||p_product_id::text,0));

  SELECT p.name INTO v_name
  FROM public.products p
  WHERE p.id=p_product_id AND p.branch_id=p_branch_id AND p.is_active=true;
  IF v_name IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_IN_BRANCH'; END IF;

  SELECT rm.id INTO v_raw_id
  FROM public.raw_materials rm
  WHERE rm.code=v_code AND rm.branch_id=p_branch_id
  LIMIT 1;

  IF v_raw_id IS NULL THEN
    INSERT INTO public.raw_materials(code,name,category,min_stock,default_cost,description,is_active,branch_id)
    VALUES(v_code,v_name,'POS_AUTO',0,0,'Auto-created from POS sale because the product had no inventory output mapping.',true,p_branch_id)
    RETURNING id INTO v_raw_id;
  END IF;

  SELECT r.id INTO v_recipe_id
  FROM public.recipes r
  WHERE r.product_id=p_product_id AND r.branch_id=p_branch_id
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    INSERT INTO public.recipes(product_id,branch_id,name,yield_quantity,notes,is_active)
    VALUES(p_product_id,p_branch_id,'AUTO POS - '||v_name,1,'AUTO_POS_FALLBACK',true)
    RETURNING id INTO v_recipe_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.recipe_items ri WHERE ri.recipe_id=v_recipe_id) THEN
    INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent,note)
    VALUES(v_recipe_id,v_raw_id,1,0,'AUTO_POS_FALLBACK');
  END IF;

  RETURN v_raw_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._ensure_pos_fallback_product_raw(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_pos_fallback_product_raw(uuid,uuid) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public._ensure_pos_fallback_modifier_raw(
  p_option_id uuid,
  p_branch_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text;
  v_price numeric;
  v_raw_id uuid;
  v_code text := 'AUTO-MOD-' || replace(p_option_id::text,'-','');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-fallback-modifier:'||p_branch_id::text||':'||p_option_id::text,0));

  SELECT o.name,o.price_delta INTO v_name,v_price
  FROM public.product_modifier_options o
  WHERE o.id=p_option_id AND o.branch_id=p_branch_id AND o.is_active=true
  FOR UPDATE;

  IF v_name IS NULL OR COALESCE(v_price,0)<=0 THEN RETURN NULL; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.product_modifier_inventory_effects e
    WHERE e.option_id=p_option_id AND e.branch_id=p_branch_id AND e.quantity_delta>0
  ) THEN
    RETURN NULL;
  END IF;

  SELECT rm.id INTO v_raw_id
  FROM public.raw_materials rm
  WHERE rm.code=v_code AND rm.branch_id=p_branch_id
  LIMIT 1;

  IF v_raw_id IS NULL THEN
    INSERT INTO public.raw_materials(code,name,category,min_stock,default_cost,description,is_active,branch_id)
    VALUES(v_code,v_name,'POS_AUTO_MODIFIER',0,0,'Auto-created from a priced POS modifier with no positive inventory output mapping.',true,p_branch_id)
    RETURNING id INTO v_raw_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.product_modifier_inventory_effects e
    WHERE e.option_id=p_option_id AND e.branch_id=p_branch_id AND e.quantity_delta>0
  ) THEN
    INSERT INTO public.product_modifier_inventory_effects(branch_id,option_id,target_type,raw_material_id,quantity_delta)
    VALUES(p_branch_id,p_option_id,'raw_material',v_raw_id,1);
  END IF;

  RETURN v_raw_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._ensure_pos_fallback_modifier_raw(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_pos_fallback_modifier_raw(uuid,uuid) TO service_role, postgres;

DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_before text;
  v_after text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.oid::regprocedure::text='_deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'SALE_INVENTORY_CORE_NOT_FOUND';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  -- Stock availability remains useful for UI information, but must not be an
  -- authorization gate for the actual POS consumption path. Always resolve the
  -- configured recipe/unit graph instead of preferring finished-product stock.
  v_before := E'    v_res := public.check_product_availability(v_product_id,p_branch_id,p_warehouse_id,v_quantity);\n    IF COALESCE((v_res->>''success'')::boolean,false) IS NOT TRUE AND COALESCE(v_res->>''error'','''') <> ''INSUFFICIENT_RAW_MATERIAL_STOCK'' THEN RETURN v_res; END IF;\n\n    v_base_ready := COALESCE(v_res->>''mode'','''')=''ready_product'';';
  v_after := E'    -- POS is sell-through: availability never blocks configured consumption.\n    v_base_ready := false;';
  IF position(v_before in v_def)=0 THEN
    RAISE EXCEPTION 'SALE_AVAILABILITY_GATE_PATCH_MARKER_MISSING';
  END IF;
  v_def := replace(v_def,v_before,v_after);

  -- Add one local variable used by the auto-materialization fallback.
  v_before := E'  v_base_ready boolean;';
  v_after := E'  v_base_ready boolean;\n  v_auto_raw_id uuid;';
  IF position(v_before in v_def)=0 THEN
    RAISE EXCEPTION 'SALE_DECLARE_PATCH_MARKER_MISSING';
  END IF;
  v_def := replace(v_def,v_before,v_after);

  -- No product may leave POS without a real stock output. When no recipe or
  -- unit mapping exists, create a raw material named after the product, persist
  -- a 1:1 recipe mapping, and deduct it through the same negative FIFO path.
  v_before := E'      IF v_link_count=0 AND v_recipe_component_count=0 THEN\n        INSERT INTO pg_temp.sale_ready_need(product_id,product_name,required_qty) SELECT p.id,p.name,v_quantity FROM public.products p WHERE p.id=v_product_id\n        ON CONFLICT(product_id) DO UPDATE SET required_qty=pg_temp.sale_ready_need.required_qty+EXCLUDED.required_qty;\n      END IF;';
  v_after := E'      IF v_link_count=0 AND v_recipe_component_count=0 THEN\n        v_auto_raw_id := public._ensure_pos_fallback_product_raw(v_product_id,p_branch_id);\n        INSERT INTO pg_temp.sale_raw_need(raw_material_id,raw_name,required_qty)\n        SELECT rm.id,rm.name,v_quantity FROM public.raw_materials rm WHERE rm.id=v_auto_raw_id\n        ON CONFLICT(raw_material_id) DO UPDATE SET required_qty=pg_temp.sale_raw_need.required_qty+EXCLUDED.required_qty;\n      END IF;';
  IF position(v_before in v_def)=0 THEN
    RAISE EXCEPTION 'SALE_READY_FALLBACK_PATCH_MARKER_MISSING';
  END IF;
  v_def := replace(v_def,v_before,v_after);

  -- A priced selected modifier must also have a real inventory output. If it
  -- has no positive configured effect, materialize it as a 1:1 raw material.
  v_before := E'    FOR v_effect IN\n      SELECT e.target_type,e.raw_material_id,e.inventory_unit_id,e.quantity_delta,rm.name AS raw_name,iu.name AS unit_name,iu.unit_type';
  v_after := E'    FOR v_effect IN\n      SELECT o.id AS option_id,o.price_delta\n      FROM public.product_modifier_options o\n      JOIN public.product_modifier_groups g ON g.id=o.group_id AND g.is_active=true\n      JOIN public.product_modifier_group_products gp ON gp.group_id=g.id AND gp.product_id=v_product_id AND gp.branch_id=p_branch_id\n      WHERE o.branch_id=p_branch_id AND o.is_active=true AND o.price_delta>0\n        AND o.id IN (SELECT NULLIF(value,'''')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->''modifier_option_ids'',''[]''::jsonb)))\n    LOOP\n      PERFORM public._ensure_pos_fallback_modifier_raw(v_effect.option_id,p_branch_id);\n    END LOOP;\n\n    FOR v_effect IN\n      SELECT e.target_type,e.raw_material_id,e.inventory_unit_id,e.quantity_delta,rm.name AS raw_name,iu.name AS unit_name,iu.unit_type';
  IF position(v_before in v_def)=0 THEN
    RAISE EXCEPTION 'PRICED_MODIFIER_FALLBACK_PATCH_MARKER_MISSING';
  END IF;
  v_def := replace(v_def,v_before,v_after);

  -- Modifier validation already uses reusable group-to-product links. Deduction
  -- must follow the same canonical relation, otherwise effects from reusable
  -- groups validate but are silently skipped during stock consumption.
  v_before := E'      JOIN public.product_modifier_groups g ON g.id=o.group_id AND g.is_active=true\n      LEFT JOIN public.raw_materials rm ON rm.id=e.raw_material_id\n      LEFT JOIN public.inventory_units iu ON iu.id=e.inventory_unit_id\n      WHERE g.product_id=v_product_id AND g.branch_id=p_branch_id\n        AND o.id IN';
  v_after := E'      JOIN public.product_modifier_groups g ON g.id=o.group_id AND g.is_active=true\n      JOIN public.product_modifier_group_products gp ON gp.group_id=g.id AND gp.product_id=v_product_id AND gp.branch_id=p_branch_id\n      LEFT JOIN public.raw_materials rm ON rm.id=e.raw_material_id\n      LEFT JOIN public.inventory_units iu ON iu.id=e.inventory_unit_id\n      WHERE g.branch_id=p_branch_id AND e.branch_id=p_branch_id\n        AND o.id IN';
  IF position(v_before in v_def)=0 THEN
    RAISE EXCEPTION 'REUSABLE_MODIFIER_EFFECT_PATCH_MARKER_MISSING';
  END IF;
  v_def := replace(v_def,v_before,v_after);

  EXECUTE v_def;
END
$patch$;

-- Contract sentinels: fail the migration rather than silently shipping a partial patch.
DO $verify$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.oid::regprocedure::text='_deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)';

  IF position('check_product_availability(v_product_id,p_branch_id,p_warehouse_id,v_quantity)' in v_def)>0 THEN
    RAISE EXCEPTION 'SALE_STOCK_GATE_STILL_PRESENT';
  END IF;
  IF position('_ensure_pos_fallback_product_raw' in v_def)=0 THEN
    RAISE EXCEPTION 'UNCONFIGURED_PRODUCT_OUTPUT_FALLBACK_MISSING';
  END IF;
  IF position('_ensure_pos_fallback_modifier_raw' in v_def)=0 THEN
    RAISE EXCEPTION 'PRICED_MODIFIER_OUTPUT_FALLBACK_MISSING';
  END IF;
  IF position('JOIN public.product_modifier_group_products gp' in v_def)=0 THEN
    RAISE EXCEPTION 'REUSABLE_MODIFIER_EFFECT_LINK_MISSING';
  END IF;
  IF position('public._raw_remove_fifo' in v_def)=0 OR position('true' in v_def)=0 THEN
    RAISE EXCEPTION 'RAW_NEGATIVE_CONSUMPTION_CONTRACT_MISSING';
  END IF;
END
$verify$;
