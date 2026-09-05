-- Permission-First regression closure.
-- Keeps role management capability-driven and branch-scoped, and aligns
-- stock-count approval scope with canonical multi-branch access.

CREATE OR REPLACE FUNCTION public.guard_role_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_permission text;
  v_primary_branch uuid;
BEGIN
  -- Direct DB/service maintenance has no end-user JWT.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Super Admin is the only implicit bypass.
  IF public.is_pos_admin() THEN
    RETURN NEW;
  END IF;

  IF NOT public.can_permission('roles.permissions.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:roles.permissions.manage';
  END IF;

  -- New non-Super-Admin roles are normalized to the caller's branch instead
  -- of ever becoming global by an omitted scope/branch_id field.
  IF TG_OP = 'INSERT' AND (NEW.scope IS DISTINCT FROM 'branch' OR NEW.branch_id IS NULL) THEN
    SELECT u.branch_id INTO v_primary_branch
    FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active = true;

    IF v_primary_branch IS NULL THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: branch-scoped role requires a caller primary branch';
    END IF;

    NEW.scope := 'branch';
    NEW.branch_id := v_primary_branch;
  END IF;

  -- Existing global roles can never be converted/edited by non-Super-Admin.
  IF NEW.scope IS DISTINCT FROM 'branch'
     OR NEW.branch_id IS NULL
     OR NOT public.user_may_access_branch(NEW.branch_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: role outside caller branch scope';
  END IF;

  -- A role editor may delegate only capabilities they already hold.
  FOR v_permission IN
    SELECT jsonb_array_elements_text(COALESCE(NEW.permissions, '[]'::jsonb))
  LOOP
    IF NOT public.can_permission(v_permission) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: cannot grant capability %', v_permission;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- The canonical role policies remain permission-first and branch scoped.
DROP POLICY IF EXISTS auth_write_roles ON public.roles;
DROP POLICY IF EXISTS auth_write_roles_upd ON public.roles;
DROP POLICY IF EXISTS auth_write_roles_del ON public.roles;

CREATE POLICY auth_write_roles
ON public.roles
FOR INSERT TO authenticated
WITH CHECK (
  public.is_pos_admin()
  OR (
    public.can_permission('roles.permissions.manage')
    AND scope = 'branch'
    AND public.user_may_access_branch(branch_id)
  )
);

CREATE POLICY auth_write_roles_upd
ON public.roles
FOR UPDATE TO authenticated
USING (
  public.is_pos_admin()
  OR (
    public.can_permission('roles.permissions.manage')
    AND scope = 'branch'
    AND public.user_may_access_branch(branch_id)
  )
)
WITH CHECK (
  public.is_pos_admin()
  OR (
    public.can_permission('roles.permissions.manage')
    AND scope = 'branch'
    AND public.user_may_access_branch(branch_id)
  )
);

CREATE POLICY auth_write_roles_del
ON public.roles
FOR DELETE TO authenticated
USING (
  public.is_pos_admin()
  OR (
    public.can_permission('roles.permissions.manage')
    AND scope = 'branch'
    AND public.user_may_access_branch(branch_id)
  )
);

-- Stock-count lifecycle functions historically compared only users.branch_id.
-- Replace that primary-branch-only check with canonical branch access so an
-- explicitly authorized secondary branch behaves the same as transfers/waste.
DO $$
DECLARE
  r record;
  d text;
  n text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN ('approve_stock_count', 'reject_stock_count', 'apply_stock_count')
  LOOP
    d := r.def;
    n := d;

    n := regexp_replace(
      n,
      'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+THEN[[:space:]]+SELECT[[:space:]]+branch_id[[:space:]]+INTO[[:space:]]+v_user_branch[[:space:]]+FROM[[:space:]]+public\.users[[:space:]]+WHERE[[:space:]]+id[[:space:]]*=[[:space:]]*auth\.uid\(\);[[:space:]]+IF[[:space:]]+v_user_branch[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL[[:space:]]+AND[[:space:]]+v_user_branch[[:space:]]*<>[[:space:]]*v_count\.branch_id[[:space:]]+THEN[[:space:]]+RETURN[[:space:]]+jsonb_build_object\(''success'',[[:space:]]*false,[[:space:]]*''error'',[[:space:]]*''BRANCH_MISMATCH''\);[[:space:]]+END[[:space:]]+IF;[[:space:]]+END[[:space:]]+IF;',
      E'IF NOT public.user_may_access_branch(v_count.branch_id) THEN\n      RETURN jsonb_build_object(''success'', false, ''error'', ''BRANCH_MISMATCH'');\n    END IF;',
      'gi'
    );

    IF n IS NOT DISTINCT FROM d THEN
      RAISE EXCEPTION 'PERMISSION_FIRST_REGRESSION: stock-count branch guard not normalized for %', r.proname;
    END IF;

    EXECUTE n;
  END LOOP;
END;
$$;
