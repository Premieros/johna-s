-- Safely allow authorized managers to void sent table items owned by another POS operator.
-- The bypass is NOT based on a client-settable GUC. It is accepted only after the
-- authoritative kitchen inventory events prove that the exact quantity has already
-- been restored by the controlled void flow.
--
-- No print routing, cloud-print queue, KDS rendering, or inventory policy changes.

CREATE OR REPLACE FUNCTION public.guard_kitchen_send_operator_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean :=
    COALESCE(current_setting('role',true),'')='service_role'
    OR COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role';
  v_is_db_admin boolean :=
    COALESCE(current_setting('role',true),'') IN ('','none','postgres','supabase_admin')
    AND session_user IN ('postgres','supabase_admin');
  v_order_id uuid;
  v_owner_id uuid;
  v_branch_id uuid;
  v_item_transfer_context boolean := false;
  v_pending_inventory_quantity numeric(14,6) := 0;
  v_cross_operator_void_authorized boolean := false;
BEGIN
  IF v_is_service_role OR v_is_db_admin THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF public.is_pos_admin() THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Preserve the existing exact item-transfer context.
  IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    v_item_transfer_context :=
      COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.order_id::text
      AND COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=NEW.order_id::text
      AND COALESCE(current_setting('app.pos_item_transfer_item_ids',true),'') LIKE '%' || OLD.order_item_id::text || '%'
      AND public.can_permission('pos.order.transfer');

    IF v_item_transfer_context THEN
      RETURN NEW;
    END IF;
  END IF;

  v_order_id := CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.cashier_id,o.branch_id
  INTO v_owner_id,v_branch_id
  FROM public.orders o
  WHERE o.id=v_order_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  IF v_owner_id IS DISTINCT FROM v_uid THEN
    v_cross_operator_void_authorized :=
      public.can_manage_other_pos_orders()
      AND (public.can_permission('pos.void') OR public.can_permission('approvals.review'));

    IF v_cross_operator_void_authorized THEN
      SELECT COALESCE(sum(GREATEST(e.sent_quantity-e.voided_quantity,0)),0)
      INTO v_pending_inventory_quantity
      FROM public.order_kitchen_inventory_events e
      WHERE e.order_id=v_order_id
        AND e.order_item_id=CASE WHEN TG_OP='DELETE' THEN OLD.order_item_id ELSE NEW.order_item_id END
        AND e.settled_sale_id IS NULL;

      IF TG_OP='UPDATE'
         AND NEW.id IS NOT DISTINCT FROM OLD.id
         AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
         AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id
         AND NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id
         AND COALESCE(NEW.sent_quantity,0) < COALESCE(OLD.sent_quantity,0)
         AND COALESCE(NEW.sent_quantity,0) = COALESCE(v_pending_inventory_quantity,0)
         AND NEW.sent_by IS NOT DISTINCT FROM v_uid
         AND (to_jsonb(NEW)-ARRAY['sent_quantity','sent_at','sent_by']::text[])
           IS NOT DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['sent_quantity','sent_at','sent_by']::text[]) THEN
        RETURN NEW;
      END IF;

      -- A full-line controlled void first reconciles inventory and sets the
      -- send quantity to zero, then deleting the order item cascades this row.
      IF TG_OP='DELETE'
         AND COALESCE(OLD.sent_quantity,0)=0
         AND COALESCE(v_pending_inventory_quantity,0)=0 THEN
        RETURN OLD;
      END IF;
    END IF;

    RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_kitchen_send_operator_ownership() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_kitchen_send_operator_ownership() TO service_role;

NOTIFY pgrst,'reload schema';
