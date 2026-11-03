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


-- Keep count transitions aligned with the split capabilities. In particular,
-- an approved-but-unapplied count is cancelled with inventory.count.apply,
-- while a submitted count is rejected with inventory.count.reject.
-- This trigger also protects direct table updates, not only the RPC wrapper.
CREATE OR REPLACE FUNCTION public.enforce_approval_policy_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope text;
  v_fallback text;
  v_amount numeric := 0;
BEGIN
  IF auth.uid() IS NULL
    OR NEW.status IS NOT DISTINCT FROM OLD.status
    OR NEW.status NOT IN ('approved', 'rejected')
  THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'waste_entries' THEN
    v_scope := 'waste';
    v_fallback := 'waste.approve';
    v_amount := COALESCE(NEW.total_cost, 0);

  ELSIF TG_TABLE_NAME = 'stock_counts' THEN
    v_scope := 'stock_count';

    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'STOCK_COUNT_BRANCH_IMMUTABLE';
    END IF;
    IF NOT public.user_may_access_branch(OLD.branch_id) THEN
      RAISE EXCEPTION 'BRANCH_MISMATCH';
    END IF;

    IF OLD.status = 'approved' AND NEW.status = 'rejected' THEN
      v_fallback := 'inventory.count.apply';

      IF NOT public.can_permission(v_fallback) THEN
        RAISE EXCEPTION 'NOT_ALLOWED';
      END IF;
      IF NULLIF(btrim(NEW.rejection_reason), '') IS NULL THEN
        RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED';
      END IF;

      -- A posted count is immutable: check both the count marker and every
      -- authoritative inventory/accounting posting source used by apply.
      IF OLD.applied_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.inventory_ledger WHERE reference_id = OLD.id)
        OR EXISTS (SELECT 1 FROM public.inventory_unit_entries WHERE reference_id = OLD.id)
        OR EXISTS (SELECT 1 FROM public.stock_transactions WHERE reference_id = OLD.id)
        OR EXISTS (SELECT 1 FROM public.journal_entries WHERE reference_id = OLD.id)
      THEN
        RAISE EXCEPTION 'COUNT_HAS_POSTED_EFFECTS';
      END IF;

      -- Preserve the approval audit when cancelling an approved count.
      NEW.approved_by := OLD.approved_by;
      NEW.approved_at := OLD.approved_at;

    ELSIF OLD.status = 'submitted' AND NEW.status = 'rejected' THEN
      v_fallback := 'inventory.count.reject';
      IF NOT public.can_permission(v_fallback) THEN
        RAISE EXCEPTION 'NOT_ALLOWED';
      END IF;

    ELSIF OLD.status = 'submitted' AND NEW.status = 'approved' THEN
      v_fallback := 'inventory.count.approve';
      IF NOT public.can_permission(v_fallback) THEN
        RAISE EXCEPTION 'NOT_ALLOWED';
      END IF;

    ELSE
      RAISE EXCEPTION 'INVALID_STOCK_COUNT_TRANSITION:%->%', OLD.status, NEW.status;
    END IF;

  ELSIF TG_TABLE_NAME = 'warehouse_transfers' THEN
    v_scope := 'warehouse_transfer';
    v_fallback := 'inventory.transfers.approve';

  ELSE
    RETURN NEW;
  END IF;

  IF NOT public.can_approve_by_policy(v_scope, NEW.branch_id, v_amount, v_fallback) THEN
    RAISE EXCEPTION 'APPROVAL_POLICY_DENIED:%', v_scope;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_user(p_email text, p_password text, p_full_name text DEFAULT NULL::text, p_role text DEFAULT 'cashier'::text, p_branch_id uuid DEFAULT NULL::uuid, p_is_active boolean DEFAULT true, p_username text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_role text;
  v_hash text;
  v_email text;
  v_username text;
  v_pgc_schema text;
  v_u_cols text;
  v_u_vals text;
  v_i_cols text;
  v_i_vals text;
  v_creation_check jsonb;
BEGIN
  IF current_setting('app.register_branch', true) = 'on' THEN
    NULL;
  ELSIF public.is_pos_admin() THEN
    NULL;
  ELSE
    IF auth.uid() IS NULL OR NOT public.can_permission('users.create') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;

    v_creation_check := public.can_create_new_user();
    IF NOT COALESCE((v_creation_check->>'allowed')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_creation_check->>'error', 'USER_CREATION_DISABLED'));
    END IF;

    IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.role = p_role AND r.is_active
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'detail', 'Only Super Admin can create Super Admin accounts');
    END IF;
  END IF;

  v_email := lower(btrim(p_email));
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_REQUIRED');
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email)
     OR EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;

  v_username := regexp_replace(
    regexp_replace(
      lower(btrim(coalesce(NULLIF(p_username, ''), split_part(v_email, '@', 1)))),
      '[^a-z0-9._-]', '_', 'g'
    ),
    '^[._-]+', '', 'g'
  );

  IF v_username = '' THEN
    v_username := 'user' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USERNAME_TAKEN');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = p_role AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ROLE');
  END IF;
  v_role := p_role;

  SELECT extnamespace::regnamespace::text
  INTO v_pgc_schema
  FROM pg_extension
  WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
  INTO v_hash
  USING p_password, 'bf', 10;

  v_user_id := gen_random_uuid();

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_u_cols, v_u_vals
  FROM (
    SELECT cols.ordinal_position AS ord,
           quote_ident(cols.column_name) AS col,
           CASE cols.column_name
             WHEN 'instance_id' THEN '''00000000-0000-0000-0000-000000000000'''
             WHEN 'id' THEN quote_literal(v_user_id)
             WHEN 'aud' THEN '''authenticated'''
             WHEN 'role' THEN '''authenticated'''
             WHEN 'email' THEN quote_literal(v_email)
             WHEN 'encrypted_password' THEN quote_literal(v_hash)
             WHEN 'email_confirmed_at' THEN 'now()'
             WHEN 'confirmation_token' THEN ''''''
             WHEN 'recovery_token' THEN ''''''
             WHEN 'email_change' THEN ''''''
             WHEN 'email_change_token_new' THEN ''''''
             WHEN 'email_change_token_current' THEN ''''''
             WHEN 'raw_app_meta_data' THEN format('jsonb_build_object(''provider'',''email'',''providers'',array[''email'']::text[],''email'',%L)', v_email)
             WHEN 'raw_user_meta_data' THEN format('jsonb_build_object(''full_name'',%L,''email'',%L,''email_verified'',true)', p_full_name, v_email)
             WHEN 'created_at' THEN 'now()'
             WHEN 'updated_at' THEN 'now()'
             WHEN 'is_anonymous' THEN 'false'
             WHEN 'is_sso_user' THEN 'false'
           END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth'
      AND cols.table_name = 'users'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN (
        'instance_id','id','aud','role','email','encrypted_password','email_confirmed_at',
        'confirmation_token','recovery_token','email_change','email_change_token_new',
        'email_change_token_current','raw_app_meta_data','raw_user_meta_data','created_at',
        'updated_at','is_anonymous','is_sso_user'
      )
  ) c;

  IF v_u_cols IS NULL OR v_u_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.users');
  END IF;

  EXECUTE 'INSERT INTO auth.users (' || v_u_cols || ') VALUES (' || v_u_vals || ')';

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_i_cols, v_i_vals
  FROM (
    SELECT cols.ordinal_position AS ord,
           quote_ident(cols.column_name) AS col,
           CASE cols.column_name
             WHEN 'id' THEN 'gen_random_uuid()'
             WHEN 'provider_id' THEN quote_literal(v_user_id::text)
             WHEN 'user_id' THEN quote_literal(v_user_id)
             WHEN 'identity_data' THEN format('jsonb_build_object(''sub'',%L,''email'',%L)', v_user_id::text, v_email)
             WHEN 'provider' THEN '''email'''
             WHEN 'last_sign_in_at' THEN 'now()'
             WHEN 'created_at' THEN 'now()'
             WHEN 'updated_at' THEN 'now()'
             WHEN 'email' THEN quote_literal(v_email)
           END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth'
      AND cols.table_name = 'identities'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('id','provider_id','user_id','identity_data','provider','last_sign_in_at','created_at','updated_at','email')
  ) c;

  IF v_i_cols IS NULL OR v_i_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.identities');
  END IF;

  EXECUTE 'INSERT INTO auth.identities (' || v_i_cols || ') VALUES (' || v_i_vals || ')';

  INSERT INTO public.users (id,email,username,full_name,role,branch_id,is_active)
  VALUES (v_user_id,v_email,v_username,p_full_name,v_role,p_branch_id,p_is_active);

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;


CREATE OR REPLACE FUNCTION public.delete_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_role text;
  v_target_branch uuid;
  v_fk record;
  v_has_dependency boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT role, branch_id INTO v_target_role, v_target_branch FROM public.users WHERE id = p_user_id;
  IF v_target_role IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('users.manage') THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED'); END IF;
    IF EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.roles r ON r.role = u.role AND r.is_active = true
      WHERE u.id = p_user_id
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    ) THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED'); END IF;
    IF v_target_branch IS NULL OR NOT public.user_may_access_branch(v_target_branch) THEN RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE'); END IF;
    IF EXISTS (SELECT 1 FROM public.user_branch_access uba WHERE uba.user_id=p_user_id AND NOT public.user_may_access_branch(uba.branch_id)) THEN RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE'); END IF;
  END IF;
  FOR v_fk IN
    SELECT con.oid, con.conname, con.conrelid::regclass AS child_table, att.attname AS child_column, con.confdeltype
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=con.conkey[1]
    WHERE con.contype='f' AND con.confrelid='public.users'::regclass AND array_length(con.conkey,1)=1
      AND con.confdeltype <> 'n'
      AND con.conname NOT IN ('user_branch_access_user_id_fkey','organization_members_user_id_fkey','user_kitchen_station_assignments_user_id_fkey')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',v_fk.child_table,v_fk.child_column) INTO v_has_dependency USING p_user_id;
    IF v_has_dependency THEN RETURN jsonb_build_object('success',false,'error','USER_HAS_DEPENDENCIES','dependency',v_fk.child_table::text,'action','DISABLE_USER_INSTEAD'); END IF;
  END LOOP;
  DELETE FROM public.users WHERE id=p_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='sessions') THEN DELETE FROM auth.sessions WHERE user_id=p_user_id; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='identities') THEN DELETE FROM auth.identities WHERE user_id=p_user_id; END IF;
  DELETE FROM auth.users WHERE id=p_user_id;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='LAST_ADMIN' THEN RETURN jsonb_build_object('success',false,'error','LAST_ADMIN'); END IF;
  RETURN jsonb_build_object('success',false,'error','DELETE_BLOCKED');
END;
$function$;


CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  IF TG_OP = 'INSERT' THEN
    IF NOT public.can_permission('users.create') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:users.create';
    END IF;
  ELSIF NOT public.can_permission('users.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:users.manage';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.role = NEW.role AND r.is_active
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  ) OR (
    TG_OP = 'UPDATE' AND EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.role = OLD.role AND r.is_active
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    )
  ) THEN
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


CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.is_super_admin();
$function$;

CREATE OR REPLACE FUNCTION public.login_as_user(p_target_user_id uuid, p_reason text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_device text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_log_id uuid;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = auth.uid();
  IF v_admin.id IS NULL OR NOT v_admin.is_active OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT v_target.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE');
  END IF;
  IF v_target.id = v_admin.id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_IMPERSONATE_SELF');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.role = v_target.role AND r.is_active
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_IMPERSONATE_ADMIN');
  END IF;

  INSERT INTO public.login_as_log (
    admin_user_id, admin_email, admin_branch_id, target_user_id, target_branch_id,
    reason, ip, device
  ) VALUES (
    v_admin.id, v_admin.email, v_admin.branch_id, v_target.id, v_target.branch_id,
    p_reason, p_ip, p_device
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'target', jsonb_build_object(
      'id', v_target.id,
      'email', v_target.email,
      'username', v_target.username,
      'full_name', v_target.full_name,
      'role', v_target.role,
      'branch_id', v_target.branch_id,
      'phone', v_target.phone,
      'is_active', v_target.is_active,
      'is_locked', v_target.is_locked
    )
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_is_admin boolean := false;
  v_new_is_admin boolean := false;
  v_other_active_admins integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.role = OLD.role AND r.is_active
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  ) INTO v_old_is_admin;

  IF TG_OP = 'DELETE' THEN
    IF v_old_is_admin AND OLD.is_active THEN
      SELECT count(*) INTO v_other_active_admins
      FROM public.users u
      JOIN public.roles r ON r.role = u.role AND r.is_active
      WHERE u.is_active
        AND u.id <> OLD.id
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin';
      IF v_other_active_admins = 0 THEN
        RAISE EXCEPTION 'LAST_ADMIN';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.role = NEW.role AND r.is_active
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  ) INTO v_new_is_admin;

  IF v_old_is_admin AND OLD.is_active
     AND (NOT v_new_is_admin OR NOT NEW.is_active) THEN
    SELECT count(*) INTO v_other_active_admins
    FROM public.users u
    JOIN public.roles r ON r.role = u.role AND r.is_active
    WHERE u.is_active
      AND u.id <> OLD.id
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin';
    IF v_other_active_admins = 0 THEN
      RAISE EXCEPTION 'LAST_ADMIN';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requires_work_authorization(p_user_id uuid, p_branch_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_super boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND u.is_active = true
      AND EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.role = u.role AND r.is_active
          AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
      )
  ) INTO v_is_super;

  IF v_is_super THEN
    RETURN false;
  END IF;

  IF p_user_id = auth.uid()
     AND public.can_permission('work.authorization.bypass') THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.work_authorization_policies p
    WHERE p.user_id = p_user_id
      AND p.branch_id = p_branch_id
      AND p.requires_authorization = true
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.set_user_branch_access(p_user_id uuid, p_branch_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_role text;
  v_target_primary uuid;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF array_length(p_branch_ids, 1) IS NULL OR array_length(p_branch_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'AT_LEAST_ONE_BRANCH');
  END IF;

  SELECT role, branch_id
  INTO v_target_role, v_target_primary
  FROM public.users
  WHERE id = p_user_id;

  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.is_platform_admin() THEN
    IF NOT public.can_permission('users.branches.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.role = u.role AND r.is_active = true
      WHERE u.id = p_user_id
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Only Super Admin can change Super Admin branch access');
    END IF;

    IF v_target_primary IS NOT NULL AND NOT public.user_may_access_branch(v_target_primary) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.user_branch_access uba
      WHERE uba.user_id = p_user_id
        AND NOT public.user_may_access_branch(uba.branch_id)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
    END IF;

    FOREACH v_branch_id IN ARRAY p_branch_ids LOOP
      IF NOT public.user_may_access_branch(v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED', 'branch_id', v_branch_id);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.user_branch_access WHERE user_id = p_user_id;
  INSERT INTO public.user_branch_access(user_id, branch_id)
  SELECT p_user_id, branch_id
  FROM unnest(p_branch_ids) AS branch_id
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  PERFORM public.log_audit_action(
    v_target_primary,
    'set_branch_access',
    'user_branch_access',
    p_user_id,
    jsonb_build_object('user_id', p_user_id, 'branch_ids', p_branch_ids)
  );

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'branch_ids', p_branch_ids);
END;
$function$;


CREATE OR REPLACE FUNCTION public.update_user_password(p_user_id uuid, p_new_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_hash text; v_pgc_schema text; v_target_role text; v_target_branch uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
  SELECT role,branch_id INTO v_target_role,v_target_branch FROM public.users WHERE id=p_user_id;
  IF v_target_role IS NULL THEN RETURN jsonb_build_object('success',false,'error','NOT_FOUND'); END IF;
  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('users.manage') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
    IF EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.role = u.role AND r.is_active = true
      WHERE u.id = p_user_id
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    ) THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
    IF v_target_branch IS NULL OR NOT public.user_may_access_branch(v_target_branch) THEN RETURN jsonb_build_object('success',false,'error','TARGET_OUT_OF_SCOPE'); END IF;
  END IF;
  IF p_new_password IS NULL OR char_length(p_new_password)<4 THEN RETURN jsonb_build_object('success',false,'error','WEAK_PASSWORD'); END IF;
  IF char_length(p_new_password)=4 AND p_new_password !~ '^[0-9]{4}$' THEN RETURN jsonb_build_object('success',false,'error','WEAK_PASSWORD'); END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RETURN jsonb_build_object('success',false,'error','NOT_FOUND'); END IF;
  SELECT extnamespace::regnamespace::text INTO v_pgc_schema FROM pg_extension WHERE extname='pgcrypto';
  IF v_pgc_schema IS NULL THEN RETURN jsonb_build_object('success',false,'error','UNKNOWN_ERROR','detail','pgcrypto extension is not enabled'); END IF;
  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))',v_pgc_schema,v_pgc_schema) INTO v_hash USING p_new_password,'bf',10;
  UPDATE auth.users SET encrypted_password=v_hash,updated_at=now() WHERE id=p_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='sessions') THEN DELETE FROM auth.sessions WHERE user_id=p_user_id; END IF;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','UNKNOWN_ERROR','detail',SQLERRM);
END;
$function$;


COMMIT;
