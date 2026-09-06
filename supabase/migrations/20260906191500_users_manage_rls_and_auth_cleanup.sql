-- QA batch 1 regression closure:
-- 1) managing a user requires visibility of that same-branch target row;
--    users.manage therefore implies same-branch SELECT visibility without
--    granting any cross-branch access.
-- 2) hard deletion of an otherwise unreferenced account must also remove the
--    account's technical auth session/identity rows before auth.users. Real
--    Supabase uses ON DELETE CASCADE, while the CI auth stub intentionally
--    models a minimal FK; explicit cleanup keeps both environments correct.

DROP POLICY IF EXISTS auth_select_users ON public.users;
CREATE POLICY auth_select_users
ON public.users
FOR SELECT
TO authenticated
USING (
  id = (SELECT auth.uid())
  OR public.is_platform_admin()
  OR (
    (public.can_permission('users.view') OR public.can_permission('users.manage'))
    AND public.user_may_access_branch(branch_id)
  )
);

ALTER FUNCTION public.is_platform_admin() SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.delete_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_target_role text;
  v_target_branch uuid;
  v_fk record;
  v_has_dependency boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT role, branch_id INTO v_target_role, v_target_branch
  FROM public.users WHERE id = p_user_id;
  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('users.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
    IF v_target_role = 'super_admin' THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
    IF v_target_branch IS NULL OR NOT public.user_may_access_branch(v_target_branch) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.user_branch_access uba
      WHERE uba.user_id = p_user_id AND NOT public.user_may_access_branch(uba.branch_id)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
    END IF;
  END IF;

  -- Preserve all operational/audit history. SET NULL references are safe;
  -- membership/access rows are technical assignments that may disappear with
  -- the account. Every other direct public.users FK blocks hard deletion.
  FOR v_fk IN
    SELECT
      con.oid,
      con.conname,
      con.conrelid::regclass AS child_table,
      att.attname AS child_column,
      con.confdeltype
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.users'::regclass
      AND array_length(con.conkey, 1) = 1
      AND con.confdeltype <> 'n'
      AND con.conname NOT IN (
        'user_branch_access_user_id_fkey',
        'organization_members_user_id_fkey',
        'user_kitchen_station_assignments_user_id_fkey'
      )
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
      v_fk.child_table,
      v_fk.child_column
    ) INTO v_has_dependency USING p_user_id;

    IF v_has_dependency THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'USER_HAS_DEPENDENCIES',
        'dependency', v_fk.child_table::text,
        'action', 'DISABLE_USER_INSTEAD'
      );
    END IF;
  END LOOP;

  -- Delete the application row only after the dependency check succeeds.
  DELETE FROM public.users WHERE id = p_user_id;

  -- Explicit technical auth cleanup keeps the RPC correct both on Supabase
  -- (where these rows already cascade) and on the plain-Postgres CI auth stub.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'sessions'
  ) THEN
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'identities'
  ) THEN
    DELETE FROM auth.identities WHERE user_id = p_user_id;
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'LAST_ADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'LAST_ADMIN');
  END IF;
  RETURN jsonb_build_object('success', false, 'error', 'DELETE_BLOCKED');
END;
$function$;
