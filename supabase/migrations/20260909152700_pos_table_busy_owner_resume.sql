-- Safely resolve an occupied table back to the current POS operator's own order.
--
-- This is intentionally additive and does not redefine create_order(). The helper
-- exists only for the TABLE_BUSY race/stale-state path in the POS UI.
-- Contract:
--   * authenticated + pos.view only
--   * branch access must pass user_may_access_branch()
--   * only auth.uid()'s own open/held order id may be disclosed
--   * another operator's occupied table remains generic TABLE_BUSY
--   * cross-branch / hidden tables fail closed as TABLE_NOT_FOUND

CREATE OR REPLACE FUNCTION public.resolve_my_active_table_order(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_branch_id uuid;
  v_order_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('pos.view') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED:pos.view');
  END IF;

  SELECT t.branch_id
  INTO v_branch_id
  FROM public.dining_tables t
  WHERE t.id = p_table_id
    AND t.is_active = true;

  IF v_branch_id IS NULL OR NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_FOUND');
  END IF;

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  WHERE o.table_id = p_table_id
    AND o.branch_id = v_branch_id
    AND o.cashier_id = v_uid
    AND o.status IN ('open', 'held')
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TABLE_BUSY',
      'resumable', false
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'resumable', true,
    'order_id', v_order_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_my_active_table_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_my_active_table_order(uuid) TO authenticated;
