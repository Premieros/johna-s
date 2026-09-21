BEGIN;

-- Auto-close an unpaid table order when the controlled sent-item Void removes
-- the final effective item. This retires zero-value open/held order shells so
-- the table is immediately reusable.
--
-- Safety:
-- * Only the signed cancel_sent_order_item_exact transaction may use this path.
-- * Partial Void keeps the order open.
-- * Any order with payment activity is not auto-closed.
-- * No print queue / printer routing / inventory algorithm changes.

DO $patch_exact_void_autoclose$
DECLARE
  v_sig regprocedure :=
    to_regprocedure('public.cancel_sent_order_item_exact(uuid,uuid,numeric,text)');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'cancel_sent_order_item_exact target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('FULLY_VOIDED_ORDER_AUTO_CLOSED' in v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      $re$UPDATE[[:space:]]+public\.orders[[:space:]]+SET[[:space:]]+subtotal[[:space:]]*=[[:space:]]*v_subtotal,[[:space:]]*total[[:space:]]*=[[:space:]]*v_total,[[:space:]]*notes[[:space:]]*=[[:space:]]*concat_ws\(E'\\n',[[:space:]]*NULLIF\(notes,[[:space:]]*''\),[[:space:]]*v_note\),[[:space:]]*updated_at[[:space:]]*=[[:space:]]*now\(\)[[:space:]]+WHERE[[:space:]]+id[[:space:]]*=[[:space:]]*p_order_id;$re$,
      $new$IF NOT EXISTS (
       SELECT 1
       FROM public.order_items oi
       WHERE oi.order_id=p_order_id
         AND oi.quantity>0
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.order_kitchen_sends oks
       WHERE oks.order_id=p_order_id
         AND oks.sent_quantity>0
     )
     AND COALESCE(v_order.payment_status,'unpaid')='unpaid'
     AND v_order.payment_at IS NULL THEN
    UPDATE public.orders
    SET subtotal=0,
        total=0,
        status='cancelled',
        kitchen_status='cancelled',
        completed_at=COALESCE(completed_at,now()),
        notes=concat_ws(
          E'\n',
          NULLIF(notes,''),
          v_note,
          '[SYSTEM] FULLY_VOIDED_ORDER_AUTO_CLOSED'
        ),
        updated_at=now()
    WHERE id=p_order_id;
  ELSE
    UPDATE public.orders
    SET subtotal=v_subtotal,
        total=v_total,
        notes=concat_ws(E'\n',NULLIF(notes,''),v_note),
        updated_at=now()
    WHERE id=p_order_id;
  END IF;$new$,
      'g'
    );

    IF v_next=v_def
       OR position('FULLY_VOIDED_ORDER_AUTO_CLOSED' in v_next)=0
       OR position('status=''cancelled''' in v_next)=0 THEN
      RAISE EXCEPTION
        'cancel_sent_order_item_exact auto-close patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_exact_void_autoclose$;

-- The exact Void RPC already establishes a signed transaction-local context.
-- Allow that context to perform only the structural order cancellation caused
-- by removing the last sent item; do not grant pos.cancel_order generally.
DO $patch_void_cancel_permission_guard$
DECLARE
  v_sig regprocedure :=
    to_regprocedure('public.enforce_pos_permission_mutation()');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'enforce_pos_permission_mutation target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('sent-item Void may structurally close' in v_def)=0 THEN
    v_next := replace(
      v_def,
      $old$        IF NOT (
          COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.id::text
          AND public.can_permission('pos.order.transfer')
        ) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order';
        END IF;$old$,
      $new$        IF NOT (
          COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.id::text
          AND public.can_permission('pos.order.transfer')
        )
        -- A signed sent-item Void may structurally close its own now-empty order.
        -- This does not grant the caller generic pos.cancel_order authority.
        AND NOT public._sent_item_void_context_matches(OLD.id,NULL) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order';
        END IF;$new$
    );

    IF v_next=v_def
       OR position('signed sent-item Void may structurally close' in v_next)=0
       OR position('_sent_item_void_context_matches(OLD.id,NULL)' in v_next)=0 THEN
      RAISE EXCEPTION
        'enforce_pos_permission_mutation Void auto-close patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_void_cancel_permission_guard$;

NOTIFY pgrst,'reload schema';

COMMIT;
