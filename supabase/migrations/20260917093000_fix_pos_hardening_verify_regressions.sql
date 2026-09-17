-- Forward-only corrective patch for Verify main #1612 regressions.
-- This migration intentionally patches the exact canonical definitions installed
-- by the immediately preceding POS hardening migrations and fails closed if the
-- expected source fragments are not present.

DO $patch$
DECLARE
  v_def text;
  v_old text := $old$
      v_effective_cashier := v_uid;
$old$;
  v_new text := $new$
      IF p_cashier_id IS NOT NULL AND p_cashier_id IS DISTINCT FROM v_uid THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN',
          'detail', 'Authenticated POS users cannot create an order in another operator''s name.'
        );
      END IF;
      v_effective_cashier := v_uid;
$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure
  ) INTO v_def;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_order canonical fragment not found; refusing drifted patch';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

DO $patch$
DECLARE
  v_def text;
  v_old text := $old$
          RETURN jsonb_build_object(
            'success', false,
            'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID',
            'order_item_id', v_matched_id,
            'sent_quantity', v_sent_quantity
          );
$old$;
  v_new text := $new$
          RETURN jsonb_build_object(
            'success', false,
            'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID',
            'detail', 'SENT_ITEM_APPROVAL_REQUIRED: use the controlled void path for already-sent quantity',
            'order_item_id', v_matched_id,
            'sent_quantity', v_sent_quantity
          );
$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)'::regprocedure
  ) INTO v_def;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'update_order sent-item guard fragment not found; refusing drifted patch';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

DO $patch$
DECLARE
  v_def text;
  v_branch_old text := $old$
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
$old$;
  v_branch_new text := $new$
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF p_order_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = p_order_id
        AND o.branch_id = p_branch_id
    ) THEN
      IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
  END IF;
$new$;
  v_unsent_old text := $old$
      RETURN jsonb_build_object('success', false, 'error', 'NO_SENT_ITEMS_TO_SETTLE');
$old$;
  v_unsent_new text := $new$
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FULLY_SENT');
$new$;
  v_discount_old text := $old$
    v_header_discount,
    'amount',
    0,
$old$;
  v_discount_new text := $new$
    v_header_discount,
    CASE WHEN p_order_id IS NOT NULL THEN 'amount' ELSE COALESCE(p_discount_type, 'amount') END,
    0,
$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF position(v_branch_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale branch guard fragment not found; refusing drifted patch';
  END IF;
  v_def := replace(v_def, v_branch_old, v_branch_new);

  IF position(v_unsent_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale no-sent fragment not found; refusing drifted patch';
  END IF;
  v_def := replace(v_def, v_unsent_old, v_unsent_new);

  IF position(v_discount_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale discount-type fragment not found; refusing drifted patch';
  END IF;
  v_def := replace(v_def, v_discount_old, v_discount_new);

  EXECUTE v_def;
END;
$patch$;
