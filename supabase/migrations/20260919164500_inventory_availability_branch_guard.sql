-- Harden the POS inventory availability RPC against cross-branch / cross-warehouse reads.
--
-- The RPC is SECURITY DEFINER and intentionally callable by authenticated users,
-- so RLS is not an authorization boundary here. Keep all existing stock/recipe
-- behavior unchanged for trusted internal execution; enforce branch and
-- warehouse scope only at the authenticated API boundary.

DO $guard$
DECLARE
  v_oid oid;
  v_def text;
  v_anchor text := E'BEGIN\n  IF p_quantity IS NULL OR p_quantity <= 0 THEN';
  v_replacement text := E'BEGIN\n  IF COALESCE(current_setting(''role'', true), '''') = ''authenticated'' THEN\n    IF NOT public.user_may_access_branch(p_branch_id) THEN\n      RETURN jsonb_build_object(''success'', false, ''error'', ''BRANCH_ACCESS_DENIED'');\n    END IF;\n\n    IF NOT EXISTS (\n      SELECT 1\n      FROM public.warehouses w\n      WHERE w.id = p_warehouse_id\n        AND w.branch_id = p_branch_id\n        AND w.is_active = true\n    ) THEN\n      RETURN jsonb_build_object(''success'', false, ''error'', ''WAREHOUSE_BRANCH_MISMATCH'');\n    END IF;\n  END IF;\n\n  IF p_quantity IS NULL OR p_quantity <= 0 THEN';
BEGIN
  SELECT p.oid
  INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'check_product_availability'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_quantity numeric';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'check_product_availability target not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position('BRANCH_ACCESS_DENIED' in v_def) > 0
     AND position('WAREHOUSE_BRANCH_MISMATCH' in v_def) > 0 THEN
    RETURN;
  END IF;

  IF position(v_anchor in v_def) = 0 THEN
    RAISE EXCEPTION 'check_product_availability guard anchor not found';
  END IF;

  v_def := replace(v_def, v_anchor, v_replacement);
  EXECUTE v_def;
END;
$guard$;

REVOKE EXECUTE ON FUNCTION public.check_product_availability(uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_product_availability(uuid, uuid, uuid, numeric)
  TO authenticated, service_role;
