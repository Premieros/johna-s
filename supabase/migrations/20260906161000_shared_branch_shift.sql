-- Shared branch shift: one open shift per branch, used by every authorized cashier.
-- The shift cashier_id remains the opener for audit only. Individual sale/refund
-- attribution remains on sales.cashier_id and shift_operations.created_by.

-- Reconcile legacy per-cashier open shifts before enforcing the invariant.
DO $block$
DECLARE
  v_branch record;
  v_primary uuid;
  v_opening numeric;
BEGIN
  FOR v_branch IN
    SELECT branch_id
    FROM public.shifts
    WHERE status = 'open'
    GROUP BY branch_id
    HAVING count(*) > 1
  LOOP
    SELECT id
      INTO v_primary
    FROM public.shifts
    WHERE branch_id = v_branch.branch_id
      AND status = 'open'
    ORDER BY opened_at, id
    LIMIT 1;

    SELECT COALESCE(sum(opening_amount), 0)
      INTO v_opening
    FROM public.shifts
    WHERE branch_id = v_branch.branch_id
      AND status = 'open';

    -- Keep every operation and its created_by attribution on the shared shift.
    UPDATE public.shift_operations
    SET shift_id = v_primary
    WHERE shift_id IN (
      SELECT id
      FROM public.shifts
      WHERE branch_id = v_branch.branch_id
        AND status = 'open'
        AND id <> v_primary
    );

    UPDATE public.shifts
    SET opening_amount = v_opening
    WHERE id = v_primary;

    -- Preserve duplicate legacy rows as closed audit records rather than deleting them.
    UPDATE public.shifts
    SET status = 'closed',
        closed_at = COALESCE(closed_at, now()),
        expected_amount = COALESCE(expected_amount, opening_amount, 0),
        actual_amount = COALESCE(actual_amount, opening_amount, 0),
        difference = COALESCE(difference, 0),
        notes = concat_ws(E'\n', NULLIF(notes, ''), 'Merged into shared branch shift ' || v_primary::text)
    WHERE branch_id = v_branch.branch_id
      AND status = 'open'
      AND id <> v_primary;
  END LOOP;
END;
$block$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_one_open_per_branch
  ON public.shifts(branch_id)
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.open_shift(
  p_branch_id uuid,
  p_opening_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_primary_branch uuid;
  v_shift_id uuid;
  v_opener uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('shifts.open') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_ALLOWED', 'detail', 'Opening shifts requires shifts.open.');
  END IF;

  SELECT branch_id INTO v_primary_branch
  FROM public.users
  WHERE id = v_uid;

  IF p_branch_id IS NULL THEN p_branch_id := v_primary_branch; END IF;
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_BRANCH');
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  -- Joining an already-open branch shift is idempotent: do not create a second drawer.
  SELECT id, cashier_id INTO v_shift_id, v_opener
  FROM public.shifts
  WHERE branch_id = p_branch_id AND status = 'open'
  ORDER BY opened_at, id
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'shift_id', v_shift_id,
      'branch_id', p_branch_id,
      'shared', true,
      'already_open', true,
      'opened_by', v_opener
    );
  END IF;

  INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, notes)
  VALUES (p_branch_id, v_uid, GREATEST(COALESCE(p_opening_amount, 0), 0), p_notes)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_shift_id;

  -- Race-safe fallback if another cashier opened the branch shift concurrently.
  IF v_shift_id IS NULL THEN
    SELECT id, cashier_id INTO v_shift_id, v_opener
    FROM public.shifts
    WHERE branch_id = p_branch_id AND status = 'open'
    ORDER BY opened_at, id
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', true,
      'shift_id', v_shift_id,
      'branch_id', p_branch_id,
      'shared', true,
      'already_open', true,
      'opened_by', v_opener
    );
  END IF;

  INSERT INTO public.shift_operations (
    shift_id, operation_type, amount, payment_method, reference_type, created_by
  ) VALUES (
    v_shift_id, 'opening', GREATEST(COALESCE(p_opening_amount, 0), 0), 'cash', 'shift_opening', v_uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', v_shift_id,
    'branch_id', p_branch_id,
    'shared', true,
    'already_open', false,
    'opened_by', v_uid
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_shift(p_branch_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user_branch uuid;
  v_target_branch uuid;
  v_shift record;
  v_cash_sales numeric(14,2);
  v_cash_expenses numeric(14,2);
  v_total_sales numeric(14,2);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  SELECT branch_id INTO v_user_branch
  FROM public.users
  WHERE id = v_uid AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  v_target_branch := COALESCE(p_branch_id, v_user_branch);

  IF v_target_branch IS NOT NULL AND NOT public.user_may_access_branch(v_target_branch) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.status = 'open'
    AND (v_target_branch IS NULL OR s.branch_id = v_target_branch)
    AND public.user_may_access_branch(s.branch_id)
  ORDER BY s.opened_at DESC, s.id DESC
  LIMIT 1;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'open', false);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN operation_type = 'sale' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN operation_type = 'sale' AND payment_method = 'cash' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN operation_type IN ('expense', 'cash_out', 'refund') AND payment_method = 'cash' THEN amount ELSE 0 END), 0)
  INTO v_total_sales, v_cash_sales, v_cash_expenses
  FROM public.shift_operations
  WHERE shift_id = v_shift.id;

  RETURN jsonb_build_object(
    'success', true,
    'open', true,
    'shared', true,
    'shift', jsonb_build_object(
      'id', v_shift.id,
      'branch_id', v_shift.branch_id,
      'cashier_id', v_shift.cashier_id,
      'opened_at', v_shift.opened_at,
      'opening_amount', v_shift.opening_amount,
      'expected', v_shift.opening_amount + v_cash_sales - v_cash_expenses,
      'cash_sales', v_cash_sales,
      'total_sales', v_total_sales,
      'notes', v_shift.notes
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

-- Patch internal sale/refund shift lookups to branch scope while preserving the
-- rest of their already-verified implementations byte-for-byte.
DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_original text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_process_sale_core' AND p.prokind = 'f'
  LIMIT 1;
  IF v_oid IS NULL THEN RAISE EXCEPTION '_process_sale_core not found'; END IF;
  v_def := pg_get_functiondef(v_oid);
  v_original := v_def;
  v_def := replace(v_def,
    'WHERE cashier_id = auth.uid() AND branch_id = p_branch_id AND status = ''open''',
    'WHERE branch_id = p_branch_id AND status = ''open''');
  v_def := replace(v_def,
    'WHERE id = p_shift_id AND cashier_id = auth.uid() AND branch_id = p_branch_id AND status = ''open''',
    'WHERE id = p_shift_id AND branch_id = p_branch_id AND status = ''open''');
  IF v_def = v_original OR position('cashier_id = auth.uid() AND branch_id = p_branch_id' IN v_def) > 0 THEN
    RAISE EXCEPTION 'shared shift patch failed for _process_sale_core';
  END IF;
  EXECUTE v_def;

  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_process_refund_single_core' AND p.prokind = 'f'
  LIMIT 1;
  IF v_oid IS NULL THEN RAISE EXCEPTION '_process_refund_single_core not found'; END IF;
  v_def := pg_get_functiondef(v_oid);
  v_original := v_def;
  v_def := replace(v_def,
    'WHERE cashier_id = auth.uid() AND branch_id = v_sale.branch_id AND status = ''open''',
    'WHERE branch_id = v_sale.branch_id AND status = ''open''');
  IF v_def = v_original OR position('cashier_id = auth.uid() AND branch_id = v_sale.branch_id' IN v_def) > 0 THEN
    RAISE EXCEPTION 'shared shift patch failed for _process_refund_single_core';
  END IF;
  EXECUTE v_def;

  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'process_refund' AND p.prokind = 'f'
  LIMIT 1;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'process_refund not found'; END IF;
  v_def := pg_get_functiondef(v_oid);
  v_original := v_def;
  v_def := replace(v_def,
    'WHERE cashier_id = auth.uid() AND branch_id = v_sale.branch_id AND status = ''open''',
    'WHERE branch_id = v_sale.branch_id AND status = ''open''');
  IF v_def = v_original OR position('cashier_id = auth.uid() AND branch_id = v_sale.branch_id' IN v_def) > 0 THEN
    RAISE EXCEPTION 'shared shift patch failed for process_refund';
  END IF;
  EXECUTE v_def;
END;
$patch$;

-- Keep the established API grants; callers still need internal permission and branch checks.
REVOKE ALL ON FUNCTION public.open_shift(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_shift(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.open_shift(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_active_shift(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_shift(uuid) TO authenticated, service_role;
