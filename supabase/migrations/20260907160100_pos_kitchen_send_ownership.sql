-- Stage 4.2 companion guard: a same-branch user with pos.send_kitchen may not
-- send or extend another operator's order. KDS status transitions remain
-- independent because they do not mutate order_kitchen_sends.

CREATE OR REPLACE FUNCTION public.guard_kitchen_send_operator_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean :=
    COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_is_db_admin boolean :=
    COALESCE(current_setting('role', true), '') IN ('', 'none', 'postgres', 'supabase_admin')
    AND session_user IN ('postgres', 'supabase_admin');
  v_order_id uuid;
  v_owner_id uuid;
  v_branch_id uuid;
BEGIN
  IF v_is_service_role OR v_is_db_admin THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF public.is_pos_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.cashier_id, o.branch_id
  INTO v_owner_id, v_branch_id
  FROM public.orders o
  WHERE o.id = v_order_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  IF v_owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pos_operator_kitchen_sends ON public.order_kitchen_sends;
CREATE TRIGGER trg_pos_operator_kitchen_sends
BEFORE INSERT OR UPDATE OR DELETE ON public.order_kitchen_sends
FOR EACH ROW
EXECUTE FUNCTION public.guard_kitchen_send_operator_ownership();

REVOKE ALL ON FUNCTION public.guard_kitchen_send_operator_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_kitchen_send_operator_ownership() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_kitchen_send_operator_ownership() TO service_role;
