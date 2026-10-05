-- Permission-first hotfix: a newly added line has no served-baseline row.
-- Preserve the exact served->sent, send permission and order-level baseline gates.
-- No role-name exception, grant, RLS change, send core or print/stock mutation.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure);
  v_old text := $old$
      IF OLD.kitchen_status='served'
         AND NEW.kitchen_status='sent'
         AND public.can_permission('pos.send_kitchen')
         AND EXISTS(
           SELECT 1
           FROM public.order_kitchen_sends s
           JOIN public.order_kitchen_served_quantities ksb
             ON ksb.order_id = OLD.id
            AND ksb.order_item_id = s.order_item_id
           WHERE s.order_id = OLD.id
             AND COALESCE(s.sent_quantity,0) > COALESCE(ksb.served_quantity,0)
         ) THEN
        RETURN NEW;
      END IF;
$old$;
  v_new text := $new$
      IF OLD.kitchen_status='served'
         AND NEW.kitchen_status='sent'
         AND public.can_permission('pos.send_kitchen')
         AND EXISTS(
           SELECT 1 FROM public.order_kitchen_served_quantities baseline
           WHERE baseline.order_id = OLD.id
         )
         AND EXISTS(
           SELECT 1
           FROM public.order_kitchen_sends s
           LEFT JOIN public.order_kitchen_served_quantities ksb
             ON ksb.order_id = OLD.id
            AND ksb.order_item_id = s.order_item_id
           WHERE s.order_id = OLD.id
             AND COALESCE(s.sent_quantity,0) > COALESCE(ksb.served_quantity,0)
         ) THEN
        RETURN NEW;
      END IF;
$new$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_def) = 0
     OR length(v_def)-length(replace(v_def,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'STOP_AND_RECONCILE: served resend guard definition differs';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$patch$;
