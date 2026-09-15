-- Retire the legacy branch-subscription runtime gate from operational POS flows.
--
-- Subscription UI/runtime was removed previously, but two operational callers
-- still consult subscription_expired(branch_id):
--   * _process_sale_core (sale/payment path)
--   * guard_order_subscription (order INSERT trigger)
--
-- Keep the helper as a compatibility shim instead of rewriting the large sale
-- function or dropping the trigger. This is deliberately narrow and reversible:
-- legacy subscription tables/status helpers remain untouched for historical data.

CREATE OR REPLACE FUNCTION public.subscription_expired(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT false;
$function$;

-- Preserve the existing execution boundary explicitly.
REVOKE ALL ON FUNCTION public.subscription_expired(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_expired(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.subscription_expired(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_expired(uuid) TO service_role;

COMMENT ON FUNCTION public.subscription_expired(uuid) IS
  'Compatibility shim: legacy subscription runtime enforcement is retired; operational authorization remains permission-first and branch-scoped.';
