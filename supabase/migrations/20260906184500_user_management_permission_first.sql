-- Full-system QA batch 1: user-management RPCs must be Permission-First.
-- Super Admin remains the only implicit bypass. Any other role label is non-authoritative.

CREATE OR REPLACE FUNCTION public.create_user(
  p_email text,
  p_password text,
  p_full_name text DEFAULT NULL::text,
  p_role text DEFAULT 'cashier'::text,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_is_active boolean DEFAULT true,
  p_username text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
BEGIN
  IF current_setting('app.register_branch', true) = 'on' THEN
    NULL; -- trusted nested provisioning path; caller performs its own validation.
  ELSIF public.is_pos_admin() THEN
    NULL;
  ELSE
    IF auth.uid() IS NULL OR NOT public.can_permission('users.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
    IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
    END IF;
    IF p_role = 'super_admin' THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Only Super Admin can create Super Admin accounts');
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
    regexp_replace(lower(btrim(coalesce(NULLIF(p_username, ''), split_part(v_email, '@', 1)))), '[^a-z0-9._-]', '_', 'g'),
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

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
  FROM pg_extension WHERE extname = 'pgcrypto';
  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
    INTO v_hash USING p_password, 'bf', 10;

  v_user_id := gen_random_uuid();

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_u_cols, v_u_vals
  FROM (
    SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
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
    WHERE cols.table_schema = 'auth' AND cols.table_name = 'users'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('instance_id','id','aud','role','email','encrypted_password','email_confirmed_at','confirmation_token','recovery_token','email_change','email_change_token_new','email_change_token_current','raw_app_meta_data','raw_user_meta_data','created_at','updated_at','is_anonymous','is_sso_user')
  ) c;

  IF v_u_cols IS NULL OR v_u_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.users');
  END IF;
  EXECUTE 'INSERT INTO auth.users (' || v_u_cols || ') VALUES (' || v_u_vals || ')';

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_i_cols, v_i_vals
  FROM (
    SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
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
    WHERE cols.table_schema = 'auth' AND cols.table_name = 'identities'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('id','provider_id','user_id','identity_data','provider','last_sign_in_at','created_at','updated_at','email')
  ) c;

  IF v_i_cols IS NULL OR v_i_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.identities');
  END IF;
  EXECUTE 'INSERT INTO auth.identities (' || v_i_cols || ') VALUES (' || v_i_vals || ')';

  INSERT INTO public.users (id, email, username, full_name, role, branch_id, is_active)
  VALUES (v_user_id, v_email, v_username, p_full_name, v_role, p_branch_id, p_is_active);

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_user(
  p_email text,
  p_password text,
  p_full_name text DEFAULT NULL::text,
  p_role text DEFAULT 'cashier'::text,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.create_user(p_email, p_password, p_full_name, p_role, p_branch_id, p_is_active, NULL::text);
$function$;

CREATE OR REPLACE FUNCTION public.delete_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_target_role text;
  v_target_branch uuid;
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

  DELETE FROM public.users WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'LAST_ADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'LAST_ADMIN');
  END IF;
  RETURN jsonb_build_object('success', false, 'error', 'DELETE_BLOCKED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_password(p_user_id uuid, p_new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_hash text;
  v_pgc_schema text;
  v_target_role text;
  v_target_branch uuid;
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
  END IF;

  IF p_new_password IS NULL OR char_length(p_new_password) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
  END IF;
  IF char_length(p_new_password) = 4 AND p_new_password !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
  FROM pg_extension WHERE extname = 'pgcrypto';
  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
    INTO v_hash USING p_new_password, 'bf', 10;

  UPDATE auth.users SET encrypted_password = v_hash, updated_at = now() WHERE id = p_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'sessions') THEN
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;
