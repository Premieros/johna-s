-- Forward-only POS hardening follow-up from Verify main #1618.
-- Ensure linked-order ownership is rejected as a structured RPC result before
-- any sale core / trigger path can raise and abort the caller transaction.

DO $patch$
DECLARE
  v_def text;
  v_old_decl text := $old$
  v_order_table uuid;
  v_order_paid numeric(14,2) := 0;
$old$;
  v_new_decl text := $new$
  v_order_table uuid;
  v_order_owner uuid;
  v_order_paid numeric(14,2) := 0;
$new$;
  v_old_guard text := $old$
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
$old$;
  v_new_guard text := $new$
  IF p_order_id IS NOT NULL THEN
    SELECT o.cashier_id
    INTO v_order_owner
    FROM public.orders o
    WHERE o.id = p_order_id
      AND o.branch_id = p_branch_id;

    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    IF v_order_owner IS DISTINCT FROM auth.uid()
       AND NOT public.can_manage_other_pos_orders() THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
    END IF;
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF position(v_old_decl IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale declaration fragment not found; refusing drifted patch';
  END IF;
  v_def := replace(v_def, v_old_decl, v_new_decl);

  IF position(v_old_guard IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale linked-order guard fragment not found; refusing drifted patch';
  END IF;
  v_def := replace(v_def, v_old_guard, v_new_guard);

  EXECUTE v_def;
END;
$patch$;
