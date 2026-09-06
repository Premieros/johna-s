-- P0-B: harden identity-sensitive SECURITY DEFINER functions without changing behavior.

ALTER FUNCTION public.login_as_user(uuid, text, text, text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.password_matches(uuid, text)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.login_as_user(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.login_as_user(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.login_as_user(uuid, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.password_matches(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.password_matches(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.password_matches(uuid, text) TO authenticated;
