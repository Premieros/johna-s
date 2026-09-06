-- P0-B: harden a narrow cluster of high-risk admin SECURITY DEFINER functions.
-- Behavior and authorization contracts are intentionally unchanged.

ALTER FUNCTION public.is_super_admin()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_data_delete_section(uuid, text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_data_seed_all(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.verify_auth_account(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.repair_auth_account(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.toggle_organization_status(uuid, boolean)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_data_delete_section(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_data_delete_section(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_data_delete_section(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_data_seed_all(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_data_seed_all(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_data_seed_all(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.verify_auth_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_auth_account(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_auth_account(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.repair_auth_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_auth_account(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.repair_auth_account(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_organization_status(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_organization_status(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_organization_status(uuid, boolean) TO authenticated;
