-- P0-B: harden close_shift to Permission-First authorization and branch-scoped lookup.

CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id uuid,
  p_actual_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_shift record;
  v_expected numeric(14,2);
  v_diff numeric(14,2);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_uid AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  -- Closing any shift is an explicit capability. Super Admin is the only
  -- implicit bypass; role labels never grant authority.
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.close') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SHIFT_CLOSE_DENIED',
      'detail', 'Closing shifts requires shifts.close.'
    );
  END IF;

  -- Scope the lookup itself so an inaccessible shift cannot be used as an
  -- existence/status oracle across branches.
  SELECT s.*
    INTO v_shift
  FROM public.shifts s
  WHERE s.id = p_shift_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(s.branch_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;

  IF v_shift.status = 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  -- A user may close their own shift with shifts.close. Closing another
  -- cashier's shift is a management action and additionally requires
  -- shifts.manage within an accessible branch.
  IF NOT public.is_pos_admin()
     AND v_shift.cashier_id <> v_uid
     AND NOT public.can_permission('shifts.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_YOUR_SHIFT');
  END IF;

  SELECT COALESCE(v_shift.opening_amount, 0)
       + COALESCE(SUM(CASE WHEN op.operation_type = 'sale'
                            AND COALESCE(op.payment_method, 'cash') = 'cash'
                           THEN op.amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN op.operation_type = 'expense'
                            AND COALESCE(op.payment_method, 'cash') = 'cash'
                           THEN op.amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN op.operation_type = 'refund'
                           THEN op.amount ELSE 0 END), 0)
    INTO v_expected
  FROM public.shift_operations op
  WHERE op.shift_id = p_shift_id;

  v_diff := COALESCE(p_actual_amount, v_expected) - v_expected;

  UPDATE public.shifts
  SET status = 'closed',
      closed_at = now(),
      expected_amount = v_expected,
      actual_amount = COALESCE(p_actual_amount, v_expected),
      difference = v_diff,
      notes = COALESCE(p_notes, notes)
  WHERE id = p_shift_id
    AND branch_id = v_shift.branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'expected', v_expected,
    'actual', COALESCE(p_actual_amount, v_expected),
    'difference', v_diff
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_shift(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_shift(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid, numeric, text) TO authenticated;
