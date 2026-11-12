-- Emergency read-only performance fix. Applied 2026-11-12 18:31 UTC.
-- Preserve branch, order ownership, KDS permissions and restrictive financial policies.
BEGIN;
SET LOCAL lock_timeout='500ms';
SET LOCAL statement_timeout='5s';
LOCK TABLE public.order_items, public.order_kitchen_sends IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $guard$
BEGIN
 IF (SELECT md5(pg_get_expr(polqual,polrelid)) FROM pg_policy WHERE polrelid='public.order_items'::regclass AND polname='auth_select_order_items') IS DISTINCT FROM '463cd9c9390899131e49c027b45b7855'
 OR (SELECT md5(pg_get_expr(polqual,polrelid)) FROM pg_policy WHERE polrelid='public.order_kitchen_sends'::regclass AND polname='auth_select_order_kitchen_sends') IS DISTINCT FROM '62b0b6172ad5ef698aa8cdb039dca201'
 THEN RAISE EXCEPTION 'POS_READ_POLICY_SOURCE_DRIFT'; END IF;
END;
$guard$;
ALTER POLICY auth_select_order_items ON public.order_items USING (
 EXISTS (SELECT 1 FROM public.orders o WHERE o.id=order_items.order_id
 AND public.user_may_access_branch(o.branch_id)
 AND (o.cashier_id=(SELECT auth.uid()) OR (SELECT public.can_manage_other_pos_orders()) OR (SELECT public.can_permission('pos.kds_view'))))
);
ALTER POLICY auth_select_order_kitchen_sends ON public.order_kitchen_sends USING (
 (SELECT public.is_pos_admin()) OR (branch_id=(SELECT public.get_branch_id()) AND ((SELECT public.can_permission('pos.view')) OR (SELECT public.can_permission('pos.kds_view'))))
);
COMMIT;
