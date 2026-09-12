-- Stage B: bridge legacy raw-material helper signatures to explicit warehouses.
-- No branch-wide stock fallback is permitted after this migration.

CREATE OR REPLACE FUNCTION public._raw_add(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_qty numeric,
  p_unit_cost numeric DEFAULT 0,
  p_batch_number text DEFAULT NULL,
  p_production_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_entry_type text DEFAULT 'purchase',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_warehouse_id uuid;
  v_qty numeric := p_qty;
  v_cost numeric := COALESCE(p_unit_cost, 0);
  v_purchase_unit text;
  v_invoice_qty numeric;
  v_invoice_cost numeric;
  v_norm jsonb;
BEGIN
  IF p_reference_type = 'purchase' AND p_reference_id IS NOT NULL THEN
    SELECT p.warehouse_id INTO v_warehouse_id
    FROM public.purchases p WHERE p.id = p_reference_id AND p.branch_id = p_branch_id;

    SELECT pi.unit_name, pi.quantity, pi.unit_cost
      INTO v_purchase_unit, v_invoice_qty, v_invoice_cost
    FROM public.purchase_items pi
    WHERE pi.purchase_id = p_reference_id
      AND pi.raw_material_id = p_raw_material_id
    ORDER BY pi.created_at DESC NULLS LAST, pi.id DESC
    LIMIT 1;

    IF FOUND THEN
      v_norm := public._normalize_raw_purchase_uom(
        p_raw_material_id,
        COALESCE(v_invoice_qty, p_qty),
        COALESCE(v_invoice_cost, p_unit_cost),
        v_purchase_unit
      );
      IF COALESCE((v_norm->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_norm; END IF;
      v_qty := (v_norm->>'stock_quantity')::numeric;
      v_cost := (v_norm->>'stock_unit_cost')::numeric;
    END IF;
  ELSIF p_reference_type = 'purchase_receipt' AND p_reference_id IS NOT NULL THEN
    SELECT pr.warehouse_id INTO v_warehouse_id
    FROM public.purchase_receipts pr WHERE pr.id = p_reference_id AND pr.branch_id = p_branch_id;
  ELSIF p_reference_type = 'warehouse_transfer' AND p_reference_id IS NOT NULL THEN
    SELECT wt.to_warehouse_id INTO v_warehouse_id
    FROM public.warehouse_transfers wt
    WHERE wt.id = p_reference_id AND COALESCE(wt.to_branch_id, wt.branch_id) = p_branch_id;
  ELSIF p_reference_type = 'sale' AND p_reference_id IS NOT NULL THEN
    SELECT s.warehouse_id INTO v_warehouse_id
    FROM public.sales s WHERE s.id = p_reference_id AND s.branch_id = p_branch_id;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED');
  END IF;

  RETURN public._raw_add(
    p_raw_material_id, p_branch_id, v_warehouse_id, v_qty, v_cost,
    p_batch_number, p_production_date, p_expiry_date,
    p_entry_type, p_reference_type, p_reference_id, p_reference_number, p_created_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_qty numeric,
  p_entry_type text DEFAULT 'production',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_warehouse_id uuid;
BEGIN
  IF p_reference_type = 'warehouse_transfer' AND p_reference_id IS NOT NULL THEN
    SELECT wt.from_warehouse_id INTO v_warehouse_id
    FROM public.warehouse_transfers wt
    WHERE wt.id = p_reference_id AND wt.branch_id = p_branch_id;
  ELSIF p_reference_type = 'sale' AND p_reference_id IS NOT NULL THEN
    SELECT s.warehouse_id INTO v_warehouse_id
    FROM public.sales s WHERE s.id = p_reference_id AND s.branch_id = p_branch_id;
  ELSIF p_reference_type = 'production' AND p_reference_id IS NOT NULL THEN
    SELECT iup.warehouse_id INTO v_warehouse_id
    FROM public.inventory_unit_productions iup
    WHERE iup.id = p_reference_id AND iup.branch_id = p_branch_id;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED', 'shortage', p_qty);
  END IF;

  RETURN public._raw_remove_fifo(
    p_raw_material_id, p_branch_id, v_warehouse_id, p_qty,
    p_entry_type, p_reference_type, p_reference_id, p_reference_number, p_created_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_raw_material_inventory(
  p_raw_material_id uuid,
  p_quantity numeric,
  p_branch_id uuid,
  p_warehouse_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED', 'shortage', p_quantity);
  END IF;
  RETURN public._raw_remove_fifo(
    p_raw_material_id, p_branch_id, p_warehouse_id, p_quantity,
    'production', 'production', NULL, NULL, auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public._raw_add(uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raw_remove_fifo(uuid,uuid,numeric,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_add(uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public._raw_remove_fifo(uuid,uuid,numeric,text,text,uuid,text,uuid) TO service_role, postgres;
REVOKE ALL ON FUNCTION public.deduct_raw_material_inventory(uuid,numeric,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_raw_material_inventory(uuid,numeric,uuid,uuid) TO service_role, postgres;

DO $patch$
DECLARE v_oid oid; v_def text; v_patched text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='produce_inventory_unit'
    AND pg_get_function_identity_arguments(p.oid)='p_unit_id uuid, p_quantity numeric, p_warehouse_id uuid, p_branch_id uuid, p_notes text';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'produce_inventory_unit target not found'; END IF;
  v_def := pg_get_functiondef(v_oid);
  v_patched := regexp_replace(
    v_def,
    'public\._raw_remove_fifo\([[:space:]]*v_recipe\.raw_material_id,[[:space:]]*p_branch_id,[[:space:]]*v_rm_qty,',
    'public._raw_remove_fifo(v_recipe.raw_material_id, p_branch_id, p_warehouse_id, v_rm_qty,',
    'i'
  );
  IF v_patched = v_def THEN RAISE EXCEPTION 'produce_inventory_unit raw helper marker not found'; END IF;
  EXECUTE v_patched;
END $patch$;
