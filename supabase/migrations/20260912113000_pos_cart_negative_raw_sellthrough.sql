-- Align cart-aware POS availability with the canonical negative raw-material contract.
-- Raw-material shortage alone must not block selling. All other availability
-- failures remain blocking, including branch/warehouse/configuration errors.
--
-- Preserve the existing aggregate implementation as an internal strict helper,
-- then expose a wrapper that relaxes only INSUFFICIENT_RAW_MATERIAL_STOCK after
-- re-checking every requested product through the authoritative single-product
-- checker. This keeps historical invalid recipe wiring blocked explicitly.

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
BEGIN
  v_result := public.check_pos_cart_availability_strict_20260912(
    p_branch_id,
    p_warehouse_id,
    p_items
  );

  -- Preserve every strict failure except aggregate raw-material shortage.
  IF COALESCE(v_result->>'error', '') <> 'INSUFFICIENT_RAW_MATERIAL_STOCK' THEN
    RETURN v_result;
  END IF;

  -- A raw shortage may only be relaxed when each requested product is itself
  -- valid for this branch/warehouse and its only blocking source is raw stock.
  -- Unknown/configuration/unit/product failures remain blocked.
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
