-- Production drift reconciliation discovered while applying the verified Permission-First chain.
-- Roles remain labels only. Super Admin is the only implicit bypass.
-- This migration intentionally sorts before 20260905110600_permission_first_runtime_reconcile.sql
-- so the existing fail-closed audit can verify these repaired endpoints on Fresh DB and Production.

CREATE OR REPLACE FUNCTION public.user_may_access_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.is_pos_admin()
    OR EXISTS (
      SELECT 1
      FROM public.user_branch_access uba
      WHERE uba.user_id = auth.uid()
        AND uba.branch_id = p_branch_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.is_active = true
        AND u.branch_id = p_branch_id
    );
$$;
REVOKE ALL ON FUNCTION public.user_may_access_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_may_access_branch(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_user_branch_access(p_user_id uuid)
RETURNS TABLE(
  branch_id uuid,
  branch_name text,
  branch_name_en text,
  organization_id uuid,
  is_active boolean,
  grant_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH target_branches AS (
    SELECT uba.branch_id, 'explicit'::text AS grant_source
    FROM public.user_branch_access uba
    WHERE uba.user_id = p_user_id
    UNION
    SELECT u.branch_id, 'primary'::text AS grant_source
    FROM public.users u
    WHERE u.id = p_user_id
      AND u.branch_id IS NOT NULL
      AND u.is_active = true
  )
  SELECT b.id, b.name, b.name_en, b.organization_id, b.is_active, tb.grant_source
  FROM target_branches tb
  JOIN public.branches b ON b.id = tb.branch_id
  WHERE auth.uid() IS NOT NULL
    AND (
      p_user_id = auth.uid()
      OR public.is_pos_admin()
      OR public.can_permission('users.view')
      OR public.can_permission('users.manage')
      OR public.can_permission('users.branches.manage')
    )
    AND (
      p_user_id = auth.uid()
      OR public.is_pos_admin()
      OR public.user_may_access_branch(b.id)
    )
  ORDER BY b.name;
$$;
REVOKE ALL ON FUNCTION public.get_user_branch_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_branch_access(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_organization_branch(
  p_organization_id uuid,
  p_name text,
  p_name_en text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_global_tax numeric(5,2);
  v_global_tax_enabled boolean;
  v_global_currency text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('branches.manage')
       OR NOT public.user_can_access_organization(p_organization_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  IF btrim(coalesce(p_name, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_BRANCH_NAME');
  END IF;

  INSERT INTO public.branches (name, name_en, address, phone, is_active, organization_id)
  VALUES (p_name, p_name_en, p_address, p_phone, true, p_organization_id)
  RETURNING id INTO v_branch_id;

  INSERT INTO public.warehouses (name, branch_id, is_active)
  VALUES (p_name || ' - Main', v_branch_id, true)
  RETURNING id INTO v_warehouse_id;

  SELECT COALESCE(tax_rate, 15), COALESCE(tax_enabled, true), COALESCE(currency, 'EGP')
  INTO v_global_tax, v_global_tax_enabled, v_global_currency
  FROM public.settings ORDER BY id LIMIT 1;

  INSERT INTO public.branch_settings (branch_id, tax_rate, tax_enabled, currency, low_stock_threshold)
  VALUES (v_branch_id, v_global_tax, v_global_tax_enabled, v_global_currency, 10);

  INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
  VALUES (v_branch_id, 'trial', now(), now() + interval '14 days');

  -- Creating a branch through an explicit capability grants the creator
  -- explicit access to that new branch. This preserves multi-branch behavior
  -- without restoring any implicit owner/admin role authorization.
  INSERT INTO public.user_branch_access (user_id, branch_id)
  VALUES (auth.uid(), v_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'branch_id', v_branch_id, 'warehouse_id', v_warehouse_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'BRANCH_CREATE_FAILED', 'detail', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.create_organization_branch(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_branch(uuid,text,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_branch_cascade(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_branch uuid;
  v_org uuid;
  v_user_ids uuid[] := ARRAY[]::uuid[];
  v_deleted_auth integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('branches.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT branch_id INTO v_user_branch
  FROM public.users
  WHERE id = v_uid AND is_active = true;

  SELECT organization_id INTO v_org
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF v_user_branch IS NOT DISTINCT FROM p_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_DELETE_CURRENT_BRANCH');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_user_ids
  FROM public.users
  WHERE branch_id = p_branch_id;

  DELETE FROM public.journal_entries WHERE branch_id = p_branch_id;
  DELETE FROM public.branches WHERE id = p_branch_id;

  IF COALESCE(array_length(v_user_ids, 1), 0) > 0 THEN
    DELETE FROM auth.sessions WHERE user_id = ANY(v_user_ids);
    DELETE FROM auth.identities WHERE user_id = ANY(v_user_ids);
    DELETE FROM auth.users WHERE id = ANY(v_user_ids);
    GET DIAGNOSTICS v_deleted_auth = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'organization_id', v_org,
    'deleted_auth_users', v_deleted_auth
  );
EXCEPTION WHEN foreign_key_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'BRANCH_DELETE_BLOCKED', 'detail', SQLERRM);
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_branch_cascade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_branch_cascade(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_shift(
  p_branch_id uuid,
  p_opening_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_primary_branch uuid;
  v_shift_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('shifts.open') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_ALLOWED',
      'detail', 'Opening shifts requires shifts.open.');
  END IF;

  SELECT branch_id INTO v_primary_branch FROM public.users WHERE id = v_uid;

  IF p_branch_id IS NULL THEN
    p_branch_id := v_primary_branch;
  END IF;

  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_BRANCH');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  -- One cashier/user can have only one open shift globally, independent of
  -- the currently selected branch in the UI.
  IF EXISTS (
    SELECT 1 FROM public.shifts
    WHERE cashier_id = v_uid AND status = 'open'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_ALREADY_OPEN');
  END IF;

  INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, notes)
  VALUES (p_branch_id, v_uid, COALESCE(p_opening_amount, 0), p_notes)
  RETURNING id INTO v_shift_id;

  INSERT INTO public.shift_operations (shift_id, operation_type, amount, payment_method, reference_type)
  VALUES (v_shift_id, 'opening', COALESCE(p_opening_amount, 0), 'cash', 'shift_opening');

  RETURN jsonb_build_object('success', true, 'shift_id', v_shift_id, 'branch_id', p_branch_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.open_shift(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid,numeric,text) TO authenticated, service_role;
