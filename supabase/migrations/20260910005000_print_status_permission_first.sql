-- Final handover: harden print status as a permission-first, branch-scoped write.
-- A physical print must never be recorded as successful by a caller that lacks
-- receipt-print permission or access to the order's branch.

CREATE OR REPLACE FUNCTION public.set_print_status(
  p_order_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('pending', 'printed', 'failed') THEN
    RAISE EXCEPTION 'INVALID_PRINT_STATUS';
  END IF;

  SELECT o.branch_id
    INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF NOT public.can_permission('pos.receipt.print') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:pos.receipt.print';
  END IF;

  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  UPDATE public.orders
  SET print_status = p_status,
      printed_at = CASE
        WHEN p_status = 'printed' THEN now()
        ELSE NULL
      END
  WHERE id = p_order_id
    AND branch_id = v_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'print_status', p_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_print_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_print_status(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_print_status(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_print_status(uuid, text)
IS 'Permission-first receipt print status write; requires pos.receipt.print and branch access. printed_at is set only for confirmed printed state.';
