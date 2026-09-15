-- Scope finished-product stock authority to products that actually have a finished-stock row
-- in the active branch/warehouse. `product_type = ready` alone is not inventory authority:
-- many POS products are classified as ready while their configured recipe/raw graph remains
-- the real inventory output. This keeps configured recipe/components authoritative and avoids
-- false INSUFFICIENT_READY_PRODUCT_STOCK failures for products that have no finished stock.
-- Printing, payment, KDS idempotency and pricing remain untouched.

DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := 'v_base_ready := (v_product_type = ''ready'');';
  v_new text := 'v_base_ready := (v_product_type = ''ready'' AND EXISTS (SELECT 1 FROM public.inventory_batches ib WHERE ib.product_id=v_product_id AND ib.branch_id=p_branch_id AND ib.warehouse_id=p_warehouse_id));';
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

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'READY_STOCK_AUTHORITY_MARKER_MISSING';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$patch$;

DO $verify$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.oid::regprocedure::text='_deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)';

  IF position('v_product_type = ''ready'' AND EXISTS (SELECT 1 FROM public.inventory_batches ib' in v_def)=0 THEN
    RAISE EXCEPTION 'READY_STOCK_AUTHORITY_SCOPE_MISSING';
  END IF;
  IF position('RAW_MATERIAL_NOT_IN_BRANCH' in v_def)=0 THEN
    RAISE EXCEPTION 'CROSS_BRANCH_RECIPE_GUARD_LOST';
  END IF;
  IF position('check_product_availability' in v_def)>0 THEN
    RAISE EXCEPTION 'STOCK_AUTHORIZATION_GATE_REINTRODUCED';
  END IF;
  IF position('_raw_remove_fifo' in v_def)=0 THEN
    RAISE EXCEPTION 'RAW_NEGATIVE_DEDUCTION_LOST';
  END IF;
END
$verify$;
