-- Close regressions exposed by the clean Permission-First verification pass.
-- Roles remain labels only. Super Admin is the only implicit bypass.

-- A payment operator must have an open shift unless explicitly trusted to manage
-- shifts. This replaces the historical cashier-name gate with capabilities,
-- without turning every holder of pos.payment.take into a cashier role.
DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_process_sale_core'
  ORDER BY p.oid
  LIMIT 1;

  IF v_oid IS NOT NULL THEN
    v_new := replace(
      v_def,
      'IF public.can_permission(''pos.payment.take'') AND NOT public.is_pos_admin() THEN',
      'IF public.can_permission(''pos.payment.take'') AND NOT public.can_permission(''shifts.manage'') AND NOT public.is_pos_admin() THEN'
    );
    IF v_new IS DISTINCT FROM v_def THEN
      EXECUTE v_new;
    END IF;
  END IF;
END;
$$;

-- Role-permission management is capability-first and fail-closed against
-- privilege escalation. A non-Super-Admin may only grant permissions they
-- themselves possess, and may only create/manage roles inside an accessible
-- branch. New role rows that omit scope are safely normalized to caller branch.
CREATE OR REPLACE FUNCTION public.guard_role_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_branch uuid;
  v_unowned text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_pos_admin() THEN
    RETURN NEW;
  END IF;

  IF NOT public.can_permission('roles.permissions.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:roles.permissions.manage';
  END IF;

  SELECT u.branch_id INTO v_caller_branch
  FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active = true;

  IF TG_OP = 'INSERT' AND (NEW.scope IS NULL OR NEW.scope = 'global' OR NEW.branch_id IS NULL) THEN
    IF v_caller_branch IS NULL THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: role requires caller branch scope';
    END IF;
    NEW.scope := 'branch';
    NEW.branch_id := v_caller_branch;
  END IF;

  IF NEW.scope <> 'branch' OR NEW.branch_id IS NULL OR NOT public.user_may_access_branch(NEW.branch_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: role outside caller branch scope';
  END IF;

  SELECT p.permission INTO v_unowned
  FROM jsonb_array_elements_text(COALESCE(NEW.permissions, '[]'::jsonb)) AS p(permission)
  WHERE NOT public.can_permission(p.permission)
  ORDER BY p.permission
  LIMIT 1;

  IF v_unowned IS NOT NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: cannot grant unowned permission %', v_unowned;
  END IF;

  RETURN NEW;
END;
$$;

-- Stock-count approval must honor explicit secondary branch access rather than
-- comparing only users.branch_id. The capability remains canonical.
CREATE OR REPLACE FUNCTION public.approve_stock_count(p_stock_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count record;
BEGIN
  BEGIN
    IF NOT public.can_permission('inventory.count.approve') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'NOT_ALLOWED',
        'detail', 'Approving stock counts requires inventory.count.approve.'
      );
    END IF;

    SELECT * INTO v_count
    FROM public.stock_counts
    WHERE id = p_stock_count_id
    FOR UPDATE;

    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;

    IF v_count.status <> 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_count.status);
    END IF;

    IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(v_count.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    UPDATE public.stock_counts
    SET status = 'approved',
        approved_by = auth.uid(),
        approved_at = now(),
        rejection_reason = NULL
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object('success', true, 'stock_count_id', p_stock_count_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_count(uuid) TO authenticated, service_role;
