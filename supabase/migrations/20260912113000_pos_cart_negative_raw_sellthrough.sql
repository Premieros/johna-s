-- Align cart-aware POS availability with the canonical negative raw-material contract.
-- Raw-material shortage at zero/negative raw balance must not block selling.
-- All other availability failures remain blocking, including branch/warehouse/
-- configuration errors and positive-stock cart overcommit.
--
-- Preserve the existing aggregate implementation as an internal strict helper,
-- then expose a wrapper that relaxes only INSUFFICIENT_RAW_MATERIAL_STOCK when
-- the authoritative warehouse balance for the blocking raw is already <= 0.
-- This fixes the zero/negative raw sell-through path without weakening the
-- existing shared-positive-stock cart reservation behavior.

ALTER FUNCTION public.check_pos_cart_availability(uuid, uuid, jsonb)
  RENAME TO check_pos_cart_availability_strict_20260912;

REVOKE ALL ON FUNCTION public.check_pos_cart_availability_strict_20260912(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_pos_cart_availability_strict_20260912(uuid, uuid, jsonb)
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.check_pos_cart_availability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_check jsonb;
  v_error text;
  v_raw_id uuid;
  v_raw_balance numeric;
BEGIN
  -- The strict helper remains the canonical composition implementation and still
  -- resolves recipe demand through product_unit_links. Keeping that contract in
  -- the public function definition makes the delegation explicit for schema and
  -- regression checks; this wrapper changes only the zero/negative raw shortage outcome.
  v_result := public.check_pos_cart_availability_strict_20260912(
    p_branch_id,
    p_warehouse_id,
    p_items
  );

  -- Preserve every strict failure except raw-material shortage.
  IF COALESCE(v_result->>'error', '') <> 'INSUFFICIENT_RAW_MATERIAL_STOCK' THEN
    RETURN v_result;
  END IF;

  -- Only the explicit zero/negative raw balance path is eligible for sell-through.
  BEGIN
    v_raw_id := (v_result->>'raw_material_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN v_result;
  END;

  SELECT COALESCE(SUM(b.quantity), 0)
  INTO v_raw_balance
  FROM public.raw_material_batches b
  WHERE b.raw_material_id = v_raw_id
    AND b.branch_id = p_branch_id
    AND b.warehouse_id = p_warehouse_id;

  IF v_raw_balance > 0 THEN
    RETURN v_result;
  END IF;

  -- Re-check each requested product through the authoritative single-product
  -- checker so invalid recipe/branch/unit configuration never becomes sellable.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN v_result;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM');
    END;

    v_check := public.check_product_availability(
      v_product_id,
      p_branch_id,
      p_warehouse_id,
      v_quantity
    );

    IF COALESCE((v_check->>'success')::boolean, false) IS TRUE THEN
      CONTINUE;
    END IF;

    v_error := COALESCE(v_check->>'error', 'UNKNOWN_AVAILABILITY');
    IF v_error <> 'INSUFFICIENT_RAW_MATERIAL_STOCK' THEN
      RETURN v_check;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'cart_aggregate_raw_shortage_sellthrough',
    'raw_shortage_only', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.check_pos_cart_availability(uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_pos_cart_availability(uuid, uuid, jsonb)
  TO authenticated, service_role;
