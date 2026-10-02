-- Paid-order reopen containment.
-- Incident reproduced in Production on 2026-10-02:
-- a linked sent-only sale could leave the order open, and the sent-item Void
-- path could still reduce/delete quantity that was already settled to a sale.
--
-- This migration is forward-only and deliberately narrow:
-- 1) preflight paid-vs-unsettled quantity before any inventory restoration;
-- 2) refuse Void that would touch financially settled quantity;
-- 3) after a legitimate kitchen Void, reconcile a paid open order to completed
--    when no unsent or unsettled quantity remains.

DO $patch_restore_kitchen_void$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)'::regprocedure
  )
  INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '_restore_kitchen_inventory_for_void target not found';
  END IF;

  v_old := $old$
  v_source_restored numeric(14,6);
  v_source_tracked boolean;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_QUANTITY');
  END IF;

  FOR v_event IN
$old$;

  v_new := $new$
  v_source_restored numeric(14,6);
  v_source_tracked boolean;
  v_unsettled_available numeric(14,6):=0;
  v_settled_active numeric(14,6):=0;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_QUANTITY');
  END IF;

  SELECT
    COALESCE(sum(
      CASE
        WHEN settled_sale_id IS NULL THEN GREATEST(sent_quantity-voided_quantity,0)
        ELSE 0
      END
    ),0),
    COALESCE(sum(
      CASE
        WHEN settled_sale_id IS NOT NULL THEN GREATEST(sent_quantity-voided_quantity,0)
        ELSE 0
      END
    ),0)
  INTO v_unsettled_available, v_settled_active
  FROM public.order_kitchen_inventory_events
  WHERE order_id=p_order_id
    AND order_item_id=p_order_item_id
    AND sent_quantity>voided_quantity;

  -- A kitchen Void may restore/reduce only quantity that is still financially
  -- unsettled. Once any part has been attached to a sale, reversing that paid
  -- quantity belongs to the Refund flow, not order editing.
  IF p_quantity > v_unsettled_available + 0.000001
     AND v_settled_active > 0 THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','PAID_ITEM_REFUND_REQUIRED',
      'requested_quantity',p_quantity,
      'voidable_unsettled_quantity',v_unsettled_available,
      'settled_quantity',v_settled_active
    );
  END IF;

  FOR v_event IN
$new$;

  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION '_restore_kitchen_inventory_for_void declaration fragment not found; refusing drifted patch';
  END IF;

  v_def := replace(v_def,v_old,v_new);
  EXECUTE v_def;
END;
$patch_restore_kitchen_void$;

CREATE OR REPLACE FUNCTION private.reconcile_paid_order_after_kitchen_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_remaining_unsettled numeric(14,6):=0;
  v_remaining_unsent numeric(14,6):=0;
  v_sale_total numeric(14,2):=0;
  v_paid_total numeric(14,2):=0;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id=NEW.order_id
  FOR UPDATE;

  IF v_order.id IS NULL
     OR v_order.status NOT IN ('open','held')
     OR (v_order.payment_at IS NULL AND COALESCE(v_order.payment_status,'unpaid')='unpaid') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(GREATEST(e.sent_quantity-e.voided_quantity,0)),0)
  INTO v_remaining_unsettled
  FROM public.order_kitchen_inventory_events e
  WHERE e.order_id=NEW.order_id
    AND e.settled_sale_id IS NULL
    AND e.sent_quantity>e.voided_quantity;

  SELECT COALESCE(sum(GREATEST(oi.quantity-COALESCE(s.sent_quantity,0),0)),0)
  INTO v_remaining_unsent
  FROM public.order_items oi
  LEFT JOIN (
    SELECT order_item_id, sum(sent_quantity) AS sent_quantity
    FROM public.order_kitchen_sends
    WHERE order_id=NEW.order_id
    GROUP BY order_item_id
  ) s ON s.order_item_id=oi.id
  WHERE oi.order_id=NEW.order_id
    AND oi.quantity>0;

  SELECT
    COALESCE(sum(s.total),0),
    COALESCE(sum(s.paid_amount),0)
  INTO v_sale_total, v_paid_total
  FROM public.sales s
  WHERE s.status='completed'
    AND (
      s.source_order_id=NEW.order_id
      OR s.id IN (
        SELECT DISTINCT e.settled_sale_id
        FROM public.order_kitchen_inventory_events e
        WHERE e.order_id=NEW.order_id
          AND e.settled_sale_id IS NOT NULL
      )
    );

  IF v_sale_total<=0
     OR v_remaining_unsettled>0.000001
     OR v_remaining_unsent>0.000001 THEN
    RETURN NEW;
  END IF;

  UPDATE public.orders
  SET status='completed',
      payment_status=CASE
        WHEN v_paid_total+0.005>=v_sale_total THEN 'paid'
        WHEN v_paid_total>0 THEN 'partial'
        ELSE payment_status
      END,
      completed_at=COALESCE(completed_at,payment_at,now()),
      updated_at=now()
  WHERE id=NEW.order_id
    AND status IN ('open','held');

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.reconcile_paid_order_after_kitchen_void() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reconcile_paid_order_after_kitchen_void() FROM anon;
REVOKE ALL ON FUNCTION private.reconcile_paid_order_after_kitchen_void() FROM authenticated;

DROP TRIGGER IF EXISTS trg_reconcile_paid_order_after_kitchen_void
ON public.order_kitchen_voids;

CREATE TRIGGER trg_reconcile_paid_order_after_kitchen_void
AFTER INSERT ON public.order_kitchen_voids
FOR EACH ROW
EXECUTE FUNCTION private.reconcile_paid_order_after_kitchen_void();

COMMENT ON FUNCTION private.reconcile_paid_order_after_kitchen_void() IS
'Closes a paid sent-only order after a legitimate kitchen Void removes the final unsent/unsettled remainder; does not rewrite sales, journals, or inventory.';
