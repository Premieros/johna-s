-- POS cart availability must honor the negative raw-material sell-through policy.
-- Raw-material shortage is informational/sell-through only; all other
-- availability/configuration failures remain authoritative blockers.
-- No cross-warehouse fallback is used here.

CREATE OR REPLACE FUNCTION public.check_pos_cart_availability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_check jsonb;
  v_error text;
BEGIN
  -- Keep the existing strict aggregate contract as the first authority.
  v_result := public.check_pos_cart_availability_strict_20260912(
    p_branch_id,
    p_warehouse_id,
    p_items
  );

  -- Only raw-material shortage may be converted to sell-through success.
  IF COALESCE(v_result->>'error', '') <> 'INSUFFICIENT_RAW_MATERIAL_STOCK' THEN
    RETURN v_result;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN v_result;
  END IF;

  -- Re-check every requested product. The whole cart is sellable only when
  -- each failed item fails exclusively because of raw-material stock.
  -- Unit stock, ready-product stock, branch/warehouse mismatch, malformed
  -- recipes, and configuration errors stay blocking.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM');
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
    END IF;

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
    'mode', 'cart_raw_shortage_sellthrough',
    'raw_shortage_only', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.check_pos_cart_availability(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_pos_cart_availability(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_pos_cart_availability(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_pos_cart_availability(uuid, uuid, jsonb) TO service_role;
