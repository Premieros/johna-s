-- QA batch 1: never let hard user deletion destroy operational/audit history.
-- SET NULL references are safe. Pure access/membership cascades are safe.
-- Any other existing FK dependency blocks hard deletion and callers should disable the user instead.

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
      -- SET NULL preserves the dependent business row by design.
      AND con.confdeltype <> 'n'
      -- These are pure access assignments and may disappear with the account.
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

  DELETE FROM public.users WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'LAST_ADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'LAST_ADMIN');
  END IF;
  RETURN jsonb_build_object('success', false, 'error', 'DELETE_BLOCKED');
END;
$function$;
