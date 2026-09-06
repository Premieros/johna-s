-- P0-B final handover hardening.
-- Prevent cancel_sent_order_item from exposing sent-item existence/ambiguity
-- before authentication and branch authorization are established.

CREATE OR REPLACE FUNCTION public.cancel_sent_order_item(
  p_order_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item_id uuid;
  v_count integer;
  v_branch_id uuid;
  v_active_user boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active = true
  )
  INTO v_active_user;

  IF NOT COALESCE(v_active_user, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  SELECT o.branch_id
  INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT count(*), min(oi.id)
  INTO v_count, v_item_id
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.product_id = p_product_id
    AND EXISTS (
      SELECT 1
      FROM public.order_kitchen_sends s
      WHERE s.order_item_id = oi.id
    );

  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'SENT_ITEM_NOT_FOUND');
  END IF;

  IF v_count > 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'AMBIGUOUS_SENT_ITEM',
      'detail', 'Use cancel_sent_order_item_exact with order_item_id',
      'matching_lines', v_count
    );
  END IF;

  RETURN public.cancel_sent_order_item_exact(
    p_order_id,
    v_item_id,
    p_quantity,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_sent_order_item(uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_sent_order_item(uuid, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_sent_order_item(uuid, uuid, numeric, text) TO authenticated, service_role;
