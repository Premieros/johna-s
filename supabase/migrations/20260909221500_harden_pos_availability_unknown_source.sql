-- Harden the POS availability read contract.
--
-- A known stock shortage is authoritative and must be returned as zero.
-- An unresolved inventory source/configuration must not be fabricated as zero,
-- because the POS uses an absent row to represent "availability unknown".
--
-- Security: authenticated callers may only inspect branches they can access.
-- service-role/internal calls without an auth subject keep their existing path.

CREATE OR REPLACE FUNCTION public.get_pos_product_availability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_cap integer DEFAULT 100000
) RETURNS TABLE(product_id uuid, available_quantity numeric, is_available boolean)
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
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) TO authenticated, service_role;
