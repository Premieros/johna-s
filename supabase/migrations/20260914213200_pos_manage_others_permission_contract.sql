-- Final permission-first administrative contract for managing another
-- operator's active POS order. All four permissions are individually assignable
-- from the existing permission matrix; no ordinary role name participates.
-- Super Admin remains the only implicit bypass because can_permission() already
-- implements that canonical exception.

CREATE OR REPLACE FUNCTION public.can_manage_other_pos_orders()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.can_permission('pos.view')
    AND public.can_permission('pos.order.edit')
    AND public.can_permission('pos.order.transfer')
    AND public.can_permission('users.manage');
$function$;

REVOKE ALL ON FUNCTION public.can_manage_other_pos_orders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_manage_other_pos_orders() FROM anon;
GRANT EXECUTE ON FUNCTION public.can_manage_other_pos_orders() TO authenticated, service_role;
