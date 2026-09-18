-- Restore durable cloud print execution after the per-job-kind permission
-- split unintentionally blocked kitchen/bar jobs whenever the active terminal
-- user could print receipts but did not hold pos.print_kitchen.
--
-- Queue creation remains permission-checked by the originating business action.
-- Printer administration remains settings.manage-only.  This function governs
-- background transport execution only, so any authenticated branch user with
-- an operational print capability may transport all known queued print kinds.
-- claim/start/complete keep their existing branch-access and agent-id guards.

CREATE OR REPLACE FUNCTION public.can_execute_cloud_print_kind(p_kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_kind IN ('kitchen','receipt','report')
    AND (
      public.can_permission('settings.manage')
      OR public.can_permission('pos.print_kitchen')
      OR public.can_permission('pos.receipt.print')
    );
$function$;

REVOKE ALL ON FUNCTION public.can_execute_cloud_print_kind(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_execute_cloud_print_kind(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
