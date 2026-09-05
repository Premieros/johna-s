-- Isolate the two intentionally anonymous login RPCs behind SECURITY INVOKER
-- wrappers in the exposed public schema. The privileged implementation lives in
-- app_private, which is not an exposed PostgREST schema.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.get_login_email(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  SELECT *
  INTO v_user
  FROM public.users
  WHERE username = lower(btrim(p_username));

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT v_user.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE');
  END IF;
  IF v_user.is_locked AND (v_user.lock_until IS NULL OR v_user.lock_until > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_LOCKED');
  END IF;

  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until <= now() THEN
    UPDATE public.users
    SET is_locked = false,
        failed_attempts = 0,
        lock_until = NULL
    WHERE id = v_user.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'email', v_user.email);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.record_login_failure(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user public.users%ROWTYPE;
  v_new_attempts integer;
BEGIN
  SELECT *
  INTO v_user
  FROM public.users
  WHERE username = lower(btrim(p_username));

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until > now() THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  v_new_attempts := COALESCE(v_user.failed_attempts, 0) + 1;
  IF v_new_attempts >= 5 THEN
    UPDATE public.users
    SET failed_attempts = v_new_attempts,
        is_locked = true,
        lock_until = now() + interval '5 minutes'
    WHERE id = v_user.id;
  ELSE
    UPDATE public.users
    SET failed_attempts = v_new_attempts
    WHERE id = v_user.id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.get_login_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.record_login_failure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.get_login_email(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.record_login_failure(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_login_email(p_username text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = app_private, public, pg_temp
AS $function$
  SELECT app_private.get_login_email(p_username);
$function$;

CREATE OR REPLACE FUNCTION public.record_login_failure(p_username text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = app_private, public, pg_temp
AS $function$
  SELECT app_private.record_login_failure(p_username);
$function$;

REVOKE ALL ON FUNCTION public.get_login_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_login_failure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_login_email(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_login_failure(text) TO anon, authenticated, service_role;
