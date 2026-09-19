-- Allow an authorized cross-operator sent-item void to update the canonical
-- kitchen-send row without weakening general operator ownership.
--
-- Root cause:
-- cancel_sent_order_item_exact() authorizes pos.void correctly, but it updated
-- order_kitchen_sends before setting the internal approved-void context.
-- guard_kitchen_send_operator_ownership() therefore rejected managers voiding
-- items on another operator's order with ORDER_OPERATOR_REQUIRED.
--
-- Safety:
-- - no generic ownership bypass
-- - bypass requires the internal approved-void context
-- - caller must still hold pos.void or approvals.review
-- - branch access is still required
-- - only a same-row sent_quantity decrease (plus sent_at/sent_by bookkeeping)
--   is accepted
-- - print/KDS routing is untouched

CREATE OR REPLACE FUNCTION public.guard_kitchen_send_operator_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean :=
    COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_is_db_admin boolean :=
    COALESCE(current_setting('role', true), '') IN ('', 'none', 'postgres', 'supabase_admin')
    AND session_user IN ('postgres', 'supabase_admin');
  v_internal_void boolean :=
    COALESCE(current_setting('app.approved_sent_item_void', true), '') = '1';
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

  IF v_internal_void
     AND TG_OP = 'UPDATE'
     AND (public.can_permission('pos.void') OR public.can_permission('approvals.review'))
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
     AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id
     AND NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id
     AND COALESCE(NEW.sent_quantity, 0) <= COALESCE(OLD.sent_quantity, 0)
     AND (to_jsonb(NEW) - ARRAY['sent_quantity','sent_at','sent_by']::text[])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['sent_quantity','sent_at','sent_by']::text[]) THEN
    RETURN NEW;
  END IF;

  IF v_owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DO $patch_void_context$
DECLARE
  v_sig regprocedure := to_regprocedure('public.cancel_sent_order_item_exact(uuid,uuid,numeric,text)');
  v_def text;
  v_update_pos integer;
  v_flag_pos integer;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'cancel_sent_order_item_exact target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  v_update_pos := position('UPDATE public.order_kitchen_sends' in v_def);
  v_flag_pos := position('set_config(''app.approved_sent_item_void''' in v_def);

  IF v_update_pos = 0 THEN
    RAISE EXCEPTION 'cancel_sent_order_item_exact kitchen-send update not found';
  END IF;

  IF v_flag_pos = 0 OR v_flag_pos > v_update_pos THEN
    v_next := regexp_replace(
      v_def,
      E'([[:space:]]+)UPDATE public\\.order_kitchen_sends',
      E'\\1PERFORM set_config(''app.approved_sent_item_void'', ''1'', true);\\n\\1UPDATE public.order_kitchen_sends'
    );

    IF v_next = v_def THEN
      RAISE EXCEPTION 'cancel_sent_order_item_exact context patch pattern changed';
    END IF;

    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;
  v_update_pos := position('UPDATE public.order_kitchen_sends' in v_def);
  v_flag_pos := position('set_config(''app.approved_sent_item_void''' in v_def);

  IF v_flag_pos = 0 OR v_flag_pos > v_update_pos THEN
    RAISE EXCEPTION 'approved sent-item void context is not set before kitchen-send update';
  END IF;
END;
$patch_void_context$;

NOTIFY pgrst, 'reload schema';
