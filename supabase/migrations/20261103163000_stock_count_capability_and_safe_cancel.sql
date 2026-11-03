-- Explicit capability grant for the existing branch-manager permission template.
-- Authorization remains capability-based through can_permission(), never a role-name check.
-- Safe cancellation is limited to APPROVED counts with no stock or accounting postings.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

UPDATE public.roles
SET permissions = CASE
      WHEN COALESCE(permissions, '[]'::jsonb) ? 'inventory.count.create'
        THEN COALESCE(permissions, '[]'::jsonb)
      ELSE COALESCE(permissions, '[]'::jsonb) || '["inventory.count.create"]'::jsonb
    END,
    updated_at = now()
WHERE role = 'branch_manager'
  AND is_active = true
  AND COALESCE(permissions, '[]'::jsonb) ? 'inventory.view';

-- This is an explicit capability marker, not a role-name authorization bypass.
UPDATE public.roles
SET permissions = CASE
      WHEN COALESCE(permissions, '[]'::jsonb) ? 'platform.admin'
        THEN COALESCE(permissions, '[]'::jsonb)
      ELSE COALESCE(permissions, '[]'::jsonb) || '["platform.admin"]'::jsonb
    END,
    updated_at = now()
WHERE role = 'super_admin'
  AND is_active = true;

CREATE OR REPLACE FUNCTION public.is_pos_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.role = u.role AND r.is_active = true
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  );
$function$;

-- Keep the historical RLS helper name for compatibility, but authorize by
-- the internal capability rather than comparing users.role to a role label.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.role = u.role AND r.is_active = true
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.reject_stock_count(
  p_stock_count_id uuid,
  p_reason text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count public.stock_counts%ROWTYPE;
  v_cancel_approved boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
  INTO v_count
  FROM public.stock_counts
  WHERE id = p_stock_count_id
  FOR UPDATE;

  IF v_count.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_count.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_count.status = 'approved' THEN
    v_cancel_approved := true;

    IF NOT public.can_permission('inventory.count.apply') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NULLIF(btrim(p_reason), '') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'CANCELLATION_REASON_REQUIRED');
    END IF;

    -- Refuse cancellation if any authoritative stock/accounting posting exists.
    IF v_count.applied_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.inventory_ledger
        WHERE reference_id = v_count.id
      )
      OR EXISTS (
        SELECT 1 FROM public.inventory_unit_entries
        WHERE reference_id = v_count.id
      )
      OR EXISTS (
        SELECT 1 FROM public.stock_transactions
        WHERE reference_id = v_count.id
      )
      OR EXISTS (
        SELECT 1 FROM public.journal_entries
        WHERE reference_id = v_count.id
      )
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_HAS_POSTED_EFFECTS');
    END IF;

  ELSIF v_count.status = 'submitted' THEN
    IF NOT public.can_permission('inventory.count.reject') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATUS',
      'status', v_count.status
    );
  END IF;

  UPDATE public.stock_counts
  SET status = 'rejected',
      rejection_reason = CASE
        WHEN v_cancel_approved THEN btrim(p_reason)
        ELSE p_reason
      END,
      -- Preserve the original approval audit when cancelling an approved count.
      -- Keep legacy submitted-rejection metadata behavior unchanged.
      approved_by = CASE
        WHEN v_cancel_approved THEN approved_by
        ELSE auth.uid()
      END,
      approved_at = CASE
        WHEN v_cancel_approved THEN approved_at
        ELSE now()
      END
  WHERE id = v_count.id;

  RETURN jsonb_build_object(
    'success', true,
    'stock_count_id', v_count.id,
    'approved_unapplied_cancelled', v_cancel_approved
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'TRANSACTION_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_stock_count(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_count(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.reject_stock_count(uuid, text)
  IS 'Reject submitted counts using inventory.count.reject; cancel approved counts only for inventory.count.apply holders when no stock/accounting posting exists.';

COMMIT;
