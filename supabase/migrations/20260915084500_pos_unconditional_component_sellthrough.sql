-- POS sell-through contract:
-- * a sale is not rejected because configured stock is insufficient;
-- * configured raw materials / manufactured units / modifier effects are still consumed;
-- * raw-material shortages may become negative through the existing FIFO debt path;
-- * reusable modifier groups are resolved through product_modifier_group_products;
-- * payment, printing, KDS idempotency and manual production contracts are unchanged.

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

  -- An unconfigured product remains sellable. Do not invent a ready-stock
  -- dependency merely because it has no component links.
  v_before := E'      IF v_link_count=0 AND v_recipe_component_count=0 THEN\n        INSERT INTO pg_temp.sale_ready_need(product_id,product_name,required_qty) SELECT p.id,p.name,v_quantity FROM public.products p WHERE p.id=v_product_id\n        ON CONFLICT(product_id) DO UPDATE SET required_qty=pg_temp.sale_ready_need.required_qty+EXCLUDED.required_qty;\n      END IF;';
  IF position(v_before in v_def)=0 THEN
    RAISE EXCEPTION 'SALE_READY_FALLBACK_PATCH_MARKER_MISSING';
  END IF;
  v_def := replace(v_def,v_before,E'      -- No configured component source: sell without a stock gate.');

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
  IF position('JOIN public.product_modifier_group_products gp' in v_def)=0 THEN
    RAISE EXCEPTION 'REUSABLE_MODIFIER_EFFECT_LINK_MISSING';
  END IF;
  IF position('public._raw_remove_fifo' in v_def)=0 OR position('true' in v_def)=0 THEN
    RAISE EXCEPTION 'RAW_NEGATIVE_CONSUMPTION_CONTRACT_MISSING';
  END IF;
END
$verify$;
