-- Allow the existing UI reassignment write only when the caller has the
-- explicit administrative permission set. This trigger runs before the
-- existing ownership/cashier guards and establishes the same transaction-local
-- context that transfer_order_operator() uses. The existing cashier guard keeps
-- the audit trail authoritative.
--
-- No role-name authorization; Super Admin is covered only through can_permission.

CREATE OR REPLACE FUNCTION public.prepare_pos_operator_reassignment_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.cashier_id IS NOT DISTINCT FROM OLD.cashier_id THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.can_manage_other_pos_orders()
     AND public.can_permission('pos.order.transfer')
     AND OLD.status IN ('open', 'held')
     AND public.user_may_access_branch(OLD.branch_id) THEN
    PERFORM set_config('app.pos_operator_transfer_order_id', OLD.id::text, true);
    PERFORM set_config('app.pos_operator_transfer_target_id', COALESCE(NEW.cashier_id::text, ''), true);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_pos_operator_reassignment_context() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prepare_pos_operator_reassignment_context() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_pos_operator_reassignment_context() TO service_role;

DROP TRIGGER IF EXISTS aaa_prepare_pos_operator_reassignment ON public.orders;
CREATE TRIGGER aaa_prepare_pos_operator_reassignment
BEFORE UPDATE OF cashier_id ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.prepare_pos_operator_reassignment_context();
