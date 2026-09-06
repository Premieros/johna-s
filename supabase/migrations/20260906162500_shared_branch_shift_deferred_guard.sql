-- Keep the one-open-shift-per-branch invariant transaction-safe without
-- breaking savepoint-based RLS probes. The constraint is deferred until
-- transaction end, while open_shift serializes real branch opening calls.

DROP INDEX IF EXISTS public.uq_shifts_one_open_per_branch;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS open_branch_guard boolean
  GENERATED ALWAYS AS (
    CASE WHEN status = 'open' THEN true ELSE NULL::boolean END
  ) STORED;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.shifts'::regclass
      AND conname = 'uq_shifts_one_open_per_branch_deferred'
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT uq_shifts_one_open_per_branch_deferred
      UNIQUE (branch_id, open_branch_guard)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$constraint$;

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

  -- Serialize shift opening for this branch. This closes the race window even
  -- though the hard database uniqueness check is deferred until COMMIT.
  PERFORM pg_advisory_xact_lock(hashtext(p_branch_id::text)::bigint);

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
  RETURNING id INTO v_shift_id;

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

REVOKE ALL ON FUNCTION public.open_shift(uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.open_shift(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid, numeric, text) TO authenticated, service_role;
