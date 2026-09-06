-- QA batch 1: remove role-label authorization from the users mutation trigger.
-- Super Admin is the only implicit bypass; all other management is permission-first.

CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bypass boolean;
  v_register boolean;
  v_unowned text;
  v_target_branch uuid;
BEGIN
  v_bypass := COALESCE(current_setting('app.login_guard_bypass', true), '') = 'on';
  v_register := COALESCE(current_setting('app.register_branch', true), '') = 'on';

  IF v_register THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = NEW.role AND is_active = true) THEN
    RAISE EXCEPTION 'UNKNOWN_ROLE';
  END IF;

  -- Unknown/anonymous caller: preserve the narrow self-profile bootstrap/lockout paths.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.id = auth.uid() AND NEW.role = 'cashier' AND NEW.branch_id IS NULL THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.username IS DISTINCT FROM OLD.username
       OR NEW.full_name IS DISTINCT FROM OLD.full_name
       OR NEW.phone IS DISTINCT FROM OLD.phone THEN
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    RETURN NEW;
  END IF;

  IF public.is_pos_admin() THEN
    RETURN NEW;
  END IF;

  -- Non-admin users may edit their own profile fields, but never their own
  -- role, branch, status, or system-managed lock state.
  IF TG_OP = 'UPDATE' AND NEW.id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: users cannot change their own role/branch/status';
    END IF;

    IF NOT v_bypass AND (
      NEW.is_locked IS DISTINCT FROM OLD.is_locked
      OR NEW.failed_attempts IS DISTINCT FROM OLD.failed_attempts
      OR NEW.lock_until IS DISTINCT FROM OLD.lock_until
    ) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: users cannot modify their own lock state';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.can_permission('users.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:users.manage';
  END IF;

  IF NEW.role = 'super_admin' OR (TG_OP = 'UPDATE' AND OLD.role = 'super_admin') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: only Super Admin can manage Super Admin accounts';
  END IF;

  v_target_branch := NEW.branch_id;
  IF v_target_branch IS NULL OR NOT public.user_may_access_branch(v_target_branch) THEN
    RAISE EXCEPTION 'TARGET_OUT_OF_SCOPE';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.branch_id IS NOT NULL
     AND NOT public.user_may_access_branch(OLD.branch_id) THEN
    RAISE EXCEPTION 'TARGET_OUT_OF_SCOPE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.roles r
    WHERE r.role = NEW.role
      AND r.is_active = true
      AND (r.scope = 'global' OR r.branch_id = NEW.branch_id)
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: role is not assignable in target branch';
  END IF;

  SELECT p.permission INTO v_unowned
  FROM public.roles r
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.permissions, '[]'::jsonb)) p(permission)
  WHERE r.role = NEW.role
    AND NOT public.can_permission(p.permission)
  ORDER BY p.permission
  LIMIT 1;

  IF v_unowned IS NOT NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: cannot assign role containing permission %', v_unowned;
  END IF;

  RETURN NEW;
END;
$function$;

-- Internal trigger helpers are not RPC surfaces, but still receive hardened lookup paths.
ALTER FUNCTION public._ensure_branch_access_after_user_create() SET search_path = public, pg_temp;
ALTER FUNCTION public.protect_last_admin() SET search_path = public, pg_temp;
