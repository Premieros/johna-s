-- P0-B: harden Super-Admin-only subscription SECURITY DEFINER functions.
-- Authorization and business behavior are intentionally unchanged.

ALTER FUNCTION public.activate_subscription(uuid, text, text, boolean)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.subscription_settings_update(text, text, text, text, text, integer, integer, integer, boolean, boolean, boolean)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.super_admin_change_subscription(uuid, uuid, text, timestamp with time zone, timestamp with time zone)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.activate_subscription(uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_subscription(uuid, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.subscription_settings_update(text, text, text, text, text, integer, integer, integer, boolean, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_settings_update(text, text, text, text, text, integer, integer, integer, boolean, boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.subscription_settings_update(text, text, text, text, text, integer, integer, integer, boolean, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.super_admin_change_subscription(uuid, uuid, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_change_subscription(uuid, uuid, text, timestamp with time zone, timestamp with time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_change_subscription(uuid, uuid, text, timestamp with time zone, timestamp with time zone) TO authenticated;
