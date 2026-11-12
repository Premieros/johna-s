BEGIN;
SET LOCAL lock_timeout='500ms';
SET LOCAL statement_timeout='5s';
LOCK TABLE public.order_items, public.order_kitchen_sends IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $guard$
BEGIN
 IF (SELECT md5(pg_get_expr(polqual,polrelid)) FROM pg_policy WHERE polrelid='public.order_items'::regclass AND polname='auth_select_order_items') IS DISTINCT FROM '2b773d2bd428ae5847a334ef9a539b0e'
 OR (SELECT md5(pg_get_expr(polqual,polrelid)) FROM pg_policy WHERE polrelid='public.order_kitchen_sends'::regclass AND polname='auth_select_order_kitchen_sends') IS DISTINCT FROM '0b5d2bc8adfbeee072239be9747ea0ac'
 THEN RAISE EXCEPTION 'POS_READ_POLICY_ROLLBACK_DRIFT'; END IF;
END;
$guard$;
ALTER POLICY auth_select_order_items ON public.order_items USING (
 EXISTS (SELECT 1 FROM public.orders o WHERE o.id=order_items.order_id
 AND public.user_may_access_branch(o.branch_id)
 AND (o.cashier_id=auth.uid() OR public.can_manage_other_pos_orders() OR public.can_permission('pos.kds_view')))
);
ALTER POLICY auth_select_order_kitchen_sends ON public.order_kitchen_sends USING (
 public.is_pos_admin() OR (branch_id=public.get_branch_id() AND (public.can_permission('pos.view') OR public.can_permission('pos.kds_view')))
);
COMMIT;
