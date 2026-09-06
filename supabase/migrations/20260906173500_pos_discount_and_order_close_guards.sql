-- POS checkout hardening:
-- 1) payment requires pos.payment.take at the RPC boundary;
-- 2) split tender follows the same discount controls as normal checkout;
-- 3) a linked POS order cannot be financially closed by a partial payment;
-- 4) direct order completion is forbidden; completion belongs to successful checkout;
-- 5) direct payment-status mutation is internal-only.

DO $patch_process_sale$
DECLARE
  v_oid oid;
  v_def text;
  v_original text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_sale'
    AND p.prokind = 'f'
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'process_sale not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_original := v_def;

  v_def := replace(
    v_def,
    '  v_sale_id uuid;' || E'\nBEGIN',
    '  v_sale_id uuid;' || E'\n' ||
    '  v_tax_enabled boolean;' || E'\n' ||
    '  v_tax_rate numeric(14,2);' || E'\n' ||
    '  v_due numeric(14,2);' || E'\n' ||
    '  v_header_discount numeric(14,2);' || E'\nBEGIN'
  );

  v_def := replace(
    v_def,
    '  IF auth.uid() IS NULL THEN RETURN jsonb_build_object(''success'',false,''error'',''AUTH_REQUIRED''); END IF;' || E'\n' ||
    '  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RETURN jsonb_build_object(''success'',false,''error'',''EMPTY_CART''); END IF;',
    '  IF auth.uid() IS NULL THEN RETURN jsonb_build_object(''success'',false,''error'',''AUTH_REQUIRED''); END IF;' || E'\n' ||
    '  IF NOT public.can_permission(''pos.payment.take'') THEN RETURN jsonb_build_object(''success'',false,''error'',''PERMISSION_DENIED'',''permission'',''pos.payment.take''); END IF;' || E'\n' ||
    '  IF NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object(''success'',false,''error'',''BRANCH_MISMATCH''); END IF;' || E'\n' ||
    '  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RETURN jsonb_build_object(''success'',false,''error'',''EMPTY_CART''); END IF;'
  );

  v_def := replace(
    v_def,
    '  v_server_subtotal := ROUND(v_server_subtotal,2);' || E'\n\n' ||
    '  IF COALESCE(p_discount_amount,0)>0 AND NOT can_permission(''pos.discount'') THEN',
    '  v_server_subtotal := ROUND(v_server_subtotal,2);' || E'\n' ||
    '  v_header_discount := LEAST(GREATEST(COALESCE(p_discount_amount,0),0),v_server_subtotal);' || E'\n' ||
    '  SELECT t.tax_enabled,t.tax_rate INTO v_tax_enabled,v_tax_rate FROM public._effective_branch_tax(p_branch_id) t;' || E'\n' ||
    '  v_due := ROUND(v_server_subtotal-v_header_discount+CASE WHEN COALESCE(v_tax_enabled,false) THEN ROUND((v_server_subtotal-v_header_discount)*COALESCE(v_tax_rate,0)/100,2) ELSE 0 END,2);' || E'\n' ||
    '  IF p_order_id IS NOT NULL AND ROUND(GREATEST(COALESCE(p_paid_amount,0),0),2) < v_due THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''success'',false,''error'',''FULL_PAYMENT_REQUIRED_TO_CLOSE_ORDER'',''total_due'',v_due,''paid_amount'',ROUND(GREATEST(COALESCE(p_paid_amount,0),0),2));' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  IF COALESCE(p_discount_amount,0)>0 AND NOT can_permission(''pos.discount'') THEN'
  );

  IF v_def = v_original
     OR position('pos.payment.take' IN v_def) = 0
     OR position('FULL_PAYMENT_REQUIRED_TO_CLOSE_ORDER' IN v_def) = 0
     OR position('user_may_access_branch(p_branch_id)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale hardening patch failed';
  END IF;

  EXECUTE v_def;
END;
$patch_process_sale$;

DO $patch_process_sale_split$
DECLARE
  v_oid oid;
  v_def text;
  v_original text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_sale_split'
    AND p.prokind = 'f'
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'process_sale_split not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_original := v_def;

  v_def := replace(
    v_def,
    '  v_bank_account uuid;' || E'\nBEGIN',
    '  v_bank_account uuid;' || E'\n' ||
    '  v_item jsonb;' || E'\n' ||
    '  v_product_id uuid;' || E'\n' ||
    '  v_qty numeric;' || E'\n' ||
    '  v_price numeric;' || E'\n' ||
    '  v_mod jsonb;' || E'\n' ||
    '  v_line_discount numeric;' || E'\n' ||
    '  v_server_subtotal numeric(14,2) := 0;' || E'\n' ||
    '  v_header_discount numeric(14,2);' || E'\n' ||
    '  v_tax_enabled boolean;' || E'\n' ||
    '  v_tax_rate numeric(14,2);' || E'\n' ||
    '  v_due numeric(14,2);' || E'\n' ||
    '  v_req_id uuid;' || E'\n' ||
    '  v_email text;' || E'\nBEGIN'
  );

  v_def := replace(
    v_def,
    '    IF auth.uid() IS NULL THEN' || E'\n' ||
    '      RETURN jsonb_build_object(''success'', false, ''error'', ''AUTH_REQUIRED'');' || E'\n' ||
    '    END IF;' || E'\n\n' ||
    '    IF p_payments IS NULL',
    '    IF auth.uid() IS NULL THEN' || E'\n' ||
    '      RETURN jsonb_build_object(''success'', false, ''error'', ''AUTH_REQUIRED'');' || E'\n' ||
    '    END IF;' || E'\n' ||
    '    IF NOT public.can_permission(''pos.payment.take'') THEN' || E'\n' ||
    '      RETURN jsonb_build_object(''success'',false,''error'',''PERMISSION_DENIED'',''permission'',''pos.payment.take'');' || E'\n' ||
    '    END IF;' || E'\n' ||
    '    IF NOT public.user_may_access_branch(p_branch_id) THEN' || E'\n' ||
    '      RETURN jsonb_build_object(''success'',false,''error'',''BRANCH_MISMATCH'');' || E'\n' ||
    '    END IF;' || E'\n\n' ||
    '    IF p_payments IS NULL'
  );

  v_def := replace(
    v_def,
    '    -- The existing sale core remains the single stock/write boundary.',
    '    -- Match normal checkout discount authorization before any financial write.' || E'\n' ||
    '    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP' || E'\n' ||
    '      v_product_id := NULLIF(v_item->>''product_id'','''')::uuid;' || E'\n' ||
    '      v_qty := COALESCE((v_item->>''quantity'')::numeric,0);' || E'\n' ||
    '      IF v_product_id IS NULL THEN RETURN jsonb_build_object(''success'',false,''error'',''INVALID_PRODUCT''); END IF;' || E'\n' ||
    '      IF v_qty <= 0 THEN RETURN jsonb_build_object(''success'',false,''error'',''INVALID_QUANTITY''); END IF;' || E'\n' ||
    '      SELECT sale_price INTO v_price FROM public.products WHERE id=v_product_id AND branch_id=p_branch_id AND is_active=true;' || E'\n' ||
    '      IF NOT FOUND THEN RETURN jsonb_build_object(''success'',false,''error'',''PRODUCT_NOT_IN_BRANCH'',''product_id'',v_product_id); END IF;' || E'\n' ||
    '      v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->''modifier_option_ids'',''[]''::jsonb));' || E'\n' ||
    '      IF COALESCE((v_mod->>''success'')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;' || E'\n' ||
    '      v_price := GREATEST(COALESCE(v_price,0)+COALESCE((v_mod->>''price_delta'')::numeric,0),0);' || E'\n' ||
    '      v_line_discount := ROUND(LEAST(GREATEST(COALESCE((v_item->>''discount_amount'')::numeric,0),0),v_qty*v_price),2);' || E'\n' ||
    '      IF v_line_discount > 0 AND NOT public.can_permission(''pos.discount'') THEN' || E'\n' ||
    '        RETURN jsonb_build_object(''success'',false,''error'',''MANAGER_APPROVAL_REQUIRED'',''action'',''discount'',''scope'',''line'');' || E'\n' ||
    '      END IF;' || E'\n' ||
    '      v_server_subtotal := v_server_subtotal + ROUND(v_qty*v_price-v_line_discount,2);' || E'\n' ||
    '    END LOOP;' || E'\n' ||
    '    v_server_subtotal := ROUND(v_server_subtotal,2);' || E'\n' ||
    '    v_header_discount := LEAST(GREATEST(COALESCE(p_discount_amount,0),0),v_server_subtotal);' || E'\n' ||
    '    IF COALESCE(p_discount_amount,0)>0 AND NOT public.can_permission(''pos.discount'') THEN' || E'\n' ||
    '      SELECT id INTO v_req_id FROM public.approval_requests' || E'\n' ||
    '      WHERE requester_id=auth.uid() AND branch_id=p_branch_id AND action_type=''discount''' || E'\n' ||
    '        AND status=''approved'' AND expires_at>now()' || E'\n' ||
    '        AND (entity_id IS NULL OR entity_id IS NOT DISTINCT FROM p_order_id)' || E'\n' ||
    '        AND COALESCE(payload->>''discount_type'',''amount'')=COALESCE(p_discount_type,''amount'')' || E'\n' ||
    '        AND abs(COALESCE((payload->>''discount_amount'')::numeric,-1)-p_discount_amount)<0.0001' || E'\n' ||
    '        AND abs(COALESCE((payload->>''subtotal'')::numeric,-1)-v_server_subtotal)<0.0001' || E'\n' ||
    '      ORDER BY decided_at DESC NULLS LAST,created_at DESC LIMIT 1 FOR UPDATE;' || E'\n' ||
    '      IF v_req_id IS NULL THEN RETURN jsonb_build_object(''success'',false,''error'',''MANAGER_APPROVAL_REQUIRED'',''action'',''discount''); END IF;' || E'\n' ||
    '      UPDATE public.approval_requests SET status=''consumed'',consumed_at=now() WHERE id=v_req_id;' || E'\n' ||
    '      SELECT email INTO v_email FROM public.users WHERE id=auth.uid();' || E'\n' ||
    '      INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)' || E'\n' ||
    '      VALUES(auth.uid(),v_email,''APPROVAL_CONSUMED'',''approval_request'',v_req_id,' || E'\n' ||
    '        jsonb_build_object(''action_type'',''discount'',''discount_amount'',p_discount_amount,''discount_type'',p_discount_type,' || E'\n' ||
    '          ''server_subtotal'',v_server_subtotal,''order_id'',p_order_id),p_branch_id);' || E'\n' ||
    '    END IF;' || E'\n' ||
    '    SELECT t.tax_enabled,t.tax_rate INTO v_tax_enabled,v_tax_rate FROM public._effective_branch_tax(p_branch_id) t;' || E'\n' ||
    '    v_due := ROUND(v_server_subtotal-v_header_discount+CASE WHEN COALESCE(v_tax_enabled,false) THEN ROUND((v_server_subtotal-v_header_discount)*COALESCE(v_tax_rate,0)/100,2) ELSE 0 END,2);' || E'\n' ||
    '    IF ROUND(v_requested_total,2) <> v_due THEN' || E'\n' ||
    '      RETURN jsonb_build_object(''success'',false,''error'',''SPLIT_PAYMENT_TOTAL_MISMATCH'',''total_due'',v_due,''paid_amount'',ROUND(v_requested_total,2));' || E'\n' ||
    '    END IF;' || E'\n\n' ||
    '    -- The existing sale core remains the single stock/write boundary.'
  );

  IF v_def = v_original
     OR position('pos.payment.take' IN v_def) = 0
     OR position('MANAGER_APPROVAL_REQUIRED' IN v_def) = 0
     OR position('SPLIT_PAYMENT_TOTAL_MISMATCH' IN v_def) = 0
     OR position('user_may_access_branch(p_branch_id)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale_split hardening patch failed';
  END IF;

  EXECUTE v_def;
END;
$patch_process_sale_split$;

CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id uuid,
  p_status text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF p_status NOT IN ('open','held','completed','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('pos.order.edit') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.edit');
  END IF;

  IF v_order.status IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_CLOSED');
  END IF;

  -- Financial completion is owned by process_sale/process_sale_split only.
  IF p_status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'COMPLETION_REQUIRES_PAYMENT',
      'detail', 'Complete the order through the controlled payment flow.'
    );
  END IF;

  -- A kitchen-sent order cannot be cancelled by a plain status flip because
  -- that would leave kitchen inventory/KDS effects unreconciled.
  IF p_status = 'cancelled' AND EXISTS (
    SELECT 1
    FROM public.order_kitchen_sends oks
    JOIN public.order_items oi ON oi.id = oks.order_item_id
    WHERE oi.order_id = p_order_id
      AND COALESCE(oks.sent_quantity,0) > 0
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SENT_ORDER_CANCEL_REQUIRES_CONTROLLED_VOID',
      'detail', 'Cancel sent items through the audited void flow before cancelling the order.'
    );
  END IF;

  IF p_status = 'cancelled' AND (p_notes IS NULL OR length(trim(p_notes)) < 3) THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  END IF;

  UPDATE public.orders
  SET status = p_status,
      updated_at = now(),
      completed_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE NULL END,
      notes = COALESCE(NULLIF(trim(p_notes),''), notes)
  WHERE id = p_order_id;

  IF v_order.table_id IS NOT NULL THEN
    UPDATE public.dining_tables
    SET status = CASE WHEN p_status = 'cancelled' THEN 'vacant' ELSE 'occupied' END,
        updated_at = now()
    WHERE id = v_order.table_id;
  END IF;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    CASE WHEN p_status = 'cancelled' THEN 'ORDER_CANCELLED' ELSE 'ORDER_STATUS_CHANGED' END,
    'order',
    p_order_id,
    jsonb_build_object('from_status',v_order.status,'to_status',p_status,'reason',p_notes),
    v_order.branch_id
  );

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', p_status);
END;
$function$;

-- Payment status is derived from successful sale settlement. Do not allow a
-- normal authenticated client to mark an order paid/refunded directly.
REVOKE ALL ON FUNCTION public.set_payment_status(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_payment_status(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_payment_status(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_status(uuid, text) TO service_role;

ALTER FUNCTION public.process_sale(
  text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid, integer
) SET search_path = public, pg_temp;

ALTER FUNCTION public.process_sale_split(
  text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric,
  numeric, jsonb, text, jsonb, uuid, text, uuid, uuid, integer
) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.set_order_status(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) TO authenticated, service_role;
