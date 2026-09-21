-- Performance repair: the POS client no longer needs an exact maximum sellable
-- quantity for every product. Quantity is not a client-side saleability gate and
-- raw-material shortage is an allowed sell-through state. Keep configuration
-- diagnostics authoritative while reducing the scan from repeated binary-search
-- availability checks to one diagnostic probe per active product.
--
-- This function is additive. The legacy get_pos_product_availability RPC remains
-- unchanged for reports/tests that still need an exact informational quantity.

CREATE OR REPLACE FUNCTION public.get_pos_product_sellability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_probe_quantity numeric DEFAULT 100000
)
RETURNS TABLE(
  product_id uuid,
  is_sellable boolean,
  raw_shortage_only boolean,
  availability_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_product record;
  v_check jsonb;
  v_error text;
BEGIN
  IF p_probe_quantity IS NULL OR p_probe_quantity <= 0 THEN
    p_probe_quantity := 100000;
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
    v_check := public.check_product_availability(
      v_product.id,
      p_branch_id,
      p_warehouse_id,
      p_probe_quantity
    );

    IF COALESCE((v_check->>'success')::boolean, false) THEN
      product_id := v_product.id;
      is_sellable := true;
      raw_shortage_only := false;
      availability_error := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_error := COALESCE(v_check->>'error', 'UNKNOWN_AVAILABILITY_SOURCE');

    -- Quantity shortages are informational for the POS catalog. The established
    -- sale path remains server-authoritative, and raw-material shortage can
    -- intentionally sell through into negative raw inventory.
    IF v_error IN (
      'INSUFFICIENT_PRODUCT_STOCK',
      'INSUFFICIENT_UNIT_STOCK',
      'INSUFFICIENT_RAW_MATERIAL_STOCK'
    ) THEN
      product_id := v_product.id;
      is_sellable := true;
      raw_shortage_only := v_error = 'INSUFFICIENT_RAW_MATERIAL_STOCK';
      availability_error := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Configuration/source failures remain blocked exactly as before.
    product_id := v_product.id;
    is_sellable := false;
    raw_shortage_only := false;
    availability_error := v_error;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_product_sellability(uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_product_sellability(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_product_sellability(uuid, uuid, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_pos_product_sellability(uuid, uuid, numeric)
IS 'Lightweight POS catalog sellability/configuration probe. Stock shortages do not block the catalog; configuration failures do.';
